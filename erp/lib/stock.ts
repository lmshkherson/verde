import type { PoolClient } from 'pg';

export type MoveType =
  | 'opening'
  | 'purchase_receipt'
  | 'production_consume'
  | 'production_output'
  | 'sale_shipment'
  | 'sale_return'
  | 'purchase_return'
  | 'write_off'
  | 'adjustment'
  | 'transfer_in'
  | 'transfer_out';

export interface MoveInput {
  itemId: string;
  /** Чия це власність. Склад спільний, тож без юрособи рух безадресний. */
  legalEntityId: string;
  batchId?: string | null;
  warehouseId: string;
  /** Додатне — прихід, від'ємне — видаток. */
  qty: number;
  unitCost: number;
  moveType: MoveType;
  docType?: string | null;
  docId?: string | null;
  userId?: string | null;
  note?: string | null;
}

export interface Allocation {
  batchId: string;
  qty: number;
  unitCost: number;
}

/**
 * Партія є, але вона не допущена: чекає вхідного контролю або забракована.
 * Окрема помилка потрібна, бо «немає на складі» і «є, але не можна» — це різні
 * ситуації з різними діями: у першій докупають, у другій ідуть до комірника.
 */
export class QualityHoldError extends Error {
  constructor(
    public readonly itemName: string,
    public readonly blocked: number,
    public readonly unit: string,
  ) {
    super(
      `«${itemName}»: ${blocked} ${unit} не допущено до використання ` +
        '(карантин або брак). Партія без закритого вхідного контролю у виробництво не йде.',
    );
    this.name = 'QualityHoldError';
  }
}

export class InsufficientStockError extends Error {
  constructor(
    public readonly itemName: string,
    public readonly requested: number,
    public readonly available: number,
    public readonly unit: string,
  ) {
    super(
      `Недостатньо «${itemName}»: потрібно ${requested} ${unit}, на складі ${available} ${unit}`,
    );
    this.name = 'InsufficientStockError';
  }
}

/**
 * Блокує номенклатуру до кінця транзакції. Без цього дві одночасні операції
 * можуть списати ту саму партію двічі й загнати залишок у мінус.
 */
export async function lockItem(
  client: PoolClient,
  itemId: string,
  legalEntityId: string,
): Promise<void> {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1 || $2, 0))', [
    itemId,
    legalEntityId,
  ]);
}

export async function insertMoves(client: PoolClient, moves: MoveInput[]): Promise<void> {
  for (const m of moves) {
    if (m.qty === 0) continue;
    await client.query(
      `insert into stock_moves
         (item_id, legal_entity_id, batch_id, warehouse_id, qty, unit_cost, move_type,
          doc_type, doc_id, user_id, note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        m.itemId,
        m.legalEntityId,
        m.batchId ?? null,
        m.warehouseId,
        m.qty,
        m.unitCost,
        m.moveType,
        m.docType ?? null,
        m.docId ?? null,
        m.userId ?? null,
        m.note ?? null,
      ],
    );
  }
}

/**
 * Підбирає партії під списання за правилом FEFO — спершу ті, що раніше псуються.
 * Для харчового виробництва це правильніше за класичний FIFO: на складі має
 * лишатися товар з найдовшим залишковим терміном.
 */
export async function allocateFefo(
  client: PoolClient,
  itemId: string,
  warehouseId: string,
  legalEntityId: string,
  qty: number,
): Promise<Allocation[]> {
  await lockItem(client, itemId, legalEntityId);

  const { rows } = await client.query<{
    batch_id: string;
    qty: number;
    value: number;
    quality_status: string;
  }>(
    `select sb.batch_id, sb.qty, sb.value, b.quality_status
       from v_stock_batches sb
       join batches b on b.id = sb.batch_id
      where sb.item_id = $1 and sb.warehouse_id = $2 and sb.legal_entity_id = $3 and sb.qty > 0
      order by b.expires_on asc nulls last, b.created_at asc`,
    [itemId, warehouseId, legalEntityId],
  );

  // Недопущені партії до підбору не потрапляють узагалі — ні першими, ні
  // останніми. FEFO працює лише серед того, що дозволено використовувати.
  const usable = rows.filter((r) => r.quality_status === 'released');
  const blocked = rows
    .filter((r) => r.quality_status !== 'released')
    .reduce((sum, r) => sum + Number(r.qty), 0);

  const available = usable.reduce((sum, r) => sum + Number(r.qty), 0);
  if (available + 0.0005 < qty) {
    const info = await client.query<{ name: string; unit: string }>(
      'select name, unit from items where id = $1',
      [itemId],
    );
    const name = info.rows[0]?.name ?? itemId;
    const unit = info.rows[0]?.unit ?? '';

    // Якщо заблокованого вистачило б на різницю — причина саме в контролі,
    // і користувачеві треба сказати про це, а не про порожній склад.
    if (blocked > 0.0005 && available + blocked + 0.0005 >= qty) {
      throw new QualityHoldError(name, round3(blocked), unit);
    }
    throw new InsufficientStockError(name, qty, round3(available), unit);
  }

  const allocations: Allocation[] = [];
  let left = qty;
  for (const row of usable) {
    if (left <= 0.0005) break;
    const take = Math.min(row.qty, left);
    allocations.push({
      batchId: row.batch_id,
      qty: round3(take),
      unitCost: row.qty > 0 ? round4(row.value / row.qty) : 0,
    });
    left -= take;
  }
  return allocations;
}

/** Середньозважена собівартість номенклатури за всім складом. */
export async function itemAvgCost(
  client: PoolClient,
  itemId: string,
  legalEntityId: string,
): Promise<number> {
  const { rows } = await client.query<{ avg_cost: number }>(
    'select avg_cost from v_item_stock where item_id = $1 and legal_entity_id = $2',
    [itemId, legalEntityId],
  );
  return rows[0]?.avg_cost ?? 0;
}

/** Склад за замовчуванням для типу запасів: сировина, готова продукція чи цех. */
export async function defaultWarehouseId(
  client: PoolClient,
  kind: 'raw' | 'finished' | 'wip',
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    // Спершу типовий склад цього типу, і лише як запасний варіант — перший
    // за кодом: так додавання другого складу не перемикає документи мовчки.
    'select id from warehouses where kind = $1 and is_active order by is_default desc, code limit 1',
    [kind],
  );
  if (!rows[0]) throw new Error(`Не налаштовано склад типу «${kind}»`);
  return rows[0].id;
}

export async function nextDocNumber(
  client: PoolClient,
  legalEntityId: string,
  prefix: string,
): Promise<string> {
  const { rows } = await client.query<{ next_doc_number: string }>(
    'select next_doc_number($1, $2)',
    [legalEntityId, prefix],
  );
  return rows[0].next_doc_number;
}

export const round3 = (n: number) => Math.round(n * 1000) / 1000;
export const round4 = (n: number) => Math.round(n * 10000) / 10000;
export const round2 = (n: number) => Math.round(n * 100) / 100;
