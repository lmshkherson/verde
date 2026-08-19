'use server';

import { revalidatePath } from 'next/cache';
import { transaction } from '@/lib/db';
import { type ActionState, num, str, strOrNull, toMessage } from '@/lib/action-state';
import { requireRole } from '@/lib/session';
import { isoDay } from '@/lib/format';
import { logAutoPoint } from '@/lib/haccp';

/**
 * Документ якості на партію. Може стосуватися однієї партії або всієї
 * поставки: постачальник частіше виписує одне посвідчення на машину, і
 * переписувати його номер у кожен рядок акта — марна робота.
 */
export async function addBatchDocument(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('warehouse', 'production');
  const inspectionId = str(formData, 'inspection_id');
  const batchId = strOrNull(formData, 'batch_id');
  const number = str(formData, 'number');
  const kind = str(formData, 'kind') || 'quality';

  if (!number) return { error: 'Вкажіть номер документа' };
  if (!batchId && !inspectionId) return { error: 'Не вказано партію' };

  let touched = 0;
  try {
    await transaction(async (c) => {
      const targets = batchId
        ? [batchId]
        : (
            await c.query<{ batch_id: string }>(
              'select batch_id from incoming_inspection_lines where inspection_id = $1',
              [inspectionId],
            )
          ).rows.map((r) => r.batch_id);

      if (targets.length === 0) throw new Error('У акті немає жодного рядка');

      for (const id of targets) {
        await c.query(
          `insert into batch_documents
             (batch_id, kind, number, issuer, issued_on, valid_until, file_url, note, added_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           on conflict (batch_id, kind, number) do update
             set issuer = excluded.issuer, issued_on = excluded.issued_on,
                 valid_until = excluded.valid_until, file_url = excluded.file_url,
                 note = excluded.note`,
          [
            id,
            kind,
            number,
            strOrNull(formData, 'issuer'),
            strOrNull(formData, 'issued_on'),
            strOrNull(formData, 'valid_until'),
            strOrNull(formData, 'file_url'),
            strOrNull(formData, 'note'),
            session.uid,
          ],
        );
        touched += 1;
      }
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  if (inspectionId) revalidatePath(`/quality/${inspectionId}`);
  revalidatePath('/quality');
  if (batchId) revalidatePath(`/traceability/${batchId}`);
  return { ok: touched > 1 ? `Документ додано до ${touched} партій` : 'Документ додано' };
}

export async function removeBatchDocument(formData: FormData) {
  await requireRole('warehouse', 'production');
  const inspectionId = str(formData, 'inspection_id');
  await transaction((c) =>
    c.query('delete from batch_documents where id = $1', [str(formData, 'document_id')]),
  );
  if (inspectionId) revalidatePath(`/quality/${inspectionId}`);
  revalidatePath('/quality');
}

/**
 * Перевірка рядка акта.
 *
 * Три правила, які й роблять це контролем, а не анкетою:
 *   1. прийняти партію без чинного документа не можна взагалі;
 *   2. прийняти від незатвердженого постачальника не можна взагалі;
 *   3. будь-яке відхилення — температура поза режимом або знята галочка —
 *      вимагає записаної коригувальної дії.
 */
export async function checkInspectionLine(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('warehouse', 'production');
  const inspectionId = str(formData, 'inspection_id');
  const lineId = str(formData, 'line_id');
  const verdict = str(formData, 'verdict') || 'pending';
  const correction = strOrNull(formData, 'corrective_action');
  const tempRaw = str(formData, 'temp_c');
  const temp = tempRaw === '' ? null : num(formData, 'temp_c');

  const packageOk = formData.get('package_ok') === 'on';
  const markingOk = formData.get('marking_ok') === 'on';
  const organolepticOk = formData.get('organoleptic_ok') === 'on';

  try {
    await transaction(async (c) => {
      const { rows } = await c.query<{
        batch_id: string;
        item_name: string;
        temp_min_c: number | null;
        temp_max_c: number | null;
        valid_docs: number;
        supplier_name: string | null;
        supplier_approved: boolean | null;
        approved_until: string | Date | null;
        status: string;
        legal_entity_id: string;
      }>(
        `select l.batch_id, i.name as item_name, i.temp_min_c, i.temp_max_c,
                coalesce(d.valid_docs, 0) as valid_docs,
                s.name as supplier_name, s.is_approved as supplier_approved,
                s.approved_until, ins.status, ins.legal_entity_id
           from incoming_inspection_lines l
           join incoming_inspections ins on ins.id = l.inspection_id
           join items i on i.id = l.item_id
           left join v_batch_docs d on d.batch_id = l.batch_id
           left join suppliers s on s.id = ins.supplier_id
          where l.id = $1`,
        [lineId],
      );
      const line = rows[0];
      if (!line) throw new Error('Рядок акта не знайдено');
      if (line.status !== 'draft') throw new Error('Акт уже закрито');

      const outOfRange =
        temp !== null &&
        ((line.temp_min_c !== null && temp < Number(line.temp_min_c)) ||
          (line.temp_max_c !== null && temp > Number(line.temp_max_c)));
      const deviation = outOfRange || !packageOk || !markingOk || !organolepticOk;

      if (verdict === 'accepted') {
        if (Number(line.valid_docs) === 0) {
          throw new Error(
            `«${line.item_name}»: немає чинного документа якості. Партію без нього прийняти не можна.`,
          );
        }
        if (line.supplier_name && !line.supplier_approved) {
          throw new Error(
            `Постачальник «${line.supplier_name}» не входить до переліку затверджених. ` +
              'Затвердьте його в картці постачальника або поверніть поставку.',
          );
        }
        const approvedUntil = isoDay(line.approved_until);
        if (approvedUntil && approvedUntil < isoDay(new Date())!) {
          throw new Error(
            `Затвердження постачальника «${line.supplier_name}» скінчилося ${approvedUntil}. Перегляньте оцінку.`,
          );
        }
        if (deviation && !correction) {
          throw new Error(
            'Є відхилення від вимог приймання. Запишіть коригувальну дію — без неї прийняти не можна.',
          );
        }
      }
      if (verdict === 'rejected' && !correction) {
        throw new Error('Вкажіть, що робимо із забракованою партією: повернення, утилізація, ізоляція.');
      }

      await c.query(
        `update incoming_inspection_lines set
           temp_c = $2, package_ok = $3, marking_ok = $4, organoleptic_ok = $5,
           verdict = $6, corrective_action = $7, note = $8,
           checked_at = now(), checked_by = $9
         where id = $1`,
        [
          lineId,
          temp,
          packageOk,
          markingOk,
          organolepticOk,
          verdict,
          correction,
          strOrNull(formData, 'note'),
          session.uid,
        ],
      );

      // Приймання — точка контролю за планом HACCP, і температура,
      // виміряна при розвантаженні, є її записом. Дублювати цифру руками
      // в журнал ніхто не буде, тож пишемо самі.
      if (temp !== null) {
        await logAutoPoint(c, 'incoming', line.legal_entity_id, session.uid, temp, {
          batchId: line.batch_id,
          docType: 'incoming_inspection',
          docId: inspectionId,
          correction: correction ?? (outOfRange ? 'Відхилення зафіксовано в акті вхідного контролю' : null),
        });
      }
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/quality/${inspectionId}`);
  revalidatePath('/quality');
  return { ok: 'Рядок перевірено' };
}

/**
 * Закриття акта: те, що прийняли, стає доступним для виробництва, брак —
 * забракованим, а неперевірене лишається в карантині. Останнє навмисно не
 * «допускається за замовчуванням»: непройдений контроль не є пройденим.
 */
export async function completeInspection(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('warehouse', 'production');
  const id = str(formData, 'inspection_id');

  let left = 0;
  try {
    await transaction(async (c) => {
      const { rows } = await c.query<{ status: string }>(
        'select status from incoming_inspections where id = $1 for update',
        [id],
      );
      if (!rows[0]) throw new Error('Акт не знайдено');
      if (rows[0].status !== 'draft') throw new Error('Акт уже закрито');

      await c.query(
        `update batches b set
           quality_status = 'released',
           quality_note = 'Допущено актом вхідного контролю'
         from incoming_inspection_lines l
        where l.batch_id = b.id and l.inspection_id = $1 and l.verdict = 'accepted'`,
        [id],
      );
      await c.query(
        `update batches b set
           quality_status = 'rejected',
           quality_note = coalesce(l.corrective_action, 'Забраковано при вхідному контролі')
         from incoming_inspection_lines l
        where l.batch_id = b.id and l.inspection_id = $1 and l.verdict = 'rejected'`,
        [id],
      );

      const { rows: pending } = await c.query<{ n: number }>(
        `select count(*)::int as n from incoming_inspection_lines
          where inspection_id = $1 and verdict = 'pending'`,
        [id],
      );
      left = pending[0].n;

      await c.query(
        `update incoming_inspections
            set status = 'completed', completed_at = now(),
                transport_temp_c = $2, transport_ok = $3, vehicle = $4, note = $5
          where id = $1`,
        [
          id,
          str(formData, 'transport_temp_c') === '' ? null : num(formData, 'transport_temp_c'),
          formData.get('transport_ok') !== 'off',
          strOrNull(formData, 'vehicle'),
          strOrNull(formData, 'note'),
        ],
      );

      await c.query(
        `insert into audit_log (user_id, action, entity, entity_id, details)
         values ($1, 'complete', 'incoming_inspection', $2, $3)`,
        [session.uid, id, JSON.stringify({ pending: left })],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/quality/${id}`);
  revalidatePath('/quality');
  revalidatePath('/stock');
  return {
    ok:
      left > 0
        ? `Акт закрито. У карантині лишилося позицій: ${left} — їх не перевіряли.`
        : 'Акт закрито, партії допущено',
  };
}

export async function cancelInspection(formData: FormData) {
  await requireRole('warehouse', 'production');
  const id = str(formData, 'inspection_id');
  await transaction((c) =>
    c.query("update incoming_inspections set status = 'cancelled' where id = $1 and status = 'draft'", [
      id,
    ]),
  );
  revalidatePath(`/quality/${id}`);
  revalidatePath('/quality');
}

/**
 * Ручна зміна стану партії поза актом. Потрібна двічі: коли лабораторія дала
 * результат уже після приймання і коли партію треба зупинити за скаргою — то
 * саме та кнопка, якої бракує в день відкликання.
 */
export async function setBatchQuality(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('warehouse', 'production');
  const batchId = str(formData, 'batch_id');
  const status = str(formData, 'quality_status');
  const note = strOrNull(formData, 'quality_note');

  if (!['quarantine', 'released', 'rejected'].includes(status)) {
    return { error: 'Невідомий стан партії' };
  }
  if (status !== 'released' && !note) {
    return { error: 'Вкажіть підставу: за нею потім відновлюють, чому партію зупинили' };
  }

  try {
    await transaction(async (c) => {
      if (status === 'released') {
        const { rows } = await c.query<{ valid_docs: number; quality_control: boolean; name: string }>(
          `select coalesce(d.valid_docs, 0) as valid_docs, i.quality_control, i.name
             from batches b
             join items i on i.id = b.item_id
             left join v_batch_docs d on d.batch_id = b.id
            where b.id = $1`,
          [batchId],
        );
        if (!rows[0]) throw new Error('Партію не знайдено');
        if (rows[0].quality_control && Number(rows[0].valid_docs) === 0) {
          throw new Error(
            `«${rows[0].name}» потребує вхідного контролю: спершу внесіть чинний документ якості.`,
          );
        }
      }

      await c.query('update batches set quality_status = $2, quality_note = $3 where id = $1', [
        batchId,
        status,
        note,
      ]);
      await c.query(
        `insert into audit_log (user_id, action, entity, entity_id, details)
         values ($1, 'quality', 'batch', $2, $3)`,
        [session.uid, batchId, JSON.stringify({ status, note })],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/traceability/${batchId}`);
  revalidatePath('/quality');
  revalidatePath('/stock');
  return { ok: 'Стан партії змінено' };
}
