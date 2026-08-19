'use server';

import { revalidatePath } from 'next/cache';
import { transaction } from '@/lib/db';
import { type ActionState, num, str, strOrNull, toMessage } from '@/lib/action-state';
import { nextDocNumber } from '@/lib/stock';
import { EXPENSE_CATEGORIES } from '@/lib/format';
import { resolveEntityId } from '@/lib/doc-entity';
import { requireRole } from '@/lib/session';

/**
 * Касові ордери. Ордер — первинний документ каси з номером і друкованою
 * формою, а гроші він проводить через ті самі таблиці, що й банк: тож
 * дебіторка, кредиторка і фінрезультат бачать готівку без нових формул.
 */
export async function createCashOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('sales', 'warehouse');
  const direction = str(formData, 'direction') === 'out' ? 'out' : 'in';
  const kind = str(formData, 'kind');
  const amount = num(formData, 'amount');
  const day = str(formData, 'occurred_on') || new Date().toISOString().slice(0, 10);

  if (amount <= 0) return { error: 'Сума має бути більшою за нуль' };

  const allowed =
    direction === 'in' ? ['customer_payment', 'other'] : ['supplier_payment', 'expense', 'other'];
  if (!allowed.includes(kind)) return { error: 'Оберіть тип операції' };

  let number = '';
  try {
    await transaction(async (c) => {
      const entityId = await resolveEntityId(c, formData, session.eid);
      number = await nextDocNumber(c, entityId, direction === 'in' ? 'ПКО' : 'ВКО');

      const { rows: orderRows } = await c.query<{ id: string }>(
        `insert into cash_orders
           (number, legal_entity_id, direction, kind, occurred_on, amount,
            customer_id, supplier_id, so_id, category, person, purpose, note, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         returning id`,
        [
          number,
          entityId,
          direction,
          kind,
          day,
          amount,
          kind === 'customer_payment' ? str(formData, 'customer_id') || null : null,
          kind === 'supplier_payment' ? str(formData, 'supplier_id') || null : null,
          kind === 'customer_payment' ? strOrNull(formData, 'so_id') : null,
          kind === 'expense' ? str(formData, 'category') || 'other' : null,
          strOrNull(formData, 'person'),
          strOrNull(formData, 'purpose'),
          strOrNull(formData, 'note'),
          session.uid,
        ],
      );
      const orderId = orderRows[0].id;

      if (kind === 'customer_payment') {
        const customerId = str(formData, 'customer_id');
        if (!customerId) throw new Error('Оберіть клієнта, від якого прийнято готівку');
        const { rows: payRows } = await c.query<{ id: string }>(
          `insert into payments (legal_entity_id, customer_id, so_id, paid_on, amount, method, note)
           values ($1, $2, $3, $4, $5, 'cash', $6) returning id`,
          [entityId, customerId, strOrNull(formData, 'so_id'), day, amount, `Касовий ордер ${number}`],
        );
        await c.query('update cash_orders set payment_id = $2 where id = $1', [orderId, payRows[0].id]);
      }

      if (kind === 'supplier_payment') {
        const supplierId = str(formData, 'supplier_id');
        if (!supplierId) throw new Error('Оберіть постачальника, якому видано готівку');
        const { rows: payRows } = await c.query<{ id: string }>(
          `insert into supplier_payments (legal_entity_id, supplier_id, paid_on, amount, method, note)
           values ($1, $2, $3, $4, 'cash', $5) returning id`,
          [entityId, supplierId, day, amount, `Касовий ордер ${number}`],
        );
        await c.query('update cash_orders set supplier_payment_id = $2 where id = $1', [
          orderId,
          payRows[0].id,
        ]);
      }

      if (kind === 'expense') {
        const category = str(formData, 'category') || 'other';
        if (!EXPENSE_CATEGORIES[category]) throw new Error('Оберіть статтю витрат');
        const { rows: expRows } = await c.query<{ id: string }>(
          `insert into expenses
             (legal_entity_id, category, spent_on, description, amount_net, vat_amount,
              cost_behavior, cash_order_id, created_by)
           values ($1, $2, $3, $4, $5, 0, 'fixed', $6, $7) returning id`,
          [
            entityId,
            category,
            day,
            strOrNull(formData, 'purpose') ?? `Касовий ордер ${number}`,
            amount,
            orderId,
            session.uid,
          ],
        );
        await c.query('update cash_orders set expense_id = $2 where id = $1', [orderId, expRows[0].id]);
      }
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/cash');
  return { ok: `Ордер ${number} виписано` };
}

/** Видалення ордера прибирає і фінансовий запис, який він створив. */
export async function deleteCashOrder(formData: FormData) {
  await requireRole('sales', 'warehouse');
  const id = str(formData, 'cash_order_id');

  await transaction(async (c) => {
    const { rows } = await c.query<{
      payment_id: string | null;
      supplier_payment_id: string | null;
      expense_id: string | null;
    }>('select payment_id, supplier_payment_id, expense_id from cash_orders where id = $1 for update', [id]);
    if (!rows[0]) return;
    await c.query('delete from cash_orders where id = $1', [id]);
    if (rows[0].payment_id) await c.query('delete from payments where id = $1', [rows[0].payment_id]);
    if (rows[0].supplier_payment_id)
      await c.query('delete from supplier_payments where id = $1', [rows[0].supplier_payment_id]);
    if (rows[0].expense_id) await c.query('delete from expenses where id = $1', [rows[0].expense_id]);
  });

  revalidatePath('/cash');
}
