'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { transaction } from '@/lib/db';
import { type ActionState, str, strOrNull, toMessage } from '@/lib/action-state';
import { allocateFefo, defaultWarehouseId, insertMoves, nextDocNumber, round2, round3 } from '@/lib/stock';
import { EXPENSE_CATEGORIES } from '@/lib/format';
import { resolveEntityId } from '@/lib/doc-entity';
import { requireRole } from '@/lib/session';

/**
 * Акт списання — повноцінний документ: багато рядків, стаття витрат,
 * чернетка → проведення, скасування, Дт/Кт і друкована форма.
 *
 * Стаття витрат — головна причина існування акта: списання блогерам — це
 * маркетинг, псування — «псування і втрати». У фінрезультаті сума йде за
 * статтею, а проводка — Дт рахунок статті, Кт запаси.
 */
export async function createWriteOff(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('warehouse', 'production');
  const category = str(formData, 'category');
  if (!EXPENSE_CATEGORIES[category]) return { error: 'Оберіть статтю витрат' };

  let docId: string;
  try {
    docId = await transaction(async (c) => {
      const entityId = await resolveEntityId(c, formData, session.eid);
      const number = await nextDocNumber(c, entityId, 'СПС');
      const { rows } = await c.query<{ id: string }>(
        `insert into write_offs
           (number, legal_entity_id, warehouse_id, category, reason, written_off_on, note, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [
          number,
          entityId,
          strOrNull(formData, 'warehouse_id'),
          category,
          strOrNull(formData, 'reason'),
          str(formData, 'written_off_on') || new Date().toISOString().slice(0, 10),
          strOrNull(formData, 'note'),
          session.uid,
        ],
      );
      return rows[0].id;
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  redirect(`/writeoffs/${docId}`);
}

async function assertDraft(c: import('pg').PoolClient, docId: string) {
  const { rows } = await c.query<{ status: string }>('select status from write_offs where id = $1', [
    docId,
  ]);
  if (!rows[0]) throw new Error('Документ не знайдено');
  if (rows[0].status !== 'draft') throw new Error('Акт уже проведено — змінювати не можна');
}

export async function updateWriteOffHeader(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('warehouse', 'production');
  const docId = str(formData, 'write_off_id');
  const category = str(formData, 'category');
  if (!EXPENSE_CATEGORIES[category]) return { error: 'Оберіть статтю витрат' };

  try {
    await transaction(async (c) => {
      await assertDraft(c, docId);
      await c.query(
        `update write_offs set
           written_off_on = $2, category = $3, reason = $4, warehouse_id = $5, note = $6
         where id = $1`,
        [
          docId,
          str(formData, 'written_off_on') || new Date().toISOString().slice(0, 10),
          category,
          strOrNull(formData, 'reason'),
          strOrNull(formData, 'warehouse_id'),
          strOrNull(formData, 'note'),
        ],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/writeoffs/${docId}`);
  return { ok: 'Шапку збережено' };
}

/** Пакетне збереження рядків — таблиця, як у надходженні, лише без цін. */
export async function saveWriteOffLines(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('warehouse', 'production');
  const docId = str(formData, 'write_off_id');

  let lines: { item_id: string; qty: number; note: string }[];
  try {
    lines = JSON.parse(str(formData, 'lines'));
  } catch {
    return { error: 'Не вдалося прочитати рядки — оновіть сторінку і спробуйте ще раз' };
  }
  if (!Array.isArray(lines) || lines.length === 0) return { error: 'В акті немає жодного рядка' };
  if (lines.length > 200) return { error: 'Забагато рядків за раз — розбийте на два акти' };

  let saved = 0;
  try {
    await transaction(async (c) => {
      await assertDraft(c, docId);
      for (const [i, line] of lines.entries()) {
        const row = i + 1;
        const qty = Number(line.qty);
        if (!line.item_id) throw new Error(`Рядок ${row}: не обрано номенклатуру`);
        if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Рядок ${row}: кількість має бути більшою за нуль`);

        const { rows: items } = await c.query<{ kind: string }>(
          'select kind from items where id = $1 and is_active',
          [line.item_id],
        );
        if (!items[0]) throw new Error(`Рядок ${row}: позицію не знайдено`);
        if (items[0].kind === 'service') {
          throw new Error(`Рядок ${row}: послуги не лежать на складі — їх нема з чого списувати`);
        }

        await c.query(
          'insert into write_off_lines (write_off_id, item_id, qty, note) values ($1, $2, $3, $4)',
          [docId, line.item_id, qty, String(line.note ?? '').trim() || null],
        );
        saved += 1;
      }
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/writeoffs/${docId}`);
  return { ok: `Додано рядків: ${saved}` };
}

export async function removeWriteOffLine(formData: FormData) {
  await requireRole('warehouse', 'production');
  const docId = str(formData, 'write_off_id');
  await transaction(async (c) => {
    await assertDraft(c, docId);
    await c.query('delete from write_off_lines where id = $1', [str(formData, 'line_id')]);
  });
  revalidatePath(`/writeoffs/${docId}`);
}

/**
 * Проведення: FEFO-списання партій, витрата за статтею акта на суму
 * собівартості, а для безоплатної передачі платником ПДВ — податкове
 * зобов'язання з мінбази (не нижче собівартості, п. 188.1 ПКУ).
 */
export async function postWriteOff(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('warehouse', 'production');
  const docId = str(formData, 'write_off_id');

  try {
    await transaction(async (c) => {
      await postWriteOffCore(c, session.uid, docId);
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/writeoffs/${docId}`);
  revalidatePath('/writeoffs');
  revalidatePath('/stock');
  return { ok: 'Акт проведено' };
}

async function postWriteOffCore(c: import('pg').PoolClient, uid: string, docId: string) {
  const { rows: docs } = await c.query<{
    id: string;
    number: string;
    status: string;
    legal_entity_id: string;
    warehouse_id: string | null;
    category: string;
    reason: string | null;
    written_off_on: string;
    so_id: string | null;
    entity_is_vat_payer: boolean;
  }>(
    `select w.*, e.is_vat_payer as entity_is_vat_payer
       from write_offs w join legal_entities e on e.id = w.legal_entity_id
      where w.id = $1 for update of w`,
    [docId],
  );
  const doc = docs[0];
  if (!doc) throw new Error('Документ не знайдено');
  if (doc.status === 'posted') throw new Error('Акт уже проведено');
  if (doc.status === 'cancelled') throw new Error('Акт скасовано');

  const { rows: lines } = await c.query<{ item_id: string; qty: number; note: string | null; name: string }>(
    `select l.item_id, l.qty, l.note, i.name
       from write_off_lines l join items i on i.id = l.item_id
      where l.write_off_id = $1`,
    [docId],
  );
  if (lines.length === 0) throw new Error('В акті немає жодного рядка');

  const warehouseId = doc.warehouse_id ?? (await defaultWarehouseId(c, 'finished'));
  let totalCost = 0;

  for (const line of lines) {
    const qty = round3(Number(line.qty));
    const allocations = await allocateFefo(c, line.item_id, warehouseId, doc.legal_entity_id, qty);
    for (const a of allocations) {
      totalCost += round2(a.qty * a.unitCost);
      await insertMoves(c, [
        {
          itemId: line.item_id,
          legalEntityId: doc.legal_entity_id,
          batchId: a.batchId,
          warehouseId,
          qty: -a.qty,
          unitCost: a.unitCost,
          moveType: 'write_off',
          docType: 'write_off_act',
          docId: doc.id,
          userId: uid,
          note: line.note ?? doc.reason ?? `Акт списання ${doc.number}`,
        },
      ]);
    }
  }

  // Витрата за статтею акта: саме так сума потрапляє у фінрезультат.
  await c.query(
    `insert into expenses
       (legal_entity_id, category, spent_on, description, amount_net, vat_amount,
        cost_behavior, write_off_id, created_by)
     values ($1, $2, $3, $4, $5, 0, 'fixed', $6, $7)`,
    [
      doc.legal_entity_id,
      doc.category,
      doc.written_off_on,
      `Акт списання ${doc.number}${doc.reason ? ` — ${doc.reason}` : ''}`,
      round2(totalCost),
      doc.id,
      uid,
    ],
  );

  // Безоплатна передача платником ПДВ — постачання з мінбазою.
  // Внутрішнє псування зобов'язання тут не створює.
  if (doc.so_id && doc.entity_is_vat_payer && totalCost > 0.005) {
    await c.query(
      `insert into vat_entries
         (legal_entity_id, kind, doc_type, doc_id, doc_number, occurred_on,
          base_amount, vat_amount, vat_rate, counterparty_name, note)
       values ($1, 'liability', 'write_off_act', $2, $3, $4, $5, $6, 20, $7, $8)`,
      [
        doc.legal_entity_id,
        doc.id,
        doc.number,
        doc.written_off_on,
        round2(totalCost),
        round2(totalCost * 0.2),
        'Безоплатна передача',
        'База не нижче собівартості — п. 188.1 ПКУ',
      ],
    );
  }

  await c.query("update write_offs set status = 'posted', posted_at = now() where id = $1", [docId]);
  await c.query(
    `insert into audit_log (user_id, action, entity, entity_id, details)
     values ($1, 'post', 'write_off', $2, $3)`,
    [uid, docId, JSON.stringify({ lines: lines.length, cost: round2(totalCost) })],
  );
}

/** Скасування прибирає за собою рухи, витрату і ПДВ-запис. */
export async function cancelWriteOff(formData: FormData) {
  const session = await requireRole('warehouse', 'production');
  const docId = str(formData, 'write_off_id');

  await transaction(async (c) => {
    const { rows } = await c.query<{ status: string }>(
      'select status from write_offs where id = $1 for update',
      [docId],
    );
    if (!rows[0]) return;

    if (rows[0].status === 'posted') {
      await c.query("delete from stock_moves where doc_type = 'write_off_act' and doc_id = $1", [docId]);
      await c.query('delete from expenses where write_off_id = $1', [docId]);
      await c.query("delete from vat_entries where doc_type = 'write_off_act' and doc_id = $1", [docId]);
    }
    await c.query("update write_offs set status = 'cancelled', posted_at = null where id = $1", [docId]);
    await c.query(
      `insert into audit_log (user_id, action, entity, entity_id, details)
       values ($1, 'cancel', 'write_off', $2, '{}'::jsonb)`,
      [session.uid, docId],
    );
  });

  revalidatePath(`/writeoffs/${docId}`);
  revalidatePath('/writeoffs');
  revalidatePath('/stock');
}

/**
 * Безоплатна відправка на основі замовлення — сценарій «відправити блогерам»:
 * із замовлення одним рухом створюються відвантаження (для друку ТТН і
 * видаткової) та проведений акт списання за обраною статтею.
 *
 * Ціни рядків замовлення обнуляються: виручки, дебіторки й ПДВ із продажу
 * немає ніде — собівартість іде у витрати за статтею (типово маркетинг).
 */
export async function giftShipFromOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('sales', 'warehouse');
  const soId = str(formData, 'so_id');
  const category = str(formData, 'category') || 'marketing';
  if (!EXPENSE_CATEGORIES[category]) return { error: 'Оберіть статтю витрат' };

  let docId = '';
  try {
    await transaction(async (c) => {
      const { rows: orders } = await c.query<{
        id: string;
        number: string;
        status: string;
        legal_entity_id: string;
        customer_name: string;
      }>(
        `select o.id, o.number, o.status, o.legal_entity_id, c.name as customer_name
           from sales_orders o join customers c on c.id = o.customer_id
          where o.id = $1 for update of o`,
        [soId],
      );
      const order = orders[0];
      if (!order) throw new Error('Замовлення не знайдено');
      if (!['draft', 'confirmed'].includes(order.status)) {
        throw new Error('Безоплатною можна зробити лише невідвантажене замовлення');
      }

      const { rows: lines } = await c.query<{ id: string; item_id: string; qty: number; shipped_qty: number }>(
        'select id, item_id, qty, shipped_qty from sales_order_lines where so_id = $1',
        [soId],
      );
      // Відкриті кількості фіксуємо до будь-яких оновлень shipped_qty:
      // ці ж числа підуть і у відвантаження, і в рядки акта.
      const open = lines
        .map((l) => ({ ...l, openQty: round3(Number(l.qty) - Number(l.shipped_qty)) }))
        .filter((l) => l.openQty > 0.0005);
      if (open.length === 0) throw new Error('У замовленні немає невідвантажених рядків');

      // Безоплатно — означає безоплатно: ціни обнуляються, виручки не буде.
      await c.query('update sales_order_lines set unit_price = 0, vat_rate = 0 where so_id = $1', [soId]);

      const today = new Date().toISOString().slice(0, 10);

      // Відвантаження — заради друкованих форм: ТТН і видаткової накладної.
      const shipNumber = await nextDocNumber(c, order.legal_entity_id, 'ВІД');
      const { rows: shipRows } = await c.query<{ id: string }>(
        `insert into shipments (number, so_id, shipped_on, created_by)
         values ($1, $2, $3, $4) returning id`,
        [shipNumber, soId, today, session.uid],
      );
      for (const l of open) {
        await c.query(
          'insert into shipment_lines (shipment_id, so_line_id, item_id, qty) values ($1, $2, $3, $4)',
          [shipRows[0].id, l.id, l.item_id, l.openQty],
        );
        await c.query('update sales_order_lines set shipped_qty = shipped_qty + $2 where id = $1', [
          l.id,
          l.openQty,
        ]);
      }
      await c.query("update sales_orders set status = 'shipped' where id = $1", [soId]);

      // Акт списання: рядки з замовлення, стаття — з форми.
      const woNumber = await nextDocNumber(c, order.legal_entity_id, 'СПС');
      const { rows: woRows } = await c.query<{ id: string }>(
        `insert into write_offs
           (number, legal_entity_id, warehouse_id, category, reason, written_off_on,
            so_id, shipment_id, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [
          woNumber,
          order.legal_entity_id,
          await defaultWarehouseId(c, 'finished'),
          category,
          `Безоплатна відправка: ${order.customer_name} (${order.number})`,
          today,
          soId,
          shipRows[0].id,
          session.uid,
        ],
      );
      docId = woRows[0].id;

      for (const l of open) {
        await c.query(
          'insert into write_off_lines (write_off_id, item_id, qty) values ($1, $2, $3)',
          [docId, l.item_id, l.openQty],
        );
      }

      await postWriteOffCore(c, session.uid, docId);
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  redirect(`/writeoffs/${docId}`);
}
