import type { PoolClient } from 'pg';
import { withinLimits } from '@/lib/quality';
import { round3 } from '@/lib/stock';

interface AutoLogOptions {
  batchId?: string | null;
  docType?: string | null;
  docId?: string | null;
  correction?: string | null;
}

/**
 * Запис у журнал HACCP із документа. Точку шукаємо за джерелом, а не за
 * кодом: план може змінитися, а зв'язок «приймання → своя точка» лишиться.
 */
export async function logAutoPoint(
  c: PoolClient,
  source: 'incoming' | 'shipping',
  legalEntityId: string,
  userId: string | null,
  value: number,
  options: AutoLogOptions = {},
): Promise<void> {
  const { rows } = await c.query<{ id: string; limit_min: number | null; limit_max: number | null }>(
    'select id, limit_min, limit_max from haccp_points where auto_source = $1 and is_active',
    [source],
  );

  for (const point of rows) {
    const ok = withinLimits(point, value);
    // База не приймає відхилення без коригувальної дії — і правильно робить.
    // Якщо документ її не дав, пишемо чесне «рішення не записано».
    const correction = ok
      ? options.correction
      : options.correction || 'Рішення в документі не записано — потребує розгляду';

    await c.query(
      `insert into haccp_logs
         (point_id, legal_entity_id, value, is_ok, batch_id, doc_type, doc_id,
          corrective_action, user_id, source)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        point.id,
        legalEntityId,
        round3(value),
        ok,
        options.batchId ?? null,
        options.docType ?? null,
        options.docId ?? null,
        correction ?? null,
        userId,
        source,
      ],
    );
  }
}
