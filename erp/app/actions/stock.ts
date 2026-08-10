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

      await lockItem(c, itemId, session.eid);
      const { rows } = await c.query<{ qty: number; value: number }>(
        `select qty, value from v_stock_batches
          where item_id = $1 and warehouse_id = $2 and batch_id = $3 and legal_entity_id = $4`,
        [itemId, warehouseId, batchId, session.eid],
      );
      const current = rows[0]?.qty ?? 0;
      const unitCost = rows[0] && rows[0].qty > 0 ? rows[0].value / rows[0].qty : 0;
      const delta = round3(counted - current);
      if (Math.abs(delta) < 0.0005) throw new Error('Розбіжності немає — рух не потрібен');

      await insertMoves(c, [
        {
          itemId,
          legalEntityId: session.eid,
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
      const allocations = await allocateFefo(c, itemId, warehouseId, session.eid, qty);
      for (const a of allocations) {
        await insertMoves(c, [
          {
            itemId,
            legalEntityId: session.eid,
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
      const allocations = await allocateFefo(c, itemId, fromId, session.eid, qty);
      for (const a of allocations) {
        // Переміщення не змінює собівартість: партія їде разом зі своєю ціною.
        await insertMoves(c, [
          {
            itemId,
            legalEntityId: session.eid,
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
            legalEntityId: session.eid,
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

/**
 * Довідник складів. Тип після появи рухів не змінюється: від нього залежить,
 * куди виробництво списує сировину й куди кладе випуск.
 */
export async function saveWarehouse(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('warehouse');
  const id = strOrNull(formData, 'warehouse_id');
  const code = str(formData, 'code');
  const name = str(formData, 'name');
  const kind = str(formData, 'kind');

  if (!code) return { error: 'Вкажіть код складу' };
  if (!name) return { error: 'Вкажіть назву' };
  if (!['raw', 'finished', 'wip'].includes(kind)) return { error: 'Оберіть тип складу' };

  const isDefault = formData.get('is_default') === 'on';

  try {
    await transaction(async (c) => {
      if (id) {
        const { rows: moves } = await c.query<{ n: number }>(
          'select count(*)::int as n from stock_moves where warehouse_id = $1',
          [id],
        );
        const { rows: current } = await c.query<{ kind: string }>(
          'select kind from warehouses where id = $1',
          [id],
        );
        if (moves[0].n > 0 && current[0]?.kind !== kind) {
          throw new Error('Тип складу не можна змінити: по ньому вже є рухи');
        }
        await c.query(
          `update warehouses set code = $2, name = $3, kind = $4, address = $5, note = $6
            where id = $1`,
          [id, code, name, kind, strOrNull(formData, 'address'), strOrNull(formData, 'note')],
        );
      } else {
        await c.query(
          `insert into warehouses (code, name, kind, address, note)
           values ($1, $2, $3, $4, $5)`,
          [code, name, kind, strOrNull(formData, 'address'), strOrNull(formData, 'note')],
        );
      }

      // Типовим складом типу може бути лише один — інакше «за замовчуванням»
      // означало б «як пощастить».
      if (isDefault) {
        await c.query('update warehouses set is_default = false where kind = $1', [kind]);
        await c.query(
          'update warehouses set is_default = true where code = $1',
          [code],
        );
      }
    });
  } catch (err) {
    const message = toMessage(err);
    return {
      error: message.includes('warehouses_code_key') ? `Код ${code} вже зайнятий` : message,
    };
  }

  revalidatePath('/stock/warehouses');
  return { ok: id ? 'Склад збережено' : 'Склад додано' };
}

/** Деактивація складу можлива лише порожнього: залишки мають кудись поїхати. */
export async function setWarehouseActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('warehouse');
  const id = str(formData, 'warehouse_id');
  const active = str(formData, 'active') === 'true';

  try {
    await transaction(async (c) => {
      if (!active) {
        const { rows } = await c.query<{ qty: number }>(
          `select coalesce(sum(qty), 0) as qty from stock_moves where warehouse_id = $1`,
          [id],
        );
        if (Math.abs(Number(rows[0].qty)) > 0.0005) {
          throw new Error(
            'На складі є залишок — спершу перемістіть його на інший склад.',
          );
        }
        const { rows: def } = await c.query<{ is_default: boolean }>(
          'select is_default from warehouses where id = $1',
          [id],
        );
        if (def[0]?.is_default) {
          throw new Error('Це типовий склад свого типу — спершу призначте типовим інший.');
        }
      }
      await c.query('update warehouses set is_active = $2 where id = $1', [id, active]);
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/stock/warehouses');
  return { ok: active ? 'Склад активовано' : 'Склад деактивовано' };
}
