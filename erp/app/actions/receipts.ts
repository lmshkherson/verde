'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { transaction } from '@/lib/db';
import { type ActionState, num, str, strOrNull, toMessage } from '@/lib/action-state';
import { defaultWarehouseId, insertMoves, nextDocNumber, round2, round3 } from '@/lib/stock';
import { calcPurchaseVat } from '@/lib/vat';
import { resolveEntityId } from '@/lib/doc-entity';
import { requireRole } from '@/lib/session';

/**
 * Надходження — самостійний документ приходу.
 *
 * Заявка на закупівлю лишається там, де вона доречна: коли поставку
 * замовляють наперед і треба стежити за недопоставками. Але послуги ніхто
 * наперед не «замовляє» в системі, а частину сировини купують без заявки —
 * і вигадувати заявку заднім числом заради приходу означало б підганяти
 * роботу під програму.
 *
 * Проводки й податковий кредит той самий, що й у приймання за заявкою: це
 * одна господарська операція, різні лише двері, крізь які вона заходить.
 */
export async function createReceipt(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('warehouse');
  const supplierId = str(formData, 'supplier_id');
  if (!supplierId) return { error: 'Оберіть постачальника' };

  let receiptId: string;
  try {
    receiptId = await transaction(async (c) => {
      const entityId = await resolveEntityId(c, formData, session.eid);
      const number = await nextDocNumber(c, entityId, 'НАД');
      const { rows } = await c.query<{ id: string }>(
        `insert into receipts
           (number, legal_entity_id, supplier_id, received_on, supplier_doc_number,
            supplier_doc_date, prices_include_vat, warehouse_id, note, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
        [
          number,
          entityId,
          supplierId,
          str(formData, 'received_on') || new Date().toISOString().slice(0, 10),
          strOrNull(formData, 'supplier_doc_number'),
          strOrNull(formData, 'supplier_doc_date'),
          // Незнятий чекбокс приходить як 'on', знятий — відсутній у формі.
          // Порівняння з 'off' завжди давало true і мовчки губило вибір.
          formData.get('prices_include_vat') === 'on',
          strOrNull(formData, 'warehouse_id'),
          strOrNull(formData, 'note'),
          session.uid,
        ],
      );
      return rows[0].id;
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  redirect(`/receipts/${receiptId}`);
}

/**
 * Редагування шапки — лише в чернетці. Помилка в номері накладної
 * постачальника не повинна коштувати перестворення документа.
 */
export async function updateReceiptHeader(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('warehouse');
  const receiptId = str(formData, 'receipt_id');

  try {
    await transaction(async (c) => {
      await assertDraft(c, receiptId);
      await c.query(
        `update receipts set
           received_on = $2, supplier_doc_number = $3, supplier_doc_date = $4,
           prices_include_vat = $5, warehouse_id = $6, note = $7
         where id = $1`,
        [
          receiptId,
          str(formData, 'received_on') || new Date().toISOString().slice(0, 10),
          strOrNull(formData, 'supplier_doc_number'),
          strOrNull(formData, 'supplier_doc_date'),
          formData.get('prices_include_vat') === 'on',
          strOrNull(formData, 'warehouse_id'),
          strOrNull(formData, 'note'),
        ],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/receipts/${receiptId}`);
  return { ok: 'Шапку збережено' };
}

async function assertDraft(c: import('pg').PoolClient, receiptId: string) {
  const { rows } = await c.query<{ status: string }>('select status from receipts where id = $1', [
    receiptId,
  ]);
  if (!rows[0]) throw new Error('Документ не знайдено');
  if (rows[0].status !== 'draft') throw new Error('Документ уже проведено — змінювати рядки не можна');
}

/**
 * Разова послуга, якої немає в довіднику: опис вільним текстом і стаття
 * витрат руками. Послуги з довідника вводяться рядком у таблиці накладної —
 * там статтю, поведінку і ставку ПДВ дає їхня картка.
 */
export async function addServiceLine(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('warehouse');
  const receiptId = str(formData, 'receipt_id');
  const description = str(formData, 'description');
  const amount = num(formData, 'amount');
  const category = str(formData, 'category');

  if (!description) return { error: 'Опишіть послугу — це піде в призначення витрати' };
  if (!category) return { error: 'Оберіть статтю витрат' };
  if (amount <= 0) return { error: 'Вкажіть суму' };

  try {
    await transaction(async (c) => {
      await assertDraft(c, receiptId);
      // Статус платника — від юрособи самого документа, не від перемикача.
      const { rows: ent } = await c.query<{ is_vat_payer: boolean }>(
        `select e.is_vat_payer from receipts r join legal_entities e on e.id = r.legal_entity_id
          where r.id = $1`,
        [receiptId],
      );
      const buyerVat = ent[0]?.is_vat_payer ?? false;
      const vatRate = num(formData, 'vat_rate', buyerVat ? 20 : 0);
      if (vatRate > 0 && !buyerVat) {
        throw new Error('Юрособа документа не платник ПДВ — податок їй не відшкодовується, вкажіть повну суму');
      }
      await c.query(
        `insert into receipt_lines
           (receipt_id, kind, description, category, cost_behavior, qty, unit_price, vat_rate)
         values ($1, 'service', $2, $3, $4, 1, $5, $6)`,
        [
          receiptId,
          description,
          category,
          str(formData, 'cost_behavior') || 'fixed',
          amount,
          vatRate,
        ],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/receipts/${receiptId}`);
  return { ok: 'Послугу додано' };
}

/**
 * Пакетне збереження рядків — введення накладної як із паперу: таблиця
 * «номенклатура, кількість, ціна», один запис у базу на весь документ.
 * Товар і послуги з довідника йдуть одним списком: у паперовій накладній
 * доставка стоїть таким самим рядком, як і сировина.
 */
export async function saveReceiptLines(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('warehouse');
  const receiptId = str(formData, 'receipt_id');

  let lines: { item_id: string; qty: number; unit_price: number; batch_code: string; expires_on: string }[];
  try {
    lines = JSON.parse(str(formData, 'lines'));
  } catch {
    return { error: 'Не вдалося прочитати рядки — оновіть сторінку і спробуйте ще раз' };
  }
  if (!Array.isArray(lines) || lines.length === 0) return { error: 'У накладній немає жодного рядка' };
  if (lines.length > 200) return { error: 'Забагато рядків за раз — розбийте на два документи' };

  let saved = 0;
  try {
    await transaction(async (c) => {
      await assertDraft(c, receiptId);
      for (const [i, line] of lines.entries()) {
        const row = i + 1;
        const qty = Number(line.qty);
        const price = Number(line.unit_price);
        if (!line.item_id) throw new Error(`Рядок ${row}: не обрано номенклатуру`);
        if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Рядок ${row}: кількість має бути більшою за нуль`);
        if (!Number.isFinite(price) || price < 0) throw new Error(`Рядок ${row}: перевірте ціну`);

        const { rows: items } = await c.query<{
          name: string;
          kind: string;
          vat_rate: number;
          expense_category: string | null;
          cost_behavior: string;
        }>(
          'select name, kind, vat_rate, expense_category, cost_behavior from items where id = $1 and is_active',
          [line.item_id],
        );
        if (!items[0]) throw new Error(`Рядок ${row}: позицію не знайдено в довіднику`);
        const item = items[0];

        if (item.kind === 'service') {
          // Стаття, поведінка і ставка — з картки послуги; сума рядка
          // лягає як кількість × ціна.
          await c.query(
            `insert into receipt_lines
               (receipt_id, kind, item_id, description, category, cost_behavior, qty, unit_price, vat_rate)
             values ($1, 'service', $2, $3, $4, $5, 1, $6, $7)`,
            [
              receiptId,
              line.item_id,
              item.name,
              item.expense_category ?? 'services',
              item.cost_behavior,
              Math.round(qty * price * 10000) / 10000,
              Number(item.vat_rate),
            ],
          );
        } else {
          await c.query(
            `insert into receipt_lines
               (receipt_id, kind, item_id, qty, unit_price, vat_rate, batch_code, expires_on)
             values ($1, 'goods', $2, $3, $4, $5, $6, $7)`,
            [
              receiptId,
              line.item_id,
              qty,
              price,
              Number(item.vat_rate),
              String(line.batch_code ?? '').trim() || null,
              String(line.expires_on ?? '').trim() || null,
            ],
          );
        }
        saved += 1;
      }
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/receipts/${receiptId}`);
  return { ok: `Додано рядків: ${saved}` };
}

export async function removeReceiptLine(formData: FormData) {
  await requireRole('warehouse');
  const receiptId = str(formData, 'receipt_id');
  await transaction(async (c) => {
    await assertDraft(c, receiptId);
    await c.query('delete from receipt_lines where id = $1', [str(formData, 'line_id')]);
  });
  revalidatePath(`/receipts/${receiptId}`);
}

/**
 * Проведення документа.
 *
 * Товар лягає на склад партіями, послуги — у витрати періоду, ПДВ — у реєстр
 * податкового кредиту, борг перед постачальником росте на повну суму з
 * податком. Усе в одній транзакції: половини надходження не буває.
 */
export async function postReceipt(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('warehouse');
  const receiptId = str(formData, 'receipt_id');

  try {
    await transaction(async (c) => {
      const { rows: docs } = await c.query<{
        id: string;
        number: string;
        status: string;
        legal_entity_id: string;
        supplier_id: string;
        received_on: string;
        prices_include_vat: boolean;
        supplier_doc_number: string | null;
        buyer_is_vat_payer: boolean;
        supplier_is_vat_payer: boolean;
        supplier_name: string;
        supplier_edrpou: string | null;
        warehouse_id: string | null;
      }>(
        `select r.id, r.number, r.status, r.legal_entity_id, r.supplier_id, r.received_on,
                r.prices_include_vat, r.supplier_doc_number, r.warehouse_id,
                e.is_vat_payer as buyer_is_vat_payer,
                s.is_vat_payer as supplier_is_vat_payer,
                s.name as supplier_name, s.edrpou as supplier_edrpou
           from receipts r
           join legal_entities e on e.id = r.legal_entity_id
           join suppliers s on s.id = r.supplier_id
          where r.id = $1
          for update of r`,
        [receiptId],
      );
      const doc = docs[0];
      if (!doc) throw new Error('Документ не знайдено');
      if (doc.status === 'posted') throw new Error('Документ уже проведено');
      if (doc.status === 'cancelled') throw new Error('Документ скасовано');

      const { rows: lines } = await c.query<{
        id: string;
        kind: string;
        item_id: string | null;
        description: string | null;
        category: string | null;
        cost_behavior: string;
        qty: number;
        unit_price: number;
        vat_rate: number;
        batch_code: string | null;
        expires_on: string | null;
        item_name: string | null;
        sku: string | null;
        shelf_life_days: number | null;
        quality_control: boolean | null;
      }>(
        `select l.id, l.kind, l.item_id, l.description, l.category, l.cost_behavior,
                l.qty, l.unit_price, l.vat_rate, l.batch_code, l.expires_on,
                i.name as item_name, i.sku, i.shelf_life_days, i.quality_control
           from receipt_lines l
           left join items i on i.id = l.item_id
          where l.receipt_id = $1
          order by l.kind desc, i.name`,
        [receiptId],
      );
      if (lines.length === 0) throw new Error('У документі немає жодного рядка');

      const warehouseId = doc.warehouse_id ?? (await defaultWarehouseId(c, 'raw'));
      const controlled: { batchId: string; itemId: string; qty: number }[] = [];
      let creditBase = 0;
      let creditVat = 0;

      for (const line of lines) {
        // Той самий розрахунок, що й у прийманні за заявкою, і той самий
        // хелпер: для платника ПДВ податок виділяється й іде в кредит, для
        // єдинника лишається в ціні та в собівартості.
        const vat = calcPurchaseVat(Number(line.unit_price), {
          buyerIsVatPayer: doc.buyer_is_vat_payer,
          supplierIsVatPayer: doc.supplier_is_vat_payer,
          itemVatRate: Number(line.vat_rate),
          pricesIncludeVat: doc.prices_include_vat,
        });
        const qtyValue = round3(Number(line.qty));
        const net = round2(vat.unitCost * qtyValue);
        creditBase += round2((vat.gross - vat.credit) * qtyValue);
        creditVat += round2(vat.credit * qtyValue);

        if (line.kind === 'service') {
          await c.query(
            `insert into expenses
               (legal_entity_id, category, spent_on, description, amount_net, vat_amount,
                supplier_id, cost_behavior, receipt_id, item_id, created_by)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              doc.legal_entity_id,
              line.category,
              doc.received_on,
              `${line.description} (${doc.number})`,
              net,
              round2(vat.credit * qtyValue),
              doc.supplier_id,
              line.cost_behavior,
              doc.id,
              line.item_id,
              session.uid,
            ],
          );
          continue;
        }

        const batchCode = line.batch_code || `${doc.number}/${line.sku}`;
        const expiresOn =
          line.expires_on ??
          (line.shelf_life_days
            ? new Date(
                new Date(doc.received_on).getTime() + line.shelf_life_days * 86_400_000,
              )
                .toISOString()
                .slice(0, 10)
            : null);

        const { rows: batchRows } = await c.query<{ id: string }>(
          `insert into batches (item_id, code, produced_on, expires_on, source)
           values ($1, $2, $3, $4, 'purchase')
           on conflict (item_id, code) do update set expires_on = excluded.expires_on
           returning id`,
          [line.item_id, batchCode, doc.received_on, expiresOn],
        );

        if (line.quality_control) {
          await c.query(
            `update batches set quality_status = 'quarantine',
                    quality_note = 'Очікує вхідного контролю'
              where id = $1 and quality_status <> 'rejected'`,
            [batchRows[0].id],
          );
          controlled.push({ batchId: batchRows[0].id, itemId: line.item_id!, qty: qtyValue });
        }

        await insertMoves(c, [
          {
            itemId: line.item_id!,
            legalEntityId: doc.legal_entity_id,
            batchId: batchRows[0].id,
            warehouseId,
            qty: qtyValue,
            unitCost: vat.unitCost,
            moveType: 'purchase_receipt',
            docType: 'receipt',
            docId: doc.id,
            userId: session.uid,
            note: `Надходження ${doc.number}`,
          },
        ]);
      }

      if (round2(creditVat) > 0) {
        await c.query(
          `insert into vat_entries
             (legal_entity_id, kind, doc_type, doc_id, doc_number, occurred_on,
              base_amount, vat_amount, vat_rate, counterparty_name, counterparty_edrpou, note)
           values ($1, 'credit', 'receipt', $2, $3, $4, $5, $6, 20, $7, $8, $9)`,
          [
            doc.legal_entity_id,
            doc.id,
            doc.supplier_doc_number ?? doc.number,
            doc.received_on,
            round2(creditBase),
            round2(creditVat),
            doc.supplier_name,
            doc.supplier_edrpou,
            'Надходження без заявки',
          ],
        );
      }

      if (controlled.length > 0) {
        const actNumber = await nextDocNumber(c, doc.legal_entity_id, 'ВХК');
        const { rows: actRows } = await c.query<{ id: string }>(
          `insert into incoming_inspections
             (number, legal_entity_id, supplier_id, received_on, created_by)
           values ($1, $2, $3, $4, $5) returning id`,
          [actNumber, doc.legal_entity_id, doc.supplier_id, doc.received_on, session.uid],
        );
        for (const b of controlled) {
          await c.query(
            `insert into incoming_inspection_lines (inspection_id, batch_id, item_id, qty)
             values ($1, $2, $3, $4)
             on conflict (inspection_id, batch_id) do update
               set qty = incoming_inspection_lines.qty + excluded.qty`,
            [actRows[0].id, b.batchId, b.itemId, b.qty],
          );
        }
      }

      await c.query(
        "update receipts set status = 'posted', posted_at = now() where id = $1",
        [receiptId],
      );
      await c.query(
        `insert into audit_log (user_id, action, entity, entity_id, details)
         values ($1, 'post', 'receipt', $2, $3)`,
        [session.uid, receiptId, JSON.stringify({ lines: lines.length, net: round2(creditBase) })],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/receipts/${receiptId}`);
  revalidatePath('/receipts');
  revalidatePath('/stock');
  revalidatePath('/quality');
  return { ok: 'Надходження проведено' };
}

/**
 * Скасування проведеного документа прибирає за собою все: рухи складу,
 * витрати й податковий кредит. Партії лишаються — вони можуть бути вже
 * витрачені, та й код партії з документа постачальника нікуди не зникає.
 */
export async function cancelReceipt(formData: FormData) {
  const session = await requireRole('warehouse');
  const receiptId = str(formData, 'receipt_id');

  await transaction(async (c) => {
    const { rows } = await c.query<{ status: string }>(
      'select status from receipts where id = $1 and legal_entity_id = $2 for update',
      [receiptId, session.eid],
    );
    if (!rows[0]) return;

    if (rows[0].status === 'posted') {
      // Списану сировину скасуванням не повернеш — спершу перевіряємо, чи
      // партії ще цілі, інакше залишок пішов би в мінус.
      const { rows: used } = await c.query<{ n: number }>(
        `select count(*)::int as n
           from stock_moves m
          where m.batch_id in (
                  select batch_id from stock_moves
                   where doc_type = 'receipt' and doc_id = $1
                )
            and not (m.doc_type = 'receipt' and m.doc_id = $1)`,
        [receiptId],
      );
      if (used[0].n > 0) {
        throw new Error(
          'Партії з цього надходження вже рухалися далі. Скасування зробило б залишок недостовірним — оформіть повернення постачальнику.',
        );
      }

      await c.query("delete from stock_moves where doc_type = 'receipt' and doc_id = $1", [receiptId]);
      await c.query("delete from vat_entries where doc_type = 'receipt' and doc_id = $1", [receiptId]);
      await c.query('delete from expenses where receipt_id = $1', [receiptId]);
    }

    await c.query("update receipts set status = 'cancelled', posted_at = null where id = $1", [
      receiptId,
    ]);
    await c.query(
      `insert into audit_log (user_id, action, entity, entity_id, details)
       values ($1, 'cancel', 'receipt', $2, '{}'::jsonb)`,
      [session.uid, receiptId],
    );
  });

  revalidatePath(`/receipts/${receiptId}`);
  revalidatePath('/receipts');
  revalidatePath('/stock');
}
