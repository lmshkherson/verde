'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { transaction } from '@/lib/db';
import { type ActionState, num, str, strOrNull, toMessage } from '@/lib/action-state';
import {
  allocateFefo,
  defaultWarehouseId,
  insertMoves,
  lockItem,
  nextDocNumber,
  round2,
  round3,
} from '@/lib/stock';
import { requireRole } from '@/lib/session';

/**
 * Повернення постачальнику — дзеркало повернення від клієнта, але простіше:
 * доходу тут немає. Є запаси, які йдуть зі складу, кредиторка, яка меншає, і
 * податковий кредит, який доводиться зняти.
 *
 * Прив'язка до заявки, як і в продажах, необов'язкова: партію могли привезти
 * три місяці тому, а брак виявитись зараз.
 */
export async function createSupplierReturn(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireRole('warehouse');
  const supplierId = str(formData, 'supplier_id');
  const poId = strOrNull(formData, 'po_id');

  if (!supplierId && !poId) return { error: 'Оберіть постачальника або заявку' };

  let returnId: string;
  try {
    returnId = await transaction(async (c) => {
      let resolvedSupplier = supplierId;

      if (poId) {
        const { rows } = await c.query<{ supplier_id: string; entity: string; status: string }>(
          'select supplier_id, legal_entity_id as entity, status from purchase_orders where id = $1',
          [poId],
        );
        if (!rows[0]) throw new Error('Заявку не знайдено');
        if (rows[0].entity !== session.eid) {
          throw new Error('Заявка належить іншій юрособі — перемкніть її вгорі');
        }
        resolvedSupplier = rows[0].supplier_id;
      }

      const number = await nextDocNumber(c, session.eid, 'ПВП');
      const { rows } = await c.query<{ id: string }>(
        `insert into supplier_returns
           (number, legal_entity_id, supplier_id, po_id, returned_on, reason, note, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [
          number,
          session.eid,
          resolvedSupplier,
          poId,
          str(formData, 'returned_on') || new Date().toISOString().slice(0, 10),
          str(formData, 'reason') || 'quality',
          strOrNull(formData, 'note'),
          session.uid,
        ],
      );
      return rows[0].id;
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  redirect(`/purchasing/returns/${returnId}`);
}

/**
 * Рядок повернення. Собівартість береться з фактичних рухів приходу — тобто з
 * того, за скільки партія стала на облік. У платника ПДВ це база без податку,
 * у єдинника — повна ціна, і саме ця різниця робить формулу зняття кредиту
 * простою: податок завжди дорівнює базі, помноженій на ставку.
 */
export async function addSupplierReturnLine(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireRole('warehouse');
  const returnId = str(formData, 'return_id');
  const poLineId = strOrNull(formData, 'po_line_id');
  const freeItemId = strOrNull(formData, 'item_id');
  const qty = round3(num(formData, 'qty'));

  if (!poLineId && !freeItemId) return { error: 'Оберіть позицію' };
  if (qty <= 0) return { error: 'Кількість має бути більшою за нуль' };

  try {
    await transaction(async (c) => {
      const { rows: retRows } = await c.query<{
        status: string;
        po_id: string | null;
        buyer_is_vat_payer: boolean;
        supplier_is_vat_payer: boolean;
      }>(
        `select r.status, r.po_id,
                e.is_vat_payer as buyer_is_vat_payer,
                s.is_vat_payer as supplier_is_vat_payer
           from supplier_returns r
           join legal_entities e on e.id = r.legal_entity_id
           join suppliers s on s.id = r.supplier_id
          where r.id = $1
          for update of r`,
        [returnId],
      );
      const ret = retRows[0];
      if (!ret) throw new Error('Повернення не знайдено');
      if (ret.status !== 'draft') throw new Error('Позиції можна додавати лише в чернетку');

      let itemId = freeItemId ?? '';
      let vatRate = 20;

      if (poLineId) {
        const { rows } = await c.query<{
          item_id: string;
          received_qty: number;
          returned_qty: number;
          vat_rate: number;
          name: string;
        }>(
          `select l.item_id, l.received_qty, l.vat_rate, i.name,
                  coalesce(r.returned_qty, 0) as returned_qty
             from purchase_order_lines l
             join items i on i.id = l.item_id
             left join v_po_line_returned r on r.po_line_id = l.id
            where l.id = $1`,
          [poLineId],
        );
        const line = rows[0];
        if (!line) throw new Error('Рядок заявки не знайдено');

        const left = round3(Number(line.received_qty) - Number(line.returned_qty));
        if (qty > left + 0.0005) {
          throw new Error(
            `«${line.name}»: повертається більше, ніж отримано. Доступно ${left}.`,
          );
        }
        itemId = line.item_id;
        vatRate = Number(line.vat_rate);
      } else {
        const { rows } = await c.query<{ vat_rate: number }>(
          'select vat_rate from items where id = $1',
          [itemId],
        );
        if (!rows[0]) throw new Error('Номенклатуру не знайдено');
        vatRate = Number(rows[0].vat_rate);
      }

      // Кредит виникав лише тоді, коли обидві сторони платники ПДВ, — знімати
      // його треба за тим самим правилом.
      const creditable = ret.buyer_is_vat_payer && ret.supplier_is_vat_payer;

      // Партії беремо ті, що прийшли за цією заявкою; без прив'язки — за FEFO.
      const warehouseId = await defaultWarehouseId(c, 'raw');
      await lockItem(c, itemId, session.eid);

      let allocations: { batchId: string; qty: number; unitCost: number }[];
      if (ret.po_id) {
        const { rows: batches } = await c.query<{ batch_id: string; qty: number; unit_cost: number }>(
          `select sb.batch_id, sb.qty, max(m.unit_cost) as unit_cost
             from v_stock_batches sb
             join stock_moves m on m.batch_id = sb.batch_id and m.item_id = sb.item_id
                               and m.doc_type = 'purchase_order' and m.doc_id = $3
                               and m.move_type = 'purchase_receipt'
             join batches b on b.id = sb.batch_id
            where sb.item_id = $1 and sb.legal_entity_id = $2 and sb.qty > 0
            group by sb.batch_id, sb.qty, b.expires_on
            order by b.expires_on nulls last`,
          [itemId, session.eid, ret.po_id],
        );
        allocations = [];
        let leftToTake = qty;
        for (const b of batches) {
          if (leftToTake <= 0.0005) break;
          const take = round3(Math.min(leftToTake, Number(b.qty)));
          allocations.push({ batchId: b.batch_id, qty: take, unitCost: Number(b.unit_cost) });
          leftToTake = round3(leftToTake - take);
        }
        if (leftToTake > 0.0005) {
          throw new Error(
            `На складі немає стільки товару з цієї заявки: бракує ${leftToTake}. ` +
              'Можливо, партію вже спожили у виробництві.',
          );
        }
      } else {
        allocations = await allocateFefo(c, itemId, warehouseId, session.eid, qty);
      }

      for (const a of allocations) {
        await c.query(
          `insert into supplier_return_lines
             (return_id, item_id, po_line_id, batch_id, qty, unit_cost, unit_vat, vat_rate)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            returnId,
            itemId,
            poLineId,
            a.batchId,
            a.qty,
            a.unitCost,
            creditable ? round2((a.unitCost * vatRate) / 100) : 0,
            vatRate,
          ],
        );
      }
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/purchasing/returns/${returnId}`);
  return { ok: 'Позицію додано' };
}

export async function removeSupplierReturnLine(formData: FormData) {
  await requireRole('warehouse');
  const returnId = str(formData, 'return_id');
  await transaction((c) =>
    c.query(
      `delete from supplier_return_lines l using supplier_returns r
        where l.id = $1 and l.return_id = r.id and r.status = 'draft'`,
      [str(formData, 'line_id')],
    ),
  );
  revalidatePath(`/purchasing/returns/${returnId}`);
}

/**
 * Проведення. Товар іде зі складу, кредиторка меншає, податковий кредит
 * знімається від'ємним записом у реєстрі ПДВ.
 *
 * Розрахунок коригування тут складає постачальник — ми лише отримуємо його й
 * реєструємо, бо при зменшенні суми компенсації РК подає покупець. Це наш
 * обов'язок, і поки він не виконаний, кредит формально не знятий.
 */
export async function acceptSupplierReturn(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireRole('warehouse');
  const returnId = str(formData, 'return_id');

  try {
    await transaction(async (c) => {
      const { rows: retRows } = await c.query<{
        number: string;
        status: string;
        legal_entity_id: string;
        returned_on: string;
        supplier_name: string;
        supplier_edrpou: string | null;
      }>(
        `select r.number, r.status, r.legal_entity_id, r.returned_on,
                s.name as supplier_name, s.edrpou as supplier_edrpou
           from supplier_returns r
           join suppliers s on s.id = r.supplier_id
          where r.id = $1
          for update of r`,
        [returnId],
      );
      const ret = retRows[0];
      if (!ret) throw new Error('Повернення не знайдено');
      if (ret.status !== 'draft') throw new Error('Повернення вже проведене або скасоване');

      const { rows: lines } = await c.query<{
        item_id: string;
        batch_id: string | null;
        qty: number;
        unit_cost: number;
        unit_vat: number;
        vat_rate: number;
        name: string;
      }>(
        `select l.item_id, l.batch_id, l.qty, l.unit_cost, l.unit_vat, l.vat_rate, i.name
           from supplier_return_lines l join items i on i.id = l.item_id
          where l.return_id = $1 order by i.name`,
        [returnId],
      );
      if (lines.length === 0) throw new Error('У поверненні немає жодної позиції');

      const warehouseId = await defaultWarehouseId(c, 'raw');
      let net = 0;
      let vat = 0;

      for (const line of lines) {
        await lockItem(c, line.item_id, ret.legal_entity_id);

        // Між створенням рядка й проведенням товар могли спожити у варці.
        const { rows: onHand } = await c.query<{ qty: number }>(
          `select coalesce(sum(qty), 0) as qty from stock_moves
            where item_id = $1 and legal_entity_id = $2 and batch_id = $3`,
          [line.item_id, ret.legal_entity_id, line.batch_id],
        );
        if (Number(onHand[0].qty) < Number(line.qty) - 0.0005) {
          throw new Error(
            `«${line.name}»: на складі лишилось ${Number(onHand[0].qty)}, а повертається ${line.qty}.`,
          );
        }

        await insertMoves(c, [
          {
            itemId: line.item_id,
            legalEntityId: ret.legal_entity_id,
            batchId: line.batch_id,
            warehouseId,
            qty: -Number(line.qty),
            unitCost: Number(line.unit_cost),
            moveType: 'purchase_return',
            docType: 'supplier_return',
            docId: returnId,
            userId: session.uid,
            note: `Повернення ${ret.number}`,
          },
        ]);

        net += Number(line.unit_cost) * Number(line.qty);
        vat += Number(line.unit_vat) * Number(line.qty);
      }

      // Від'ємний кредит у реєстрі: сума до відшкодування меншає.
      if (vat > 0.005) {
        await c.query(
          `insert into vat_entries
             (legal_entity_id, kind, doc_type, doc_id, doc_number, occurred_on,
              base_amount, vat_amount, vat_rate, counterparty_name, counterparty_edrpou)
           values ($1, 'credit', 'supplier_return', $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            ret.legal_entity_id,
            returnId,
            ret.number,
            ret.returned_on,
            -round2(net),
            -round2(vat),
            lines[0].vat_rate,
            ret.supplier_name,
            ret.supplier_edrpou,
          ],
        );
      }

      await c.query("update supplier_returns set status = 'accepted' where id = $1", [returnId]);

      await c.query(
        `insert into audit_log (user_id, action, entity, entity_id, details)
         values ($1, 'accept', 'supplier_return', $2, $3)`,
        [session.uid, returnId, JSON.stringify({ net: round2(net), vat: round2(vat), lines: lines.length })],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/purchasing/returns/${returnId}`);
  revalidatePath('/purchasing/returns');
  revalidatePath('/stock');
  return { ok: 'Повернення проведено' };
}

export async function cancelSupplierReturn(formData: FormData) {
  await requireRole('warehouse');
  const returnId = str(formData, 'return_id');
  await transaction((c) =>
    c.query("update supplier_returns set status = 'cancelled' where id = $1 and status = 'draft'", [
      returnId,
    ]),
  );
  revalidatePath(`/purchasing/returns/${returnId}`);
  revalidatePath('/purchasing/returns');
}
