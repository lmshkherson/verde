'use server';

import { revalidatePath } from 'next/cache';
import { transaction } from '@/lib/db';
import { type ActionState, num, str, strOrNull, toMessage } from '@/lib/action-state';
import { requireRole } from '@/lib/session';

/** Оплата постачальнику — зменшує кредиторку. Сума завжди з ПДВ: платимо повну. */
export async function recordSupplierPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('warehouse');
  const supplierId = str(formData, 'supplier_id');
  const amount = num(formData, 'amount');

  if (!supplierId) return { error: 'Оберіть постачальника' };
  if (amount === 0) return { error: 'Вкажіть суму оплати' };

  try {
    await transaction((c) =>
      c.query(
        `insert into supplier_payments
           (legal_entity_id, supplier_id, po_id, paid_on, amount, method, note, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          session.eid,
          supplierId,
          strOrNull(formData, 'po_id'),
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

  revalidatePath('/purchasing');
  revalidatePath('/purchasing/suppliers');
  return { ok: 'Оплату записано' };
}

/**
 * Операційна витрата — те, що не проходить через склад: оренда, зарплата, реклама.
 * У фінансовий результат іде база без ПДВ, у кредиторку — повна сума,
 * а сам податок лягає в реєстр окремим записом податкового кредиту.
 */
export async function createExpense(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole();
  const net = num(formData, 'amount_net');
  const vat = num(formData, 'vat_amount');
  const category = str(formData, 'category');

  if (net <= 0) return { error: 'Вкажіть суму без ПДВ' };
  if (vat < 0) return { error: 'ПДВ не може бути від’ємним' };
  if (!category) return { error: 'Оберіть категорію' };
  if (vat > 0 && !session.vat) {
    return { error: 'Юрособа не платник ПДВ — податок тут не відшкодовується, вкажіть повну суму як базу' };
  }

  const spentOn = str(formData, 'spent_on') || new Date().toISOString().slice(0, 10);
  const supplierId = strOrNull(formData, 'supplier_id');

  try {
    await transaction(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into expenses
           (legal_entity_id, category, spent_on, description, amount_net, vat_amount,
            supplier_id, cost_behavior, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [
          session.eid,
          category,
          spentOn,
          strOrNull(formData, 'description'),
          net,
          vat,
          supplierId,
          str(formData, 'cost_behavior') || 'fixed',
          session.uid,
        ],
      );

      if (vat > 0) {
        const supplier = supplierId
          ? await c.query<{ name: string; edrpou: string | null }>(
              'select name, edrpou from suppliers where id = $1',
              [supplierId],
            )
          : null;

        await c.query(
          `insert into vat_entries
             (legal_entity_id, kind, doc_type, doc_id, occurred_on,
              base_amount, vat_amount, vat_rate, counterparty_name, counterparty_edrpou, note)
           values ($1, 'credit', 'expense', $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            session.eid,
            rows[0].id,
            spentOn,
            net,
            vat,
            net > 0 ? Math.round((vat / net) * 1000) / 10 : 0,
            supplier?.rows[0]?.name ?? null,
            supplier?.rows[0]?.edrpou ?? null,
            strOrNull(formData, 'description'),
          ],
        );
      }
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/pl');
  return { ok: 'Витрату записано' };
}
