'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { transaction } from '@/lib/db';
import { type ActionState, num, str, strOrNull, toMessage } from '@/lib/action-state';
import { defaultWarehouseId, insertMoves, nextDocNumber, round3 } from '@/lib/stock';
import { requireRole } from '@/lib/session';

export async function createSupplier(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('warehouse');
  const name = str(formData, 'name');
  if (!name) return { error: 'Вкажіть назву постачальника' };

  try {
    await transaction((c) =>
      c.query(
        `insert into suppliers (name, edrpou, contact, phone, payment_terms_days, note)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          name,
          strOrNull(formData, 'edrpou'),
          strOrNull(formData, 'contact'),
          strOrNull(formData, 'phone'),
          num(formData, 'payment_terms_days'),
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

export async function createPurchaseOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('warehouse');
  const supplierId = str(formData, 'supplier_id');
  if (!supplierId) return { error: 'Оберіть постачальника' };

  let poId: string;
  try {
    poId = await transaction(async (c) => {
      const number = await nextDocNumber(c, 'ЗАК');
      const { rows } = await c.query<{ id: string }>(
        `insert into purchase_orders (number, supplier_id, expected_on, note, created_by)
         values ($1, $2, $3, $4, $5) returning id`,
        [number, supplierId, strOrNull(formData, 'expected_on'), strOrNull(formData, 'note'), session.uid],
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

      await c.query(
        'insert into purchase_order_lines (po_id, item_id, qty, unit_price) values ($1, $2, $3, $4)',
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
 * Оприбуткування сировини: на кожну позицію заводимо партію з терміном придатності
 * і кладемо рух приходу за ціною із заявки. Саме тут у систему потрапляє собівартість.
 */
export async function receivePurchaseOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('warehouse');
  const poId = str(formData, 'po_id');
  const receivedOn = str(formData, 'received_on') || new Date().toISOString().slice(0, 10);

  try {
    await transaction(async (c) => {
      const { rows: poRows } = await c.query<{ number: string; status: string }>(
        'select number, status from purchase_orders where id = $1 for update',
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
        sku: string;
        name: string;
        shelf_life_days: number | null;
      }>(
        `select l.id, l.item_id, l.qty, l.received_qty, l.unit_price, i.sku, i.name, i.shelf_life_days
           from purchase_order_lines l join items i on i.id = l.item_id
          where l.po_id = $1
          order by i.name`,
        [poId],
      );

      const warehouseId = await defaultWarehouseId(c, 'raw');
      let received = 0;

      for (const line of lines) {
        const qty = round3(num(formData, `qty_${line.id}`));
        if (qty <= 0) continue;
        if (line.received_qty + qty > line.qty + 0.0005) {
          throw new Error(`«${line.name}»: прийнято більше, ніж замовлено`);
        }

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

        await insertMoves(c, [
          {
            itemId: line.item_id,
            batchId: batchRows[0].id,
            warehouseId,
            qty,
            unitCost: line.unit_price,
            moveType: 'purchase_receipt',
            docType: 'purchase_order',
            docId: poId,
            userId: session.uid,
            note: `Прихід за ${po.number}`,
          },
        ]);

        await c.query('update purchase_order_lines set received_qty = received_qty + $2 where id = $1', [
          line.id,
          qty,
        ]);
        received += 1;
      }

      if (received === 0) throw new Error('Не вказано жодної кількості до приходу');

      const { rows: leftRows } = await c.query<{ left: number }>(
        'select coalesce(sum(qty - received_qty), 0) as left from purchase_order_lines where po_id = $1',
        [poId],
      );
      const status = leftRows[0].left <= 0.0005 ? 'received' : 'ordered';
      await c.query('update purchase_orders set status = $2 where id = $1', [poId, status]);

      await c.query(
        `insert into audit_log (user_id, action, entity, entity_id, details)
         values ($1, 'receive', 'purchase_order', $2, $3)`,
        [session.uid, poId, JSON.stringify({ received_on: receivedOn, lines: received })],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/purchasing/${poId}`);
  revalidatePath('/stock');
  return { ok: 'Прихід оприбутковано' };
}
