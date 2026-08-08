'use server';

import { revalidatePath } from 'next/cache';
import { transaction } from '@/lib/db';
import { type ActionState, num, str, strOrNull, toMessage } from '@/lib/action-state';
import { allocateFefo, insertMoves, lockItem, round3 } from '@/lib/stock';
import { requireRole } from '@/lib/session';

/**
 * Інвентаризація: комірник вводить фактично порахований залишок партії,
 * а система дописує рух на різницю. Сам залишок ніхто не «виправляє» —
 * лишається слід, хто і на скільки розійшовся з обліком.
 */
export async function countBatch(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('warehouse');
  // Партія і склад приходять одним значенням зі списку — так комірник обирає
  // рядок залишку, а не збирає його з трьох окремих полів.
  const [batchId, warehouseId] = str(formData, 'batch_location').split('|');
  const counted = round3(num(formData, 'counted_qty', -1));

  if (!batchId || !warehouseId) return { error: 'Оберіть партію' };
  if (counted < 0) return { error: 'Вкажіть фактичну кількість' };

  try {
    await transaction(async (c) => {
      const { rows: batchRows } = await c.query<{ item_id: string }>(
        'select item_id from batches where id = $1',
        [batchId],
      );
      if (!batchRows[0]) throw new Error('Партію не знайдено');
      const itemId = batchRows[0].item_id;

      await lockItem(c, itemId);
      const { rows } = await c.query<{ qty: number; value: number }>(
        `select qty, value from v_stock_batches
          where item_id = $1 and warehouse_id = $2 and batch_id = $3`,
        [itemId, warehouseId, batchId],
      );
      const current = rows[0]?.qty ?? 0;
      const unitCost = rows[0] && rows[0].qty > 0 ? rows[0].value / rows[0].qty : 0;
      const delta = round3(counted - current);
      if (Math.abs(delta) < 0.0005) throw new Error('Розбіжності немає — рух не потрібен');

      await insertMoves(c, [
        {
          itemId,
          batchId,
          warehouseId,
          qty: delta,
          unitCost,
          moveType: 'adjustment',
          docType: 'stock_count',
          userId: session.uid,
          note: strOrNull(formData, 'note') ?? `Інвентаризація: облік ${current}, факт ${counted}`,
        },
      ]);

      await c.query(
        `insert into audit_log (user_id, action, entity, entity_id, details)
         values ($1, 'count', 'batch', $2, $3)`,
        [session.uid, batchId, JSON.stringify({ current, counted, delta })],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/stock');
  return { ok: 'Залишок скориговано' };
}

export async function writeOffStock(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('warehouse');
  const itemId = str(formData, 'item_id');
  const warehouseId = str(formData, 'warehouse_id');
  const qty = round3(num(formData, 'qty'));
  const reason = strOrNull(formData, 'note');

  if (!itemId || !warehouseId) return { error: 'Оберіть номенклатуру і склад' };
  if (qty <= 0) return { error: 'Кількість має бути більшою за нуль' };
  if (!reason) return { error: 'Вкажіть причину списання' };

  try {
    await transaction(async (c) => {
      const allocations = await allocateFefo(c, itemId, warehouseId, qty);
      for (const a of allocations) {
        await insertMoves(c, [
          {
            itemId,
            batchId: a.batchId,
            warehouseId,
            qty: -a.qty,
            unitCost: a.unitCost,
            moveType: 'write_off',
            docType: 'write_off',
            userId: session.uid,
            note: reason,
          },
        ]);
      }
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/stock');
  return { ok: 'Списання проведено' };
}

export async function transferStock(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('warehouse');
  const itemId = str(formData, 'item_id');
  const fromId = str(formData, 'from_warehouse_id');
  const toId = str(formData, 'to_warehouse_id');
  const qty = round3(num(formData, 'qty'));

  if (!itemId || !fromId || !toId) return { error: 'Оберіть номенклатуру і склади' };
  if (fromId === toId) return { error: 'Склади мають бути різні' };
  if (qty <= 0) return { error: 'Кількість має бути більшою за нуль' };

  try {
    await transaction(async (c) => {
      const allocations = await allocateFefo(c, itemId, fromId, qty);
      for (const a of allocations) {
        // Переміщення не змінює собівартість: партія їде разом зі своєю ціною.
        await insertMoves(c, [
          {
            itemId,
            batchId: a.batchId,
            warehouseId: fromId,
            qty: -a.qty,
            unitCost: a.unitCost,
            moveType: 'transfer_out',
            docType: 'transfer',
            userId: session.uid,
          },
          {
            itemId,
            batchId: a.batchId,
            warehouseId: toId,
            qty: a.qty,
            unitCost: a.unitCost,
            moveType: 'transfer_in',
            docType: 'transfer',
            userId: session.uid,
          },
        ]);
      }
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/stock');
  return { ok: 'Переміщення проведено' };
}
