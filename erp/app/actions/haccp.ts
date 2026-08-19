'use server';

import { revalidatePath } from 'next/cache';
import { transaction } from '@/lib/db';
import { type ActionState, num, str, strOrNull, toMessage } from '@/lib/action-state';
import { requireRole } from '@/lib/session';
import { isQualitative, withinLimits } from '@/lib/quality';

/**
 * Запис у журнал моніторингу.
 *
 * Відповідність рахує система, а не людина: для числової точки — за межами
 * з плану, для якісної — за відміткою. Це навмисно: якби «відповідає»
 * ставили руками, журнал показував би самі зелені рядки й нічого не вартував.
 */
export async function logHaccp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('production', 'warehouse');
  const pointId = str(formData, 'point_id');
  const correction = strOrNull(formData, 'corrective_action');
  const rawValue = str(formData, 'value');

  if (!pointId) return { error: 'Не вказано точку контролю' };

  try {
    await transaction(async (c) => {
      const { rows } = await c.query<{
        name: string;
        unit: string | null;
        limit_min: number | null;
        limit_max: number | null;
      }>('select name, unit, limit_min, limit_max from haccp_points where id = $1 and is_active', [
        pointId,
      ]);
      const point = rows[0];
      if (!point) throw new Error('Точку контролю не знайдено або вона неактивна');

      let value: number | null = null;
      let ok: boolean;

      if (isQualitative(point)) {
        ok = formData.get('is_ok') === 'on';
      } else {
        if (rawValue === '') throw new Error(`«${point.name}»: вкажіть виміряне значення`);
        value = num(formData, 'value');
        ok = withinLimits(point, value);
      }

      if (!ok && !correction) {
        throw new Error(
          'Значення поза межами. Запишіть коригувальну дію: що зробили з продукцією і з обладнанням.',
        );
      }

      await c.query(
        `insert into haccp_logs
           (point_id, legal_entity_id, value, is_ok, batch_id, corrective_action, note, user_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          pointId,
          session.eid,
          value,
          ok,
          strOrNull(formData, 'batch_id'),
          correction,
          strOrNull(formData, 'note'),
          session.uid,
        ],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/haccp');
  return { ok: 'Запис внесено' };
}

/** Точка контролю з плану HACCP. Порожні межі означають якісний контроль. */
export async function saveHaccpPoint(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('production');
  const id = strOrNull(formData, 'point_id');
  const code = str(formData, 'code');
  const name = str(formData, 'name');
  const parameter = str(formData, 'parameter');

  if (!code) return { error: 'Вкажіть код точки, наприклад ККТ-1' };
  if (!name) return { error: 'Вкажіть назву точки' };
  if (!parameter) return { error: 'Вкажіть, що саме вимірюється' };

  const min = str(formData, 'limit_min') === '' ? null : num(formData, 'limit_min');
  const max = str(formData, 'limit_max') === '' ? null : num(formData, 'limit_max');
  if (min !== null && max !== null && min > max) {
    return { error: 'Нижня межа більша за верхню' };
  }

  const gapRaw = str(formData, 'max_gap_hours');
  const values = [
    code,
    name,
    str(formData, 'kind') || 'ccp',
    str(formData, 'stage') || 'production',
    parameter,
    strOrNull(formData, 'unit'),
    min,
    max,
    strOrNull(formData, 'frequency'),
    gapRaw === '' ? null : Math.round(num(formData, 'max_gap_hours')),
    strOrNull(formData, 'monitoring'),
    strOrNull(formData, 'corrective_action'),
    strOrNull(formData, 'verification'),
  ];

  try {
    await transaction(async (c) => {
      if (id) {
        await c.query(
          `update haccp_points set
             code = $2, name = $3, kind = $4, stage = $5, parameter = $6, unit = $7,
             limit_min = $8, limit_max = $9, frequency = $10, max_gap_hours = $11,
             monitoring = $12, corrective_action = $13, verification = $14,
             is_active = $15
           where id = $1`,
          [id, ...values, formData.get('is_active') !== 'off'],
        );
      } else {
        await c.query(
          `insert into haccp_points
             (code, name, kind, stage, parameter, unit, limit_min, limit_max,
              frequency, max_gap_hours, monitoring, corrective_action, verification)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          values,
        );
      }
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/haccp');
  return { ok: id ? 'Точку збережено' : 'Точку контролю додано' };
}
