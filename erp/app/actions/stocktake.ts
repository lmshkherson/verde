'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { transaction } from '@/lib/db';
import { type ActionState, num, str, strOrNull, toMessage } from '@/lib/action-state';
import { insertMoves, lockItem, nextDocNumber, round3 } from '@/lib/stock';
import { requireRole } from '@/lib/session';

/**
 * Відкриття опису. Обліковий залишок фіксується зрізом на цей момент — опис
 * має бути фотографією складу на дату, а не живим запитом: поки комісія
 * рахує, по складу можуть пройти рухи, і цифра в бланку не має від них
 * стрибати.
 */
export async function openStocktake(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('warehouse', 'production');
  const warehouseId = str(formData, 'warehouse_id');
  if (!warehouseId) return { error: 'Оберіть склад' };

  let id: string;
  try {
    id = await transaction(async (c) => {
      const number = await nextDocNumber(c, session.eid, 'ІНВ');
      const { rows } = await c.query<{ id: string }>(
        `insert into stocktakes
           (number, legal_entity_id, warehouse_id, counted_on, chairman, commission, responsible, note, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [
          number,
          session.eid,
          warehouseId,
          str(formData, 'counted_on') || new Date().toISOString().slice(0, 10),
          strOrNull(formData, 'chairman'),
          strOrNull(formData, 'commission'),
          strOrNull(formData, 'responsible'),
          strOrNull(formData, 'note'),
          session.uid,
        ],
      );
      const stocktakeId = rows[0].id;

      await c.query(
        `insert into stocktake_lines (stocktake_id, item_id, batch_id, book_qty, unit_cost)
         select $1, sb.item_id, sb.batch_id, sb.qty,
                case when sb.qty <> 0 then sb.value / sb.qty else 0 end
           from v_stock_batches sb
          where sb.legal_entity_id = $2 and sb.warehouse_id = $3`,
        [stocktakeId, session.eid, warehouseId],
      );

      return stocktakeId;
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  redirect(`/stocktake/${id}`);
}

/** Введення фактичної кількості по рядку. */
export async function countLine(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('warehouse', 'production');
  const stocktakeId = str(formData, 'stocktake_id');
  const lineId = str(formData, 'line_id');
  const raw = str(formData, 'counted_qty');

  try {
    await transaction(async (c) => {
      const { rows } = await c.query<{ status: string }>(
        `select s.status from stocktakes s
           join stocktake_lines l on l.stocktake_id = s.id
          where l.id = $1`,
        [lineId],
      );
      if (!rows[0]) throw new Error('Рядок не знайдено');
      if (rows[0].status === 'completed' || rows[0].status === 'cancelled') {
        throw new Error('Опис уже закритий — факт не змінюється');
      }

      // Порожнє поле повертає рядок у стан «ще не рахували». Нуль означає
      // протилежне: комісія подивилась і полиця порожня.
      const counted = raw === '' ? null : round3(num(formData, 'counted_qty'));
      if (counted !== null && counted < 0) throw new Error('Фактична кількість не може бути від’ємною');

      await c.query('update stocktake_lines set counted_qty = $2, note = $3 where id = $1', [
        lineId,
        counted,
        strOrNull(formData, 'note'),
      ]);
      await c.query("update stocktakes set status = 'counting' where id = $1 and status = 'draft'", [
        stocktakeId,
      ]);
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/stocktake/${stocktakeId}`);
  return { ok: 'Записано' };
}

/**
 * Завершення опису: розбіжності стають рухами коригування.
 *
 * Різниця рахується не від зрізу, а від **поточного** облікового залишку:
 * якщо поки рахували, по позиції пройшло відвантаження, коригувати треба до
 * того, що є зараз, інакше система відтворить уже неактуальну картину. Зріз
 * лишається в описі як свідчення того, що бачила комісія.
 */
export async function completeStocktake(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireRole('warehouse', 'production');
  const id = str(formData, 'stocktake_id');
  let adjusted = 0;

  try {
    adjusted = await transaction(async (c) => {
      const { rows: docRows } = await c.query<{
        number: string;
        status: string;
        warehouse_id: string;
        counted_on: string;
      }>(
        'select number, status, warehouse_id, counted_on from stocktakes where id = $1 and legal_entity_id = $2 for update',
        [id, session.eid],
      );
      const doc = docRows[0];
      if (!doc) throw new Error('Опис не знайдено');
      if (doc.status !== 'counting' && doc.status !== 'draft') {
        throw new Error('Опис уже закритий або скасований');
      }

      const { rows: lines } = await c.query<{
        id: string;
        item_id: string;
        batch_id: string | null;
        counted_qty: number | null;
        unit_cost: number;
        name: string;
      }>(
        `select l.id, l.item_id, l.batch_id, l.counted_qty, l.unit_cost, i.name
           from stocktake_lines l join items i on i.id = l.item_id
          where l.stocktake_id = $1 and l.counted_qty is not null`,
        [id],
      );
      if (lines.length === 0) throw new Error('Не внесено жодної фактичної кількості');

      let moves = 0;
      for (const line of lines) {
        await lockItem(c, line.item_id, session.eid);

        const { rows: actual } = await c.query<{ qty: number }>(
          `select coalesce(sum(qty), 0) as qty from stock_moves
            where item_id = $1 and legal_entity_id = $2 and warehouse_id = $3
              and batch_id is not distinct from $4`,
          [line.item_id, session.eid, doc.warehouse_id, line.batch_id],
        );

        const diff = round3(Number(line.counted_qty) - Number(actual[0].qty));
        if (Math.abs(diff) < 0.0005) continue;

        await insertMoves(c, [
          {
            itemId: line.item_id,
            legalEntityId: session.eid,
            batchId: line.batch_id,
            warehouseId: doc.warehouse_id,
            qty: diff,
            unitCost: Number(line.unit_cost),
            moveType: 'adjustment',
            docType: 'stocktake',
            docId: id,
            userId: session.uid,
            note: `${diff > 0 ? 'Надлишок' : 'Нестача'} за описом ${doc.number}`,
          },
        ]);
        moves += 1;
      }

      await c.query(
        "update stocktakes set status = 'completed', completed_at = now() where id = $1",
        [id],
      );
      await c.query(
        `insert into audit_log (user_id, action, entity, entity_id, details)
         values ($1, 'complete', 'stocktake', $2, $3)`,
        [session.uid, id, JSON.stringify({ lines: lines.length, moves })],
      );

      return moves;
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/stocktake/${id}`);
  revalidatePath('/stocktake');
  revalidatePath('/stock');
  return {
    ok:
      adjusted > 0
        ? `Опис закрито, проведено коригувань: ${adjusted}`
        : 'Опис закрито — розбіжностей не виявлено',
  };
}

export async function cancelStocktake(formData: FormData) {
  await requireRole('warehouse', 'production');
  const id = str(formData, 'stocktake_id');
  await transaction((c) =>
    c.query(
      "update stocktakes set status = 'cancelled' where id = $1 and status in ('draft','counting')",
      [id],
    ),
  );
  revalidatePath(`/stocktake/${id}`);
  revalidatePath('/stocktake');
}
