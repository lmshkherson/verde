'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { transaction } from '@/lib/db';
import { type ActionState, num, str, strOrNull, toMessage } from '@/lib/action-state';
import {
  allocateFefo,
  defaultWarehouseId,
  insertMoves,
  nextDocNumber,
  round2,
  round3,
  round4,
} from '@/lib/stock';
import { requireRole } from '@/lib/session';

export async function createRecipe(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('production');
  const productItemId = str(formData, 'product_item_id');
  const outputQty = num(formData, 'output_qty');
  if (!productItemId) return { error: 'Оберіть продукт' };
  if (outputQty <= 0) return { error: 'Вихід із варки має бути більшим за нуль' };

  let recipeId: string;
  try {
    recipeId = await transaction(async (c) => {
      const { rows: verRows } = await c.query<{ next: number }>(
        'select coalesce(max(version), 0) + 1 as next from recipes where product_item_id = $1',
        [productItemId],
      );
      const { rows } = await c.query<{ id: string }>(
        `insert into recipes (product_item_id, version, output_qty, notes)
         values ($1, $2, $3, $4) returning id`,
        [productItemId, verRows[0].next, outputQty, strOrNull(formData, 'notes')],
      );
      return rows[0].id;
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  redirect(`/production/recipes/${recipeId}`);
}

export async function addRecipeLine(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('production');
  const recipeId = str(formData, 'recipe_id');
  const itemId = str(formData, 'item_id');
  const qty = num(formData, 'qty_per_batch');
  const loss = num(formData, 'loss_pct');

  if (!itemId) return { error: 'Оберіть сировину' };
  if (qty <= 0) return { error: 'Кількість має бути більшою за нуль' };
  if (loss < 0 || loss >= 100) return { error: 'Відсоток втрат має бути від 0 до 99' };

  try {
    await transaction((c) =>
      c.query(
        `insert into recipe_lines (recipe_id, item_id, qty_per_batch, loss_pct)
         values ($1, $2, $3, $4)
         on conflict (recipe_id, item_id) do update
           set qty_per_batch = excluded.qty_per_batch, loss_pct = excluded.loss_pct`,
        [recipeId, itemId, qty, loss],
      ),
    );
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/production/recipes/${recipeId}`);
  return { ok: 'Компонент збережено' };
}

export async function removeRecipeLine(formData: FormData) {
  await requireRole('production');
  const recipeId = str(formData, 'recipe_id');
  await transaction((c) => c.query('delete from recipe_lines where id = $1', [str(formData, 'line_id')]));
  revalidatePath(`/production/recipes/${recipeId}`);
}

export async function createProductionOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('production');
  const recipeId = str(formData, 'recipe_id');
  const plannedQty = num(formData, 'planned_qty');
  if (!recipeId) return { error: 'Оберіть рецептуру' };
  if (plannedQty <= 0) return { error: 'Планова кількість має бути більшою за нуль' };

  let orderId: string;
  try {
    orderId = await transaction(async (c) => {
      const { rows: recipeRows } = await c.query<{ product_item_id: string }>(
        'select product_item_id from recipes where id = $1',
        [recipeId],
      );
      if (!recipeRows[0]) throw new Error('Рецептуру не знайдено');

      const number = await nextDocNumber(c, session.eid, 'ВИР');
      const { rows } = await c.query<{ id: string }>(
        `insert into production_orders
           (number, legal_entity_id, product_item_id, recipe_id, planned_qty, planned_for, note, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [
          number,
          session.eid,
          recipeRows[0].product_item_id,
          recipeId,
          plannedQty,
          strOrNull(formData, 'planned_for'),
          strOrNull(formData, 'note'),
          session.uid,
        ],
      );
      return rows[0].id;
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  redirect(`/production/${orderId}`);
}

export async function startProduction(formData: FormData) {
  await requireRole('production');
  const id = str(formData, 'order_id');
  await transaction((c) =>
    c.query(
      `update production_orders set status = 'in_progress', started_at = now()
        where id = $1 and status = 'planned'`,
      [id],
    ),
  );
  revalidatePath(`/production/${id}`);
}

export async function cancelProductionOrder(formData: FormData) {
  await requireRole('production');
  const id = str(formData, 'order_id');
  await transaction((c) =>
    c.query(
      `update production_orders set status = 'cancelled'
        where id = $1 and status in ('planned','in_progress')`,
      [id],
    ),
  );
  revalidatePath(`/production/${id}`);
}

/**
 * Закриття варки — головна операція виробництва.
 * Списує фактично використану сировину партіями за FEFO, рахує собівартість
 * (сировина + накладні) і оприбутковує готову продукцію окремою партією
 * з власним терміном придатності. Усе в одній транзакції: або весь документ, або нічого.
 */
export async function completeProduction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('production');
  const orderId = str(formData, 'order_id');
  const producedQty = round3(num(formData, 'produced_qty'));
  const overhead = round2(num(formData, 'overhead_cost'));

  if (producedQty <= 0) return { error: 'Вкажіть фактичний випуск' };
  if (overhead < 0) return { error: 'Накладні витрати не можуть бути від’ємними' };

  try {
    await transaction(async (c) => {
      const { rows: orderRows } = await c.query<{
        id: string;
        number: string;
        status: string;
        product_item_id: string;
        recipe_id: string;
        legal_entity_id: string;
        planned_qty: number;
        output_qty: number;
        product_kind: string;
        shelf_life_days: number | null;
        sku: string;
        overhead_policy: string;
      }>(
        `select po.id, po.number, po.status, po.product_item_id, po.recipe_id,
                po.legal_entity_id, po.planned_qty,
                r.output_qty, i.kind as product_kind, i.shelf_life_days, i.sku,
                e.overhead_policy
           from production_orders po
           join recipes r on r.id = po.recipe_id
           join items i on i.id = po.product_item_id
           join legal_entities e on e.id = po.legal_entity_id
          where po.id = $1
          for update of po`,
        [orderId],
      );
      const order = orderRows[0];
      if (!order) throw new Error('Виробниче замовлення не знайдено');
      if (order.status === 'done') throw new Error('Замовлення вже закрите');
      if (order.status === 'cancelled') throw new Error('Замовлення скасоване');

      const { rows: recipeLines } = await c.query<{
        item_id: string;
        qty_per_batch: number;
        loss_pct: number;
        name: string;
        unit: string;
      }>(
        `select rl.item_id, rl.qty_per_batch, rl.loss_pct, i.name, i.unit
           from recipe_lines rl join items i on i.id = rl.item_id
          where rl.recipe_id = $1 order by i.name`,
        [order.recipe_id],
      );
      if (recipeLines.length === 0) throw new Error('У рецептурі немає жодного компонента');

      const rawWarehouseId = await defaultWarehouseId(c, 'raw');
      const outputWarehouseId = await defaultWarehouseId(
        c,
        order.product_kind === 'semi' ? 'wip' : 'finished',
      );

      let materialCost = 0;

      for (const line of recipeLines) {
        // За замовчуванням — норма за рецептурою, перерахована на фактичний випуск.
        // Технолог може виправити на те, що реально пішло у варку.
        const suggested = round3(
          (line.qty_per_batch * (1 + line.loss_pct / 100) * producedQty) / order.output_qty,
        );
        const qty = round3(num(formData, `consume_${line.item_id}`, suggested));
        if (qty <= 0) continue;

        const allocations = await allocateFefo(
          c,
          line.item_id,
          rawWarehouseId,
          order.legal_entity_id,
          qty,
        );
        for (const a of allocations) {
          materialCost += a.qty * a.unitCost;
          await insertMoves(c, [
            {
              itemId: line.item_id,
              legalEntityId: order.legal_entity_id,
              batchId: a.batchId,
              warehouseId: rawWarehouseId,
              qty: -a.qty,
              unitCost: a.unitCost,
              moveType: 'production_consume',
              docType: 'production_order',
              docId: orderId,
              userId: session.uid,
              note: `Списано у варку ${order.number}`,
            },
          ]);
        }
      }

      materialCost = round2(materialCost);

      // За політикою «витрати періоду» електроенергія й зарплата цеху не
      // капіталізуються: собівартість партії — це рівно спожита сировина.
      const capitalize = order.overhead_policy === 'capitalize';
      const appliedOverhead = capitalize ? overhead : 0;
      const unitCost = round4((materialCost + appliedOverhead) / producedQty);

      const today = new Date().toISOString().slice(0, 10);
      const batchCode = str(formData, 'batch_code') || `${order.sku}/${order.number}`;
      const expiresOn = order.shelf_life_days
        ? new Date(Date.now() + order.shelf_life_days * 86_400_000).toISOString().slice(0, 10)
        : null;

      const { rows: batchRows } = await c.query<{ id: string }>(
        `insert into batches (item_id, code, produced_on, expires_on, source)
         values ($1, $2, $3, $4, 'production')
         on conflict (item_id, code) do update set expires_on = excluded.expires_on
         returning id`,
        [order.product_item_id, batchCode, today, expiresOn],
      );

      await insertMoves(c, [
        {
          itemId: order.product_item_id,
          legalEntityId: order.legal_entity_id,
          batchId: batchRows[0].id,
          warehouseId: outputWarehouseId,
          qty: producedQty,
          unitCost,
          moveType: 'production_output',
          docType: 'production_order',
          docId: orderId,
          userId: session.uid,
          note: `Випуск за ${order.number}`,
        },
      ]);

      await c.query(
        `update production_orders
            set status = 'done', produced_qty = $2, overhead_cost = $3,
                output_batch_id = $4, finished_at = now(),
                started_at = coalesce(started_at, now())
          where id = $1`,
        [orderId, producedQty, appliedOverhead, batchRows[0].id],
      );

      await c.query(
        `insert into audit_log (user_id, action, entity, entity_id, details)
         values ($1, 'complete', 'production_order', $2, $3)`,
        [
          session.uid,
          orderId,
          JSON.stringify({ producedQty, materialCost, overhead: appliedOverhead, unitCost }),
        ],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/production/${orderId}`);
  revalidatePath('/stock');
  return { ok: 'Варку закрито, продукцію оприбутковано' };
}
