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

/** Проведені версії недоторканні: історія варок мусить читатися як була. */
async function assertRecipeDraft(c: import('pg').PoolClient, recipeId: string) {
  const { rows } = await c.query<{ approved_at: string | null }>(
    'select approved_at from recipes where id = $1',
    [recipeId],
  );
  if (!rows[0]) throw new Error('Рецептуру не знайдено');
  if (rows[0].approved_at) {
    throw new Error(
      'Цю версію вже проведено — вона зафіксована. Створіть нову версію на її основі.',
    );
  }
}

/**
 * Нова версія на основі наявної: копіює вихід, примітки й усі компоненти в
 * чернетку. Саме так змінюють діючу карту — замінили інгредієнт у копії,
 * провели з дати, і з того дня виробництво рахується по-новому.
 */
export async function cloneRecipe(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('production');
  const sourceId = str(formData, 'recipe_id');

  let recipeId: string;
  try {
    recipeId = await transaction(async (c) => {
      const { rows: src } = await c.query<{
        product_item_id: string;
        output_qty: number;
        notes: string | null;
      }>('select product_item_id, output_qty, notes from recipes where id = $1', [sourceId]);
      if (!src[0]) throw new Error('Рецептуру не знайдено');

      const { rows: verRows } = await c.query<{ next: number }>(
        'select coalesce(max(version), 0) + 1 as next from recipes where product_item_id = $1',
        [src[0].product_item_id],
      );
      const { rows } = await c.query<{ id: string }>(
        `insert into recipes (product_item_id, version, output_qty, notes)
         values ($1, $2, $3, $4) returning id`,
        [src[0].product_item_id, verRows[0].next, src[0].output_qty, src[0].notes],
      );
      await c.query(
        `insert into recipe_lines (recipe_id, item_id, qty_per_batch, loss_pct)
         select $1, item_id, qty_per_batch, loss_pct from recipe_lines where recipe_id = $2`,
        [rows[0].id, sourceId],
      );
      return rows[0].id;
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  redirect(`/production/recipes/${recipeId}`);
}

/**
 * Проведення версії. З дати «діє з» нові варки цього продукту беруть саме її;
 * усе, що проведено раніше, назавжди лишається на попередніх версіях.
 */
export async function approveRecipe(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('production');
  const recipeId = str(formData, 'recipe_id');
  const effectiveFrom = str(formData, 'effective_from');

  if (!effectiveFrom) return { error: 'Вкажіть, з якої дати діє ця версія' };

  try {
    await transaction(async (c) => {
      await assertRecipeDraft(c, recipeId);
      const { rows: lines } = await c.query<{ n: number }>(
        'select count(*)::int as n from recipe_lines where recipe_id = $1',
        [recipeId],
      );
      if (lines[0].n === 0) throw new Error('У версії немає жодного компонента — проводити нічого');

      await c.query(
        `update recipes set effective_from = $2, approved_at = now(), approved_by = $3
          where id = $1`,
        [recipeId, effectiveFrom, session.uid],
      );
      await c.query(
        `insert into audit_log (user_id, action, entity, entity_id, details)
         values ($1, 'approve', 'recipe', $2, $3)`,
        [session.uid, recipeId, JSON.stringify({ effective_from: effectiveFrom })],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/production/recipes/${recipeId}`);
  revalidatePath('/production/recipes');
  revalidatePath('/production');
  return { ok: 'Версію проведено — з цієї дати виробництво рахується за нею' };
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
    await transaction(async (c) => {
      await assertRecipeDraft(c, recipeId);
      await c.query(
        `insert into recipe_lines (recipe_id, item_id, qty_per_batch, loss_pct)
         values ($1, $2, $3, $4)
         on conflict (recipe_id, item_id) do update
           set qty_per_batch = excluded.qty_per_batch, loss_pct = excluded.loss_pct`,
        [recipeId, itemId, qty, loss],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/production/recipes/${recipeId}`);
  return { ok: 'Компонент збережено' };
}

export async function removeRecipeLine(formData: FormData) {
  await requireRole('production');
  const recipeId = str(formData, 'recipe_id');
  await transaction(async (c) => {
    await assertRecipeDraft(c, recipeId);
    await c.query('delete from recipe_lines where id = $1', [str(formData, 'line_id')]);
  });
  revalidatePath(`/production/recipes/${recipeId}`);
}

export async function createProductionOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('production');
  const productItemId = str(formData, 'product_item_id');
  const plannedQty = num(formData, 'planned_qty');
  if (!productItemId) return { error: 'Оберіть продукт' };
  if (plannedQty <= 0) return { error: 'Планова кількість має бути більшою за нуль' };

  let orderId: string;
  try {
    orderId = await transaction(async (c) => {
      const plannedFor = strOrNull(formData, 'planned_for');

      // Версію техкарти обирає не людина, а дата виробництва: остання
      // проведена, що діяла на цей день. Так «з цього дня рахуємо по-новому»
      // виконується саме собою, а старі варки лишаються на своїх версіях.
      const { rows: recipeRows } = await c.query<{ id: string; version: number }>(
        `select id, version from recipes
          where product_item_id = $1 and is_active and approved_at is not null
            and effective_from <= coalesce($2::date, current_date)
          order by effective_from desc, version desc
          limit 1`,
        [productItemId, plannedFor],
      );
      if (!recipeRows[0]) {
        throw new Error(
          'Немає проведеної техкарти, чинної на цю дату. Проведіть версію в «Рецептурах» або змініть дату виробництва.',
        );
      }

      const number = await nextDocNumber(c, session.eid, 'ВИР');
      const { rows } = await c.query<{ id: string }>(
        `insert into production_orders
           (number, legal_entity_id, product_item_id, recipe_id, planned_qty, planned_for, note, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [
          number,
          session.eid,
          productItemId,
          recipeRows[0].id,
          plannedQty,
          plannedFor,
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

/** Шапка варки: дату виробництва й примітку можна виправити до закриття. */
export async function updateProductionHeader(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('production');
  const orderId = str(formData, 'order_id');

  try {
    await transaction(async (c) => {
      const { rows } = await c.query<{ status: string }>(
        'select status from production_orders where id = $1',
        [orderId],
      );
      if (!rows[0]) throw new Error('Документ не знайдено');
      if (!['planned', 'in_progress'].includes(rows[0].status)) {
        throw new Error('Варку вже закрито — шапка зафіксована');
      }
      await c.query(
        'update production_orders set planned_for = $2, note = $3 where id = $1',
        [orderId, strOrNull(formData, 'planned_for'), strOrNull(formData, 'note')],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/production/${orderId}`);
  return { ok: 'Шапку збережено' };
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
