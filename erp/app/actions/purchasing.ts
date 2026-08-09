'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { transaction } from '@/lib/db';
import { type ActionState, num, str, strOrNull, toMessage } from '@/lib/action-state';
import { defaultWarehouseId, insertMoves, nextDocNumber, round2, round3 } from '@/lib/stock';
import { calcPurchaseVat } from '@/lib/vat';
import { requireRole } from '@/lib/session';

export async function createSupplier(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('warehouse');
  const name = str(formData, 'name');
  if (!name) return { error: 'Вкажіть назву постачальника' };

  try {
    await transaction((c) =>
      c.query(
        `insert into suppliers (name, edrpou, contact, phone, payment_terms_days, is_vat_payer, note)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          name,
          strOrNull(formData, 'edrpou'),
          strOrNull(formData, 'contact'),
          strOrNull(formData, 'phone'),
          num(formData, 'payment_terms_days'),
          formData.get('is_vat_payer') === 'on',
          strOrNull(formData, 'note'),
        ],
      ),
    );
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/purchasing/suppliers');
  return { ok: 'Постачальника додано' };
}

/**
 * Редагування постачальника. Статус платника ПДВ впливає лише на нові приходи:
 * у вже оприбуткованих партіях собівартість і податковий кредит порахувалися
 * за статусом на дату документа й переписуванню не підлягають.
 */
export async function updateSupplier(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('warehouse');
  const id = str(formData, 'supplier_id');
  const name = str(formData, 'name');

  if (!id) return { error: 'Не вказано постачальника' };
  if (!name) return { error: 'Вкажіть назву постачальника' };

  try {
    await transaction((c) =>
      c.query(
        `update suppliers set
           name = $2, edrpou = $3, contact = $4, phone = $5,
           payment_terms_days = $6, is_vat_payer = $7, note = $8,
           is_approved = $9,
           -- Дату затвердження ставимо один раз, коли постачальник уперше
           -- потрапив у перелік: вона доводить, що оцінка була.
           approved_on = case when $9 then coalesce(approved_on, current_date) else approved_on end,
           approved_until = $10, approval_note = $11
         where id = $1`,
        [
          id,
          name,
          strOrNull(formData, 'edrpou'),
          strOrNull(formData, 'contact'),
          strOrNull(formData, 'phone'),
          num(formData, 'payment_terms_days'),
          formData.get('is_vat_payer') === 'on',
          strOrNull(formData, 'note'),
          formData.get('is_approved') === 'on',
          strOrNull(formData, 'approved_until'),
          strOrNull(formData, 'approval_note'),
        ],
      ),
    );
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/purchasing/suppliers');
  revalidatePath(`/purchasing/suppliers/${id}`);
  return { ok: 'Збережено' };
}

/**
 * Деактивація замість видалення. Постачальника з непогашеною кредиторкою
 * ховати не можна: борг зникне зі списку, а платити його доведеться.
 */
export async function setSupplierActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('warehouse');
  const id = str(formData, 'supplier_id');
  const active = str(formData, 'active') === 'true';

  try {
    await transaction(async (c) => {
      if (!active) {
        // Борг перевіряємо по всіх юрособах, а не лише по поточній.
        const { rows } = await c.query<{ due: number }>(
          'select coalesce(sum(balance_due), 0) as due from v_supplier_balance where supplier_id = $1',
          [id],
        );
        if (Number(rows[0]?.due ?? 0) > 0.01) {
          throw new Error(
            `Не можна деактивувати: непогашена кредиторка ${Number(rows[0].due).toFixed(2)} грн.`,
          );
        }
      }
      await c.query('update suppliers set is_active = $2 where id = $1', [id, active]);
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/purchasing/suppliers');
  revalidatePath(`/purchasing/suppliers/${id}`);
  return { ok: active ? 'Постачальника активовано' : 'Постачальника деактивовано' };
}

export async function createPurchaseOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('warehouse');
  const supplierId = str(formData, 'supplier_id');
  if (!supplierId) return { error: 'Оберіть постачальника' };

  let poId: string;
  try {
    poId = await transaction(async (c) => {
      const number = await nextDocNumber(c, session.eid, 'ЗАК');
      const { rows } = await c.query<{ id: string }>(
        `insert into purchase_orders
           (number, legal_entity_id, supplier_id, expected_on, note, prices_include_vat, created_by)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [
          number,
          session.eid,
          supplierId,
          strOrNull(formData, 'expected_on'),
          strOrNull(formData, 'note'),
          formData.get('prices_include_vat') !== 'off',
          session.uid,
        ],
      );
      return rows[0].id;
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  redirect(`/purchasing/${poId}`);
}

export async function addPurchaseLine(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('warehouse');
  const poId = str(formData, 'po_id');
  const itemId = str(formData, 'item_id');
  const qty = num(formData, 'qty');
  const price = num(formData, 'unit_price');

  if (!itemId) return { error: 'Оберіть номенклатуру' };
  if (qty <= 0) return { error: 'Кількість має бути більшою за нуль' };

  try {
    await transaction(async (c) => {
      const { rows } = await c.query<{ status: string }>(
        'select status from purchase_orders where id = $1',
        [poId],
      );
      if (rows[0]?.status !== 'draft') throw new Error('Позиції можна додавати лише в чернетку');

      // Ставку фіксуємо на рядку: зміна в довіднику не має переписувати вже виписані документи.
      await c.query(
        `insert into purchase_order_lines (po_id, item_id, qty, unit_price, vat_rate)
         values ($1, $2, $3, $4, (select vat_rate from items where id = $2))`,
        [poId, itemId, qty, price],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/purchasing/${poId}`);
  return { ok: 'Позицію додано' };
}

export async function removePurchaseLine(formData: FormData) {
  await requireRole('warehouse');
  const poId = str(formData, 'po_id');
  await transaction((c) =>
    c.query(
      `delete from purchase_order_lines l using purchase_orders p
        where l.id = $1 and l.po_id = p.id and p.status = 'draft'`,
      [str(formData, 'line_id')],
    ),
  );
  revalidatePath(`/purchasing/${poId}`);
}

export async function markOrdered(formData: FormData) {
  await requireRole('warehouse');
  const poId = str(formData, 'po_id');
  await transaction((c) =>
    c.query("update purchase_orders set status = 'ordered' where id = $1 and status = 'draft'", [poId]),
  );
  revalidatePath(`/purchasing/${poId}`);
}

export async function cancelPurchaseOrder(formData: FormData) {
  await requireRole('warehouse');
  const poId = str(formData, 'po_id');
  await transaction((c) =>
    c.query(
      "update purchase_orders set status = 'cancelled' where id = $1 and status in ('draft','ordered')",
      [poId],
    ),
  );
  revalidatePath(`/purchasing/${poId}`);
}

/**
 * Оприбуткування сировини. Тут вирішується головне питання собівартості:
 * платник ПДВ ставить партію на облік за базою без податку (податок повернеться
 * податковим кредитом), а єдинник — за повною ціною, бо ПДВ постачальника для
 * нього просто витрата. Через це одна й та сама поставка дає різну собівартість
 * різним юрособам.
 */
export async function receivePurchaseOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('warehouse');
  const poId = str(formData, 'po_id');
  const receivedOn = str(formData, 'received_on') || new Date().toISOString().slice(0, 10);

  try {
    await transaction(async (c) => {
      const { rows: poRows } = await c.query<{
        number: string;
        status: string;
        legal_entity_id: string;
        prices_include_vat: boolean;
        buyer_is_vat_payer: boolean;
        supplier_is_vat_payer: boolean;
        supplier_name: string;
        supplier_edrpou: string | null;
        supplier_id: string;
      }>(
        `select p.number, p.status, p.legal_entity_id, p.prices_include_vat,
                e.is_vat_payer as buyer_is_vat_payer,
                s.is_vat_payer as supplier_is_vat_payer,
                s.name as supplier_name, s.edrpou as supplier_edrpou, s.id as supplier_id
           from purchase_orders p
           join legal_entities e on e.id = p.legal_entity_id
           join suppliers s on s.id = p.supplier_id
          where p.id = $1
          for update of p`,
        [poId],
      );
      const po = poRows[0];
      if (!po) throw new Error('Заявку не знайдено');
      if (po.status === 'cancelled') throw new Error('Заявку скасовано');

      const { rows: lines } = await c.query<{
        id: string;
        item_id: string;
        qty: number;
        received_qty: number;
        unit_price: number;
        vat_rate: number;
        sku: string;
        name: string;
        shelf_life_days: number | null;
        quality_control: boolean;
      }>(
        `select l.id, l.item_id, l.qty, l.received_qty, l.unit_price, l.vat_rate,
                i.sku, i.name, i.shelf_life_days, i.quality_control
           from purchase_order_lines l join items i on i.id = l.item_id
          where l.po_id = $1
          order by i.name`,
        [poId],
      );

      const warehouseId = await defaultWarehouseId(c, 'raw');
      let received = 0;
      let creditBase = 0;
      let creditVat = 0;
      // Партії, які підуть у карантин і потраплять до акта вхідного контролю.
      const controlled: { batchId: string; itemId: string; qty: number }[] = [];

      for (const line of lines) {
        const qty = round3(num(formData, `qty_${line.id}`));
        if (qty <= 0) continue;
        if (line.received_qty + qty > line.qty + 0.0005) {
          throw new Error(`«${line.name}»: прийнято більше, ніж замовлено`);
        }

        const vat = calcPurchaseVat(line.unit_price, {
          buyerIsVatPayer: po.buyer_is_vat_payer,
          supplierIsVatPayer: po.supplier_is_vat_payer,
          itemVatRate: line.vat_rate,
          pricesIncludeVat: po.prices_include_vat,
        });

        const batchCode = str(formData, `batch_${line.id}`) || `${po.number}/${line.sku}`;
        const expiresInput = strOrNull(formData, `expires_${line.id}`);
        const expiresOn =
          expiresInput ??
          (line.shelf_life_days
            ? new Date(new Date(receivedOn).getTime() + line.shelf_life_days * 86_400_000)
                .toISOString()
                .slice(0, 10)
            : null);

        const { rows: batchRows } = await c.query<{ id: string }>(
          `insert into batches (item_id, code, produced_on, expires_on, source)
           values ($1, $2, $3, $4, 'purchase')
           on conflict (item_id, code) do update set expires_on = excluded.expires_on
           returning id`,
          [line.item_id, batchCode, receivedOn, expiresOn],
        );

        // Позиція під вхідним контролем стає в карантин на кожному прийманні,
        // а не лише при першому. Довіз під тим самим кодом партії — це нова
        // фізична сировина, і перевіряти її треба заново.
        if (line.quality_control) {
          await c.query(
            `update batches set quality_status = 'quarantine',
                    quality_note = 'Очікує вхідного контролю'
              where id = $1 and quality_status <> 'rejected'`,
            [batchRows[0].id],
          );
          controlled.push({ batchId: batchRows[0].id, itemId: line.item_id, qty });
        }

        await insertMoves(c, [
          {
            itemId: line.item_id,
            legalEntityId: po.legal_entity_id,
            batchId: batchRows[0].id,
            warehouseId,
            qty,
            unitCost: vat.unitCost,
            moveType: 'purchase_receipt',
            docType: 'purchase_order',
            docId: poId,
            userId: session.uid,
            note: `Прихід за ${po.number}`,
          },
        ]);

        creditBase += vat.net * qty;
        creditVat += vat.credit * qty;

        await c.query('update purchase_order_lines set received_qty = received_qty + $2 where id = $1', [
          line.id,
          qty,
        ]);
        received += 1;
      }

      if (received === 0) throw new Error('Не вказано жодної кількості до приходу');

      // Податковий кредит виникає лише у платника і лише від платника.
      if (creditVat > 0.005) {
        await c.query(
          `insert into vat_entries
             (legal_entity_id, kind, doc_type, doc_id, doc_number, occurred_on,
              base_amount, vat_amount, vat_rate, counterparty_name, counterparty_edrpou)
           values ($1, 'credit', 'purchase_order', $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            po.legal_entity_id,
            poId,
            po.number,
            receivedOn,
            round2(creditBase),
            round2(creditVat),
            lines[0]?.vat_rate ?? 20,
            po.supplier_name,
            po.supplier_edrpou,
          ],
        );
      }

      // Акт вхідного контролю створюється сам і одразу на всю поставку:
      // документи постачальник виписує на партію поставки, а машину комірник
      // приймає цілком. Окремий акт на кожне приймання — щоб довіз через
      // тиждень не дописувався в підписаний позаминулий акт.
      if (controlled.length > 0) {
        const actNumber = await nextDocNumber(c, po.legal_entity_id, 'ВХК');
        const { rows: actRows } = await c.query<{ id: string }>(
          `insert into incoming_inspections
             (number, legal_entity_id, po_id, supplier_id, received_on, created_by)
           values ($1, $2, $3, $4, $5, $6) returning id`,
          [actNumber, po.legal_entity_id, poId, po.supplier_id, receivedOn, session.uid],
        );
        for (const b of controlled) {
          await c.query(
            `insert into incoming_inspection_lines (inspection_id, batch_id, item_id, qty)
             values ($1, $2, $3, $4)
             on conflict (inspection_id, batch_id) do update set qty = incoming_inspection_lines.qty + excluded.qty`,
            [actRows[0].id, b.batchId, b.itemId, b.qty],
          );
        }
      }

      const { rows: leftRows } = await c.query<{ left: number }>(
        'select coalesce(sum(qty - received_qty), 0) as left from purchase_order_lines where po_id = $1',
        [poId],
      );
      const status = leftRows[0].left <= 0.0005 ? 'received' : 'ordered';
      await c.query('update purchase_orders set status = $2 where id = $1', [poId, status]);

      await c.query(
        `insert into audit_log (user_id, action, entity, entity_id, details)
         values ($1, 'receive', 'purchase_order', $2, $3)`,
        [session.uid, poId, JSON.stringify({ received_on: receivedOn, lines: received, creditVat })],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/purchasing/${poId}`);
  revalidatePath('/stock');
  revalidatePath('/quality');
  return { ok: 'Прихід оприбутковано' };
}
