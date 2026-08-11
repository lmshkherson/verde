import type { PoolClient } from 'pg';

/**
 * Юрособа документа обирається в самому документі при створенні; перемикач
 * зверху лишається фільтром перегляду і значенням за замовчуванням. Далі все
 * (номер із префіксом, ПДВ, проводки) йде від юрособи документа.
 */
export async function resolveEntityId(
  c: PoolClient,
  formData: FormData,
  sessionEid: string,
): Promise<string> {
  const chosen = String(formData.get('entity_id') ?? '').trim();
  if (!chosen || chosen === sessionEid) return sessionEid;
  const { rows } = await c.query<{ id: string }>(
    'select id from legal_entities where id = $1 and is_active',
    [chosen],
  );
  if (!rows[0]) throw new Error('Юрособу не знайдено або вона неактивна');
  return chosen;
}
