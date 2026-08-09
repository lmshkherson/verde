'use server';

import { revalidatePath } from 'next/cache';
import { transaction } from '@/lib/db';
import { type ActionState, num, str, toMessage } from '@/lib/action-state';
import { regeneratePostings } from '@/lib/postings';
import { requireRole } from '@/lib/session';

/** Перебудовує проводки періоду з документів. Стара версія періоду зноситься. */
export async function rebuildPostings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole();
  const period = str(formData, 'period');
  if (!/^\d{4}-\d{2}$/.test(period)) return { error: 'Невірний період' };

  let count = 0;
  try {
    count = await transaction((c) => regeneratePostings(c, session.eid, `${period}-01`, session.uid));
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/accounting');
  return { ok: `Згенеровано проводок: ${count}` };
}

export async function saveOpeningBalance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole();
  const code = str(formData, 'code');
  const debit = num(formData, 'debit');
  const credit = num(formData, 'credit');
  const asOf = str(formData, 'as_of');

  if (!code) return { error: 'Оберіть рахунок' };
  if (!asOf) return { error: 'Вкажіть дату' };
  if (debit < 0 || credit < 0) return { error: 'Суми не можуть бути від’ємними' };
  if (debit > 0 && credit > 0) return { error: 'Вкажіть або дебет, або кредит' };

  try {
    await transaction((c) =>
      c.query(
        `insert into opening_balances (legal_entity_id, code, as_of, debit, credit)
         values ($1, $2, $3, $4, $5)
         on conflict (legal_entity_id, code, as_of) do update
           set debit = excluded.debit, credit = excluded.credit`,
        [session.eid, code, asOf, debit, credit],
      ),
    );
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/accounting');
  return { ok: 'Залишок збережено' };
}
