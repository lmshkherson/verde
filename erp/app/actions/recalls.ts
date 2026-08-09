'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { transaction } from '@/lib/db';
import { type ActionState, num, str, strOrNull, toMessage } from '@/lib/action-state';
import { nextDocNumber, round3 } from '@/lib/stock';
import { requireRole } from '@/lib/session';

/**
 * Оголошення відкликання. Документ одразу матеріалізує результат
 * простежуваності: усі відвантаження, куди пішла ця партія або що з неї
 * зроблено, стають рядками чек-листа.
 *
 * Список саме копіюється, а не рахується щоразу заново. У день відкликання
 * важливо, щоб перелік не «поплив» від нового відвантаження чи повернення:
 * обдзвонювати треба фіксований список, і в ньому має бути видно, кого вже
 * попередили.
 */
export async function declareRecall(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('production', 'sales', 'warehouse');
  const batchId = str(formData, 'batch_id');
  if (!batchId) return { error: 'Не вказано партію' };

  let recallId: string;
  try {
    recallId = await transaction(async (c) => {
      const number = await nextDocNumber(c, session.eid, 'ВІДКЛ');
      const { rows } = await c.query<{ id: string }>(
        `insert into recalls (number, legal_entity_id, batch_id, reason, declared_on, note, created_by)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [
          number,
          session.eid,
          batchId,
          str(formData, 'reason') || 'quality',
          str(formData, 'declared_on') || new Date().toISOString().slice(0, 10),
          strOrNull(formData, 'note'),
          session.uid,
        ],
      );
      const id = rows[0].id;

      // Той самий рекурсивний обхід, що й на екрані простежуваності: партія,
      // усе виготовлене з неї, і всі відвантаження цього.
      await c.query(
        `insert into recall_lines
           (recall_id, shipment_id, customer_id, item_id, batch_id, shipped_qty)
         with recursive fwd as (
           select b.id as batch_id, 0 as depth from batches b where b.id = $2
           union
           select e.result_batch_id, f.depth + 1
             from fwd f join v_batch_edges e on e.source_batch_id = f.batch_id
            where f.depth < 8
         )
         select $1, s.shipment_id, s.customer_id, s.item_id, s.batch_id, s.qty
           from fwd f
           join v_batch_shipments s on s.batch_id = f.batch_id
          where s.legal_entity_id = $3
         on conflict do nothing`,
        [id, batchId, session.eid],
      );

      return id;
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  redirect(`/recalls/${recallId}`);
}

export async function setRecallStatus(formData: FormData) {
  await requireRole('production', 'sales', 'warehouse');
  const id = str(formData, 'recall_id');
  await transaction((c) =>
    c.query('update recalls set status = $2 where id = $1', [id, str(formData, 'status')]),
  );
  revalidatePath(`/recalls/${id}`);
  revalidatePath('/recalls');
}

/** Відмітка обдзвону й вилученої кількості по рядку чек-листа. */
export async function updateRecallLine(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('production', 'sales', 'warehouse');
  const recallId = str(formData, 'recall_id');
  const lineId = str(formData, 'line_id');
  const notified = formData.get('notified') === 'on';
  const recovered = round3(num(formData, 'recovered_qty'));

  try {
    await transaction(async (c) => {
      const { rows } = await c.query<{ shipped_qty: number }>(
        'select shipped_qty from recall_lines where id = $1',
        [lineId],
      );
      if (!rows[0]) throw new Error('Рядок не знайдено');
      if (recovered > Number(rows[0].shipped_qty) + 0.0005) {
        throw new Error(
          `Вилучено більше, ніж відвантажено: ${recovered} проти ${rows[0].shipped_qty}.`,
        );
      }

      await c.query(
        `update recall_lines set
           recovered_qty = $2,
           notified_at = case when $3 then coalesce(notified_at, now()) else null end,
           note = $4
         where id = $1`,
        [lineId, recovered, notified, strOrNull(formData, 'note')],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/recalls/${recallId}`);
  return { ok: 'Збережено' };
}
