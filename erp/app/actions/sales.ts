'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { transaction } from '@/lib/db';
import { type ActionState, num, str, strOrNull, toMessage } from '@/lib/action-state';
import { allocateFefo, defaultWarehouseId, insertMoves, nextDocNumber, round3 } from '@/lib/stock';
import { requireRole } from '@/lib/session';

export async function createCustomer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('sales');
  const name = str(formData, 'name');
  if (!name) return { error: 'Вкажіть назву клієнта' };

  try {
    await transaction((c) =>
      c.query(
        `insert into customers (name, kind, edrpou, contact, phone, price_level, payment_terms_days, credit_limit, note)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          name,
          str(formData, 'kind') || 'network',
          strOrNull(formData, 'edrpou'),
          strOrNull(formData, 'contact'),
          strOrNull(formData, 'phone'),
          str(formData, 'price_level') || 'distributor',
          num(formData, 'payment_terms_days'),
          num(formData, 'credit_limit'),
          strOrNull(formData, 'note'),
        ],
      ),
    );
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/sales/customers');
  return { ok: 'Клієнта додано' };
}

export async function createSalesOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('sales');
  const customerId = str(formData, 'customer_id');
  if (!customerId) return { error: 'Оберіть клієнта' };

  let soId: string;
  try {
    soId = await transaction(async (c) => {
      const number = await nextDocNumber(c, 'ЗАМ');
      const { rows } = await c.query<{ id: string }>(
        `insert into sales_orders (number, customer_id, ship_by, note, created_by)
         values ($1, $2, $3, $4, $5) returning id`,
        [number, customerId, strOrNull(formData, 'ship_by'), strOrNull(formData, 'note'), session.uid],
      );
      return rows[0].id;
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  redirect(`/sales/${soId}`);
}

export async function addSalesLine(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('sales');
  const soId = str(formData, 'so_id');
  const itemId = str(formData, 'item_id');
  const qty = num(formData, 'qty');

  if (!itemId) return { error: 'Оберіть товар' };
  if (qty <= 0) return { error: 'Кількість має бути більшою за нуль' };

  try {
    await transaction(async (c) => {
      const { rows: orderRows } = await c.query<{ status: string; price_level: string }>(
        `select o.status, c.price_level
           from sales_orders o join customers c on c.id = o.customer_id
          where o.id = $1`,
        [soId],
      );
      const order = orderRows[0];
      if (!order) throw new Error('Замовлення не знайдено');
      if (order.status !== 'draft') throw new Error('Позиції можна додавати лише в чернетку');

      // Ціну беремо з прайсу за рівнем клієнта, але менеджер може перекрити її вручну.
      let price = num(formData, 'unit_price', 0);
      if (price <= 0) {
        const column =
          order.price_level === 'rrp'
            ? 'price_rrp'
            : order.price_level === 'network'
              ? 'price_network'
              : 'price_distributor';
        const { rows: itemRows } = await c.query<{ price: number | null }>(
          `select ${column} as price from items where id = $1`,
          [itemId],
        );
        price = itemRows[0]?.price ?? 0;
        if (price <= 0) throw new Error('Для цього товару не заданий прайс — вкажіть ціну вручну');
      }

      await c.query(
        'insert into sales_order_lines (so_id, item_id, qty, unit_price) values ($1, $2, $3, $4)',
        [soId, itemId, qty, price],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/sales/${soId}`);
  return { ok: 'Позицію додано' };
}

export async function removeSalesLine(formData: FormData) {
  await requireRole('sales');
  const soId = str(formData, 'so_id');
  await transaction((c) =>
    c.query(
      `delete from sales_order_lines l using sales_orders o
        where l.id = $1 and l.so_id = o.id and o.status = 'draft'`,
      [str(formData, 'line_id')],
    ),
  );
  revalidatePath(`/sales/${soId}`);
}

/** Підтвердження ставить товар у резерв — він перестає бути доступним іншим замовленням. */
export async function confirmSalesOrder(formData: FormData) {
  await requireRole('sales');
  const soId = str(formData, 'so_id');
  await transaction(async (c) => {
    const { rows } = await c.query<{ count: number }>(
      'select count(*)::int as count from sales_order_lines where so_id = $1',
      [soId],
    );
    if (rows[0].count === 0) throw new Error('У замовленні немає позицій');
    await c.query("update sales_orders set status = 'confirmed' where id = $1 and status = 'draft'", [soId]);
  });
  revalidatePath(`/sales/${soId}`);
}

export async function cancelSalesOrder(formData: FormData) {
  await requireRole('sales');
  const soId = str(formData, 'so_id');
  await transaction((c) =>
    c.query(
      "update sales_orders set status = 'cancelled' where id = $1 and status in ('draft','confirmed')",
      [soId],
    ),
  );
  revalidatePath(`/sales/${soId}`);
}

/**
 * Відвантаження: підбирає партії за FEFO, списує їх зі складу готової продукції
 * і фіксує собівартість саме тих партій, що поїхали клієнту. Звідси береться маржа.
 */
export async function shipSalesOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('sales', 'warehouse');
  const soId = str(formData, 'so_id');
  const shippedOn = str(formData, 'shipped_on') || new Date().toISOString().slice(0, 10);

  try {
    await transaction(async (c) => {
      const { rows: orderRows } = await c.query<{ number: string; status: string }>(
        'select number, status from sales_orders where id = $1 for update',
        [soId],
      );
      const order = orderRows[0];
      if (!order) throw new Error('Замовлення не знайдено');
      if (order.status === 'cancelled') throw new Error('Замовлення скасоване');
      if (order.status === 'draft') throw new Error('Спершу підтвердіть замовлення');

      const { rows: lines } = await c.query<{
        id: string;
        item_id: string;
        qty: number;
        shipped_qty: number;
        name: string;
      }>(
        `select l.id, l.item_id, l.qty, l.shipped_qty, i.name
           from sales_order_lines l join items i on i.id = l.item_id
          where l.so_id = $1 order by i.name`,
        [soId],
      );

      const warehouseId = await defaultWarehouseId(c, 'finished');
      const number = await nextDocNumber(c, 'ВІД');

      const { rows: shipmentRows } = await c.query<{ id: string }>(
        `insert into shipments (number, so_id, shipped_on, ttn_number, carrier, created_by)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [
          number,
          soId,
          shippedOn,
          strOrNull(formData, 'ttn_number'),
          strOrNull(formData, 'carrier'),
          session.uid,
        ],
      );
      const shipmentId = shipmentRows[0].id;

      let shippedLines = 0;
      for (const line of lines) {
        const remaining = round3(line.qty - line.shipped_qty);
        const qty = round3(num(formData, `qty_${line.id}`, remaining));
        if (qty <= 0) continue;
        if (qty > remaining + 0.0005) {
          throw new Error(`«${line.name}»: відвантажується більше, ніж у замовленні`);
        }

        const allocations = await allocateFefo(c, line.item_id, warehouseId, qty);
        for (const a of allocations) {
          await insertMoves(c, [
            {
              itemId: line.item_id,
              batchId: a.batchId,
              warehouseId,
              qty: -a.qty,
              unitCost: a.unitCost,
              moveType: 'sale_shipment',
              docType: 'shipment',
              docId: shipmentId,
              userId: session.uid,
              note: `Відвантаження ${number}`,
            },
          ]);
        }

        await c.query(
          'insert into shipment_lines (shipment_id, so_line_id, item_id, qty) values ($1, $2, $3, $4)',
          [shipmentId, line.id, line.item_id, qty],
        );
        await c.query('update sales_order_lines set shipped_qty = shipped_qty + $2 where id = $1', [
          line.id,
          qty,
        ]);
        shippedLines += 1;
      }

      if (shippedLines === 0) throw new Error('Не вказано жодної кількості до відвантаження');

      const { rows: leftRows } = await c.query<{ left: number }>(
        'select coalesce(sum(qty - shipped_qty), 0) as left from sales_order_lines where so_id = $1',
        [soId],
      );
      if (leftRows[0].left <= 0.0005) {
        await c.query("update sales_orders set status = 'shipped' where id = $1", [soId]);
      }

      await c.query(
        `insert into audit_log (user_id, action, entity, entity_id, details)
         values ($1, 'ship', 'sales_order', $2, $3)`,
        [session.uid, soId, JSON.stringify({ shipment: number, lines: shippedLines })],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/sales/${soId}`);
  revalidatePath('/stock');
  return { ok: 'Відвантаження проведено' };
}

export async function recordPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('sales');
  const amount = num(formData, 'amount');
  const customerId = str(formData, 'customer_id');
  if (!customerId) return { error: 'Оберіть клієнта' };
  if (amount === 0) return { error: 'Вкажіть суму оплати' };

  const soId = strOrNull(formData, 'so_id');
  try {
    await transaction((c) =>
      c.query(
        `insert into payments (customer_id, so_id, paid_on, amount, method, note, created_by)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          customerId,
          soId,
          str(formData, 'paid_on') || new Date().toISOString().slice(0, 10),
          amount,
          str(formData, 'method') || 'bank',
          strOrNull(formData, 'note'),
          session.uid,
        ],
      ),
    );
  } catch (err) {
    return { error: toMessage(err) };
  }

  if (soId) revalidatePath(`/sales/${soId}`);
  revalidatePath('/sales/customers');
  return { ok: 'Оплату записано' };
}
