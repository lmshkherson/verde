'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { transaction } from '@/lib/db';
import { type ActionState, num, str, strOrNull, toMessage } from '@/lib/action-state';
import { defaultWarehouseId, insertMoves, nextDocNumber, round2, round3 } from '@/lib/stock';
import { requireRole } from '@/lib/session';

/**
 * Повернення від клієнта. Документ навмисно дозволяє два способи роботи:
 *
 *  — **з прив'язкою до відвантаження**: ціна й собівартість беруться з нього,
 *    кількість обмежена тим, що реально везли. Так правильно;
 *  — **без прив'язки**: клієнт привіз товар, а якою накладною його везли —
 *    не пам'ятає ніхто. Заборонити такий випадок означало б, що повернення
 *    оформлять «якось інакше», тобто ніяк.
 */
export async function createReturn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('sales', 'warehouse');
  const customerId = str(formData, 'customer_id');
  const shipmentId = strOrNull(formData, 'shipment_id');

  if (!customerId && !shipmentId) return { error: 'Оберіть клієнта або відвантаження' };

  let returnId: string;
  try {
    returnId = await transaction(async (c) => {
      let soId: string | null = null;
      let resolvedCustomer = customerId;

      if (shipmentId) {
        const { rows } = await c.query<{ so_id: string; customer_id: string; entity: string }>(
          `select o.id as so_id, o.customer_id, o.legal_entity_id as entity
             from shipments sh join sales_orders o on o.id = sh.so_id
            where sh.id = $1`,
          [shipmentId],
        );
        if (!rows[0]) throw new Error('Відвантаження не знайдено');
        if (rows[0].entity !== session.eid) {
          throw new Error('Відвантаження належить іншій юрособі — перемкніть її вгорі');
        }
        soId = rows[0].so_id;
        resolvedCustomer = rows[0].customer_id;
      }

      const number = await nextDocNumber(c, session.eid, 'ПОВ');
      const { rows } = await c.query<{ id: string }>(
        `insert into customer_returns
           (number, legal_entity_id, customer_id, so_id, shipment_id, returned_on, reason, note, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [
          number,
          session.eid,
          resolvedCustomer,
          soId,
          shipmentId,
          str(formData, 'returned_on') || new Date().toISOString().slice(0, 10),
          str(formData, 'reason') || 'surplus',
          strOrNull(formData, 'note'),
          session.uid,
        ],
      );
      return rows[0].id;
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  redirect(`/returns/${returnId}`);
}

/**
 * Рядок повернення з прив'язкою до відвантаження. Ціна й ставка беруться з
 * замовлення, а собівартість — із фактичних складських рухів того відвантаження:
 * товар має повернутися за тією ж вартістю, за якою пішов, інакше повернення
 * саме по собі створило б прибуток або збиток.
 */
export async function addReturnLineFromShipment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole('sales', 'warehouse');
  const returnId = str(formData, 'return_id');
  const shipmentLineId = str(formData, 'shipment_line_id');
  const qty = round3(num(formData, 'qty'));
  const toStock = formData.get('to_stock') === 'on';

  if (!shipmentLineId) return { error: 'Оберіть позицію з відвантаження' };
  if (qty <= 0) return { error: 'Кількість має бути більшою за нуль' };

  try {
    await transaction(async (c) => {
      const { rows: statusRows } = await c.query<{ status: string }>(
        'select status from customer_returns where id = $1 for update',
        [returnId],
      );
      if (statusRows[0]?.status !== 'draft') {
        throw new Error('Позиції можна додавати лише в чернетку');
      }

      const { rows } = await c.query<{
        item_id: string;
        shipped_qty: number;
        returned_qty: number;
        unit_price: number;
        vat_rate: number;
        name: string;
        shipment_id: string;
      }>(
        `select sl.item_id, sl.qty as shipped_qty, sl.shipment_id,
                coalesce(r.returned_qty, 0) as returned_qty,
                l.unit_price, l.vat_rate, i.name
           from shipment_lines sl
           join sales_order_lines l on l.id = sl.so_line_id
           join items i on i.id = sl.item_id
           left join v_shipment_line_returned r on r.shipment_line_id = sl.id
          where sl.id = $1`,
        [shipmentLineId],
      );
      const line = rows[0];
      if (!line) throw new Error('Рядок відвантаження не знайдено');

      const left = round3(Number(line.shipped_qty) - Number(line.returned_qty));
      if (qty > left + 0.0005) {
        throw new Error(
          `«${line.name}»: повертається більше, ніж відвантажено. Доступно ${left}.`,
        );
      }

      // Партії того відвантаження в порядку списання. Повертаємо в ті самі —
      // з їхньою собівартістю й їхніми термінами придатності.
      const { rows: batches } = await c.query<{ batch_id: string; qty: number; unit_cost: number }>(
        `select m.batch_id, sum(-m.qty) as qty, max(m.unit_cost) as unit_cost
           from stock_moves m
           join batches b on b.id = m.batch_id
          where m.doc_type = 'shipment' and m.doc_id = $1
            and m.move_type = 'sale_shipment' and m.item_id = $2
          group by m.batch_id, b.expires_on
          order by b.expires_on nulls last`,
        [line.shipment_id, line.item_id],
      );

      let left_to_place = qty;
      for (const b of batches) {
        if (left_to_place <= 0.0005) break;
        const take = round3(Math.min(left_to_place, Number(b.qty)));
        await c.query(
          `insert into customer_return_lines
             (return_id, item_id, shipment_line_id, batch_id, qty, unit_price, vat_rate, unit_cost, to_stock)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            returnId,
            line.item_id,
            shipmentLineId,
            b.batch_id,
            take,
            line.unit_price,
            line.vat_rate,
            b.unit_cost,
            toStock,
          ],
        );
        left_to_place = round3(left_to_place - take);
      }
      if (left_to_place > 0.0005) {
        throw new Error('Не вдалося зіставити повернення з партіями відвантаження');
      }
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/returns/${returnId}`);
  return { ok: 'Позицію додано' };
}

/**
 * Рядок повернення без прив'язки. Ціну й собівартість вводить людина: система
 * не може їх знати, а мовчки підставити середню — означало б видати здогад за
 * факт. Значення підказуються у формі, але відповідальність за них — на тому,
 * хто приймає товар.
 */
export async function addReturnLineFree(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('sales', 'warehouse');
  const returnId = str(formData, 'return_id');
  const itemId = str(formData, 'item_id');
  const qty = round3(num(formData, 'qty'));
  const unitPrice = num(formData, 'unit_price');
  const unitCost = num(formData, 'unit_cost');
  const toStock = formData.get('to_stock') === 'on';

  if (!itemId) return { error: 'Оберіть номенклатуру' };
  if (qty <= 0) return { error: 'Кількість має бути більшою за нуль' };
  if (unitPrice <= 0) return { error: 'Вкажіть ціну, за якою товар продавали' };
  if (toStock && unitCost <= 0) {
    return { error: 'Вкажіть собівартість: без неї товар стане на склад за нуль' };
  }

  try {
    await transaction(async (c) => {
      const { rows: statusRows } = await c.query<{ status: string }>(
        'select status from customer_returns where id = $1 for update',
        [returnId],
      );
      if (statusRows[0]?.status !== 'draft') {
        throw new Error('Позиції можна додавати лише в чернетку');
      }

      await c.query(
        `insert into customer_return_lines
           (return_id, item_id, qty, unit_price, vat_rate, unit_cost, to_stock)
         values ($1, $2, $3, $4, (select vat_rate from items where id = $2), $5, $6)`,
        [returnId, itemId, qty, unitPrice, unitCost, toStock],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/returns/${returnId}`);
  return { ok: 'Позицію додано' };
}

export async function removeReturnLine(formData: FormData) {
  await requireRole('sales', 'warehouse');
  const returnId = str(formData, 'return_id');
  await transaction((c) =>
    c.query(
      `delete from customer_return_lines l using customer_returns r
        where l.id = $1 and l.return_id = r.id and r.status = 'draft'`,
      [str(formData, 'line_id')],
    ),
  );
  revalidatePath(`/returns/${returnId}`);
}

/**
 * Прийняття повернення. Тут відбувається все одразу: товар стає на склад,
 * дохід зменшується, податкове зобов'язання сторнується.
 *
 * Важлива деталь ПДВ: розрахунок коригування на зменшення суми компенсації
 * реєструє **покупець**, а не продавець. Продавець зменшує зобов'язання лише
 * після того, як покупець зареєструє РК, тож система заводить документ зі
 * статусом чернетки й позначкою, з кого спитати.
 */
export async function acceptReturn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('sales', 'warehouse');
  const returnId = str(formData, 'return_id');

  try {
    await transaction(async (c) => {
      const { rows: retRows } = await c.query<{
        number: string;
        status: string;
        legal_entity_id: string;
        returned_on: string;
        shipment_id: string | null;
        seller_is_vat_payer: boolean;
        customer_name: string;
        customer_edrpou: string | null;
        customer_ipn: string | null;
        customer_is_vat_payer: boolean;
      }>(
        `select r.number, r.status, r.legal_entity_id, r.returned_on, r.shipment_id,
                e.is_vat_payer as seller_is_vat_payer,
                c.name as customer_name, c.edrpou as customer_edrpou,
                c.ipn as customer_ipn, c.is_vat_payer as customer_is_vat_payer
           from customer_returns r
           join legal_entities e on e.id = r.legal_entity_id
           join customers c on c.id = r.customer_id
          where r.id = $1
          for update of r`,
        [returnId],
      );
      const ret = retRows[0];
      if (!ret) throw new Error('Повернення не знайдено');
      if (ret.status !== 'draft') throw new Error('Повернення вже проведене або скасоване');

      const { rows: lines } = await c.query<{
        id: string;
        item_id: string;
        batch_id: string | null;
        qty: number;
        unit_price: number;
        vat_rate: number;
        unit_cost: number;
        to_stock: boolean;
        name: string;
      }>(
        `select l.id, l.item_id, l.batch_id, l.qty, l.unit_price, l.vat_rate,
                l.unit_cost, l.to_stock, i.name
           from customer_return_lines l join items i on i.id = l.item_id
          where l.return_id = $1 order by i.name`,
        [returnId],
      );
      if (lines.length === 0) throw new Error('У поверненні немає жодної позиції');

      const warehouseId = await defaultWarehouseId(c, 'finished');
      let net = 0;
      let vat = 0;

      for (const line of lines) {
        net += Number(line.unit_price) * Number(line.qty);
        vat += (Number(line.unit_price) * Number(line.qty) * Number(line.vat_rate)) / 100;

        if (!line.to_stock) continue;

        // Без прив'язки партії немає — заводимо власну, названу номером
        // повернення. Так на складі одразу видно, звідки взявся цей товар.
        let batchId = line.batch_id;
        if (!batchId) {
          const { rows: batch } = await c.query<{ id: string }>(
            `insert into batches (item_id, code, produced_on, source)
             values ($1, $2, $3, 'purchase')
             on conflict (item_id, code) do update set produced_on = excluded.produced_on
             returning id`,
            [line.item_id, `${ret.number}/${line.item_id.slice(0, 8)}`, ret.returned_on],
          );
          batchId = batch[0].id;
        }

        await insertMoves(c, [
          {
            itemId: line.item_id,
            legalEntityId: ret.legal_entity_id,
            batchId,
            warehouseId,
            qty: Number(line.qty),
            unitCost: Number(line.unit_cost),
            moveType: 'sale_return',
            docType: 'customer_return',
            docId: returnId,
            userId: session.uid,
            note: `Повернення ${ret.number}`,
          },
        ]);
      }

      // Реєстр ПДВ: від'ємне зобов'язання зменшує суму до сплати.
      if (ret.seller_is_vat_payer && vat > 0.005) {
        await c.query(
          `insert into vat_entries
             (legal_entity_id, kind, doc_type, doc_id, doc_number, occurred_on,
              base_amount, vat_amount, vat_rate, counterparty_name, counterparty_edrpou)
           values ($1, 'liability', 'customer_return', $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            ret.legal_entity_id,
            returnId,
            ret.number,
            ret.returned_on,
            -round2(net),
            -round2(vat),
            lines[0].vat_rate,
            ret.customer_name,
            ret.customer_edrpou,
          ],
        );

        // Розрахунок коригування. Батьківську накладну знаходимо за
        // відвантаженням, якщо повернення до нього прив'язане.
        const { rows: parent } = ret.shipment_id
          ? await c.query<{ id: string; number: string }>(
              "select id, number from tax_invoices where shipment_id = $1 and kind = 'invoice'",
              [ret.shipment_id],
            )
          : { rows: [] as { id: string; number: string }[] };

        // Власна серія: накладні нумеруються числами, тож «РК-1» з ними не
        // перетнеться навіть у тому самому місяці.
        const { rows: seq } = await c.query<{ n: number }>(
          `select coalesce(max(substring(number from '^РК-([0-9]+)$')::int), 0) + 1 as n
             from tax_invoices
            where legal_entity_id = $1 and kind = 'adjustment'
              and issued_on >= date_trunc('month', $2::date)
              and issued_on < date_trunc('month', $2::date) + interval '1 month'`,
          [ret.legal_entity_id, ret.returned_on],
        );

        await c.query(
          `insert into tax_invoices
             (legal_entity_id, number, issued_on, kind, parent_invoice_id, return_id,
              customer_id, counterparty_name, counterparty_ipn,
              base_amount, vat_amount, total_amount, vat_rate, registered_by, note)
           values ($1, $2, $3, 'adjustment', $4, $5,
                   (select customer_id from customer_returns where id = $5), $6, $7,
                   $8, $9, $10, $11, $12, $13)`,
          [
            ret.legal_entity_id,
            `РК-${seq[0].n}`,
            ret.returned_on,
            parent[0]?.id ?? null,
            returnId,
            ret.customer_name,
            // Неплатнику ПДВ ставиться умовний ІПН — так само, як у накладній.
            ret.customer_is_vat_payer ? ret.customer_ipn : '100000000000',
            -round2(net),
            -round2(vat),
            -round2(net + vat),
            lines[0].vat_rate,
            // Зменшення компенсації реєструє покупець, і лише якщо він платник.
            ret.customer_is_vat_payer ? 'buyer' : 'seller',
            parent[0]
              ? `Коригування до накладної ${parent[0].number}, повернення ${ret.number}`
              : `Повернення ${ret.number} без прив'язки до накладної`,
          ],
        );
      }

      await c.query("update customer_returns set status = 'accepted' where id = $1", [returnId]);

      await c.query(
        `insert into audit_log (user_id, action, entity, entity_id, details)
         values ($1, 'accept', 'customer_return', $2, $3)`,
        [session.uid, returnId, JSON.stringify({ net: round2(net), vat: round2(vat), lines: lines.length })],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/returns/${returnId}`);
  revalidatePath('/returns');
  revalidatePath('/stock');
  revalidatePath('/pl');
  return { ok: 'Повернення прийнято' };
}

export async function cancelReturn(formData: FormData) {
  await requireRole('sales', 'warehouse');
  const returnId = str(formData, 'return_id');
  await transaction((c) =>
    c.query("update customer_returns set status = 'cancelled' where id = $1 and status = 'draft'", [
      returnId,
    ]),
  );
  revalidatePath(`/returns/${returnId}`);
  revalidatePath('/returns');
}
