import type { PoolClient } from 'pg';

export type MoveType =
  | 'opening'
  | 'purchase_receipt'
  | 'production_consume'
  | 'production_output'
  | 'sale_shipment'
  | 'write_off'
  | 'adjustment'
  | 'transfer_in'
  | 'transfer_out';

export interface MoveInput {
  itemId: string;
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
export async function lockItem(client: PoolClient, itemId: string): Promise<void> {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [itemId]);
}

export async function insertMoves(client: PoolClient, moves: MoveInput[]): Promise<void> {
  for (const m of moves) {
    if (m.qty === 0) continue;
    await client.query(
      `insert into stock_moves
         (item_id, batch_id, warehouse_id, qty, unit_cost, move_type, doc_type, doc_id, user_id, note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        m.itemId,
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
  qty: number,
): Promise<Allocation[]> {
  await lockItem(client, itemId);

  const { rows } = await client.query<{
    batch_id: string;
    qty: number;
    value: number;
  }>(
    `select sb.batch_id, sb.qty, sb.value
       from v_stock_batches sb
       join batches b on b.id = sb.batch_id
      where sb.item_id = $1 and sb.warehouse_id = $2 and sb.qty > 0
      order by b.expires_on asc nulls last, b.created_at asc`,
    [itemId, warehouseId],
  );

  const available = rows.reduce((sum, r) => sum + r.qty, 0);
  if (available + 0.0005 < qty) {
    const info = await client.query<{ name: string; unit: string }>(
      'select name, unit from items where id = $1',
      [itemId],
    );
    throw new InsufficientStockError(
      info.rows[0]?.name ?? itemId,
      qty,
      round3(available),
      info.rows[0]?.unit ?? '',
    );
  }

  const allocations: Allocation[] = [];
  let left = qty;
  for (const row of rows) {
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
export async function itemAvgCost(client: PoolClient, itemId: string): Promise<number> {
  const { rows } = await client.query<{ avg_cost: number }>(
    'select avg_cost from v_item_stock where item_id = $1',
    [itemId],
  );
  return rows[0]?.avg_cost ?? 0;
}

/** Склад за замовчуванням для типу запасів: сировина, готова продукція чи цех. */
export async function defaultWarehouseId(
  client: PoolClient,
  kind: 'raw' | 'finished' | 'wip',
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'select id from warehouses where kind = $1 and is_active order by code limit 1',
    [kind],
  );
  if (!rows[0]) throw new Error(`Не налаштовано склад типу «${kind}»`);
  return rows[0].id;
}

export async function nextDocNumber(client: PoolClient, prefix: string): Promise<string> {
  const { rows } = await client.query<{ next_doc_number: string }>(
    'select next_doc_number($1)',
    [prefix],
  );
  return rows[0].next_doc_number;
}

export const round3 = (n: number) => Math.round(n * 1000) / 1000;
export const round4 = (n: number) => Math.round(n * 10000) / 10000;
export const round2 = (n: number) => Math.round(n * 100) / 100;
