'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { transaction } from '@/lib/db';
import { type ActionState, num, str, strOrNull, toMessage } from '@/lib/action-state';
import { allocateFefo, defaultWarehouseId, insertMoves, nextDocNumber, round2, round3 } from '@/lib/stock';
import { calcPurchaseVat, saleVatRate } from '@/lib/vat';
import { requireRole } from '@/lib/session';

export async function createCustomer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('sales');
  const name = str(formData, 'name');
  if (!name) return { error: 'Вкажіть назву клієнта' };

  try {
    await transaction((c) =>
      c.query(
        `insert into customers (name, kind, edrpou, contact, phone, price_level, payment_terms_days, credit_limit, note)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          name,
          str(formData, 'kind') || 'network',
          strOrNull(formData, 'edrpou'),
          strOrNull(formData, 'contact'),
          strOrNull(formData, 'phone'),
          str(formData, 'price_level') || 'distributor',
          num(formData, 'payment_terms_days'),
          num(formData, 'credit_limit'),
          strOrNull(formData, 'note'),
        ],
      ),
    );
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/sales/customers');
  return { ok: 'Клієнта додано' };
}

/**
 * Редагування клієнта. Рівень цін і умови оплати діють лише на майбутні
 * замовлення: у виписаних документах ціна й ставка ПДВ зафіксовані в рядку,
 * тож заднім числом нічого не переписується.
 */
export async function updateCustomer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('sales');
  const id = str(formData, 'customer_id');
  const name = str(formData, 'name');

  if (!id) return { error: 'Не вказано клієнта' };
  if (!name) return { error: 'Вкажіть назву клієнта' };

  try {
    await transaction((c) =>
      c.query(
        `update customers set
           name = $2, kind = $3, edrpou = $4, ipn = $5, is_vat_payer = $6,
           contact = $7, phone = $8, price_level = $9,
           payment_terms_days = $10, credit_limit = $11, note = $12, address = $13
         where id = $1`,
        [
          id,
          name,
          str(formData, 'kind') || 'network',
          strOrNull(formData, 'edrpou'),
          strOrNull(formData, 'ipn'),
          formData.get('is_vat_payer') === 'on',
          strOrNull(formData, 'contact'),
          strOrNull(formData, 'phone'),
          str(formData, 'price_level') || 'distributor',
          num(formData, 'payment_terms_days'),
          num(formData, 'credit_limit'),
          strOrNull(formData, 'note'),
          strOrNull(formData, 'address'),
        ],
      ),
    );
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/sales/customers');
  revalidatePath(`/sales/customers/${id}`);
  return { ok: 'Збережено' };
}

/**
 * Деактивація замість видалення. Клієнта з боргом сховати не можна: він зникне
 * з дебіторки, а гроші лишаться неотриманими.
 */
export async function setCustomerActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('sales');
  const id = str(formData, 'customer_id');
  const active = str(formData, 'active') === 'true';

  try {
    await transaction(async (c) => {
      if (!active) {
        const { rows } = await c.query<{ balance_due: number }>(
          'select coalesce(balance_due, 0) as balance_due from v_customer_balance where customer_id = $1',
          [id],
        );
        if (Number(rows[0]?.balance_due ?? 0) > 0.01) {
          throw new Error(
            `Не можна деактивувати: за клієнтом борг ${Number(rows[0].balance_due).toFixed(2)} грн. ` +
              'Спершу закрийте розрахунки.',
          );
        }
      }
      await c.query('update customers set is_active = $2 where id = $1', [id, active]);
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/sales/customers');
  revalidatePath(`/sales/customers/${id}`);
  return { ok: active ? 'Клієнта активовано' : 'Клієнта деактивовано' };
}

export async function createSalesOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('sales');
  const customerId = str(formData, 'customer_id');
  if (!customerId) return { error: 'Оберіть клієнта' };

  let soId: string;
  try {
    soId = await transaction(async (c) => {
      // Продавати самому собі не можна — це не документ, а помилка вибору.
      const { rows: check } = await c.query<{ legal_entity_id: string | null }>(
        'select legal_entity_id from customers where id = $1',
        [customerId],
      );
      if (check[0]?.legal_entity_id === session.eid) {
        throw new Error('Не можна оформити продаж самому собі — перемкніть юрособу або оберіть іншого клієнта');
      }

      const number = await nextDocNumber(c, session.eid, 'ЗАМ');
      const { rows } = await c.query<{ id: string }>(
        `insert into sales_orders (number, legal_entity_id, customer_id, ship_by, note, created_by)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [
          number,
          session.eid,
          customerId,
          strOrNull(formData, 'ship_by'),
          strOrNull(formData, 'note'),
          session.uid,
        ],
      );
      return rows[0].id;
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  redirect(`/sales/${soId}`);
}

export async function addSalesLine(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('sales');
  const soId = str(formData, 'so_id');
  const itemId = str(formData, 'item_id');
  const qty = num(formData, 'qty');

  if (!itemId) return { error: 'Оберіть товар' };
  if (qty <= 0) return { error: 'Кількість має бути більшою за нуль' };

  try {
    await transaction(async (c) => {
      const { rows: orderRows } = await c.query<{
        status: string;
        price_level: string;
        seller_is_vat_payer: boolean;
      }>(
        `select o.status, c.price_level, e.is_vat_payer as seller_is_vat_payer
           from sales_orders o
           join customers c on c.id = o.customer_id
           join legal_entities e on e.id = o.legal_entity_id
          where o.id = $1`,
        [soId],
      );
      const order = orderRows[0];
      if (!order) throw new Error('Замовлення не знайдено');
      if (order.status !== 'draft') throw new Error('Позиції можна додавати лише в чернетку');

      const { rows: itemRows } = await c.query<{
        price_distributor: number | null;
        price_network: number | null;
        price_rrp: number | null;
        vat_rate: number;
      }>('select price_distributor, price_network, price_rrp, vat_rate from items where id = $1', [itemId]);
      const item = itemRows[0];
      if (!item) throw new Error('Товар не знайдено');

      // Ціни в прайсі зберігаються без ПДВ; менеджер може перекрити їх вручну.
      let price = num(formData, 'unit_price', 0);
      if (price <= 0) {
        price =
          (order.price_level === 'rrp'
            ? item.price_rrp
            : order.price_level === 'network'
              ? item.price_network
              : item.price_distributor) ?? 0;
        if (price <= 0) throw new Error('Для цього товару не заданий прайс — вкажіть ціну вручну');
      }

      // Неплатник ПДВ не нараховує податок узагалі, тож у рядку буде нуль.
      const rate = saleVatRate(order.seller_is_vat_payer, item.vat_rate);

      await c.query(
        'insert into sales_order_lines (so_id, item_id, qty, unit_price, vat_rate) values ($1, $2, $3, $4, $5)',
        [soId, itemId, qty, price, rate],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/sales/${soId}`);
  return { ok: 'Позицію додано' };
}

export async function removeSalesLine(formData: FormData) {
  await requireRole('sales');
  const soId = str(formData, 'so_id');
  await transaction((c) =>
    c.query(
      `delete from sales_order_lines l using sales_orders o
        where l.id = $1 and l.so_id = o.id and o.status = 'draft'`,
      [str(formData, 'line_id')],
    ),
  );
  revalidatePath(`/sales/${soId}`);
}

/** Підтвердження ставить товар у резерв — він перестає бути доступним іншим замовленням. */
export async function confirmSalesOrder(formData: FormData) {
  await requireRole('sales');
  const soId = str(formData, 'so_id');
  await transaction(async (c) => {
    const { rows } = await c.query<{ count: number }>(
      'select count(*)::int as count from sales_order_lines where so_id = $1',
      [soId],
    );
    if (rows[0].count === 0) throw new Error('У замовленні немає позицій');
    await c.query("update sales_orders set status = 'confirmed' where id = $1 and status = 'draft'", [soId]);
  });
  revalidatePath(`/sales/${soId}`);
}

export async function cancelSalesOrder(formData: FormData) {
  await requireRole('sales');
  const soId = str(formData, 'so_id');
  await transaction((c) =>
    c.query(
      "update sales_orders set status = 'cancelled' where id = $1 and status in ('draft','confirmed')",
      [soId],
    ),
  );
  revalidatePath(`/sales/${soId}`);
}

/**
 * Відвантаження. Підбирає партії продавця за FEFO і фіксує собівартість саме тих
 * партій, що поїхали. Якщо покупець — власна юрособа, той самий документ
 * оприбутковує товар у неї: партія фізично та сама, змінюється лише власник,
 * а собівартість у покупця рахується від його податкового статусу.
 */
export async function shipSalesOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('sales', 'warehouse');
  const soId = str(formData, 'so_id');
  const shippedOn = str(formData, 'shipped_on') || new Date().toISOString().slice(0, 10);

  try {
    await transaction(async (c) => {
      const { rows: orderRows } = await c.query<{
        number: string;
        status: string;
        legal_entity_id: string;
        seller_is_vat_payer: boolean;
        seller_name: string;
        customer_name: string;
        customer_edrpou: string | null;
        buyer_entity_id: string | null;
        buyer_is_vat_payer: boolean | null;
      }>(
        `select o.number, o.status, o.legal_entity_id,
                se.is_vat_payer as seller_is_vat_payer, se.short_name as seller_name,
                c.name as customer_name, c.edrpou as customer_edrpou,
                c.legal_entity_id as buyer_entity_id,
                be.is_vat_payer as buyer_is_vat_payer
           from sales_orders o
           join legal_entities se on se.id = o.legal_entity_id
           join customers c on c.id = o.customer_id
           left join legal_entities be on be.id = c.legal_entity_id
          where o.id = $1
          for update of o`,
        [soId],
      );
      const order = orderRows[0];
      if (!order) throw new Error('Замовлення не знайдено');
      if (order.status === 'cancelled') throw new Error('Замовлення скасоване');
      if (order.status === 'draft') throw new Error('Спершу підтвердіть замовлення');

      const { rows: lines } = await c.query<{
        id: string;
        item_id: string;
        qty: number;
        shipped_qty: number;
        unit_price: number;
        vat_rate: number;
        name: string;
      }>(
        `select l.id, l.item_id, l.qty, l.shipped_qty, l.unit_price, l.vat_rate, i.name
           from sales_order_lines l join items i on i.id = l.item_id
          where l.so_id = $1 order by i.name`,
        [soId],
      );

      const warehouseId = await defaultWarehouseId(c, 'finished');
      const number = await nextDocNumber(c, order.legal_entity_id, 'ВІД');

      const { rows: shipmentRows } = await c.query<{ id: string }>(
        `insert into shipments
           (number, so_id, shipped_on, ttn_number, carrier,
            proxy_number, proxy_date, proxy_person, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [
          number,
          soId,
          shippedOn,
          strOrNull(formData, 'ttn_number'),
          strOrNull(formData, 'carrier'),
          strOrNull(formData, 'proxy_number'),
          strOrNull(formData, 'proxy_date'),
          strOrNull(formData, 'proxy_person'),
          session.uid,
        ],
      );
      const shipmentId = shipmentRows[0].id;

      let shippedLines = 0;
      let saleNet = 0;
      let saleVat = 0;
      let buyerCreditBase = 0;
      let buyerCreditVat = 0;

      for (const line of lines) {
        const remaining = round3(line.qty - line.shipped_qty);
        const qty = round3(num(formData, `qty_${line.id}`, remaining));
        if (qty <= 0) continue;
        if (qty > remaining + 0.0005) {
          throw new Error(`«${line.name}»: відвантажується більше, ніж у замовленні`);
        }

        const allocations = await allocateFefo(
          c,
          line.item_id,
          warehouseId,
          order.legal_entity_id,
          qty,
        );

        // Собівартість, за якою партія стає на облік у покупця-власної юрособи.
        const buyerSide = calcPurchaseVat(line.unit_price, {
          buyerIsVatPayer: order.buyer_is_vat_payer ?? false,
          supplierIsVatPayer: order.seller_is_vat_payer,
          itemVatRate: line.vat_rate,
          pricesIncludeVat: false,
        });

        for (const a of allocations) {
          await insertMoves(c, [
            {
              itemId: line.item_id,
              legalEntityId: order.legal_entity_id,
              batchId: a.batchId,
              warehouseId,
              qty: -a.qty,
              unitCost: a.unitCost,
              moveType: 'sale_shipment',
              docType: 'shipment',
              docId: shipmentId,
              userId: session.uid,
              note: `Відвантаження ${number}`,
            },
          ]);

          if (order.buyer_entity_id) {
            // Партія лишається та сама — змінюється лише власник і собівартість.
            await insertMoves(c, [
              {
                itemId: line.item_id,
                legalEntityId: order.buyer_entity_id,
                batchId: a.batchId,
                warehouseId,
                qty: a.qty,
                unitCost: buyerSide.unitCost,
                moveType: 'purchase_receipt',
                docType: 'shipment',
                docId: shipmentId,
                userId: session.uid,
                note: `Придбано в ${order.seller_name} за ${number}`,
              },
            ]);
          }
        }

        saleNet += line.unit_price * qty;
        saleVat += (line.unit_price * qty * line.vat_rate) / 100;
        buyerCreditBase += buyerSide.net * qty;
        buyerCreditVat += buyerSide.credit * qty;

        await c.query(
          'insert into shipment_lines (shipment_id, so_line_id, item_id, qty) values ($1, $2, $3, $4)',
          [shipmentId, line.id, line.item_id, qty],
        );
        await c.query('update sales_order_lines set shipped_qty = shipped_qty + $2 where id = $1', [
          line.id,
          qty,
        ]);
        shippedLines += 1;
      }

      if (shippedLines === 0) throw new Error('Не вказано жодної кількості до відвантаження');

      // Податкове зобов'язання продавця за датою відвантаження.
      if (saleVat > 0.005) {
        await c.query(
          `insert into vat_entries
             (legal_entity_id, kind, doc_type, doc_id, doc_number, occurred_on,
              base_amount, vat_amount, vat_rate, counterparty_name, counterparty_edrpou)
           values ($1, 'liability', 'shipment', $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            order.legal_entity_id,
            shipmentId,
            number,
            shippedOn,
            round2(saleNet),
            round2(saleVat),
            lines[0]?.vat_rate ?? 20,
            order.customer_name,
            order.customer_edrpou,
          ],
        );
      }

      // Дзеркальний податковий кредит у власної юрособи-покупця.
      if (order.buyer_entity_id && buyerCreditVat > 0.005) {
        await c.query(
          `insert into vat_entries
             (legal_entity_id, kind, doc_type, doc_id, doc_number, occurred_on,
              base_amount, vat_amount, vat_rate, counterparty_name, note)
           values ($1, 'credit', 'shipment', $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            order.buyer_entity_id,
            shipmentId,
            number,
            shippedOn,
            round2(buyerCreditBase),
            round2(buyerCreditVat),
            lines[0]?.vat_rate ?? 20,
            order.seller_name,
            'Придбання у власної юрособи',
          ],
        );
      }

      const { rows: leftRows } = await c.query<{ left: number }>(
        'select coalesce(sum(qty - shipped_qty), 0) as left from sales_order_lines where so_id = $1',
        [soId],
      );
      if (leftRows[0].left <= 0.0005) {
        await c.query("update sales_orders set status = 'shipped' where id = $1", [soId]);
      }

      await c.query(
        `insert into audit_log (user_id, action, entity, entity_id, details)
         values ($1, 'ship', 'sales_order', $2, $3)`,
        [
          session.uid,
          soId,
          JSON.stringify({ shipment: number, lines: shippedLines, internal: !!order.buyer_entity_id }),
        ],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/sales/${soId}`);
  revalidatePath('/stock');
  return { ok: 'Відвантаження проведено' };
}

export async function recordPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('sales');
  const amount = num(formData, 'amount');
  const customerId = str(formData, 'customer_id');
  if (!customerId) return { error: 'Оберіть клієнта' };
  if (amount === 0) return { error: 'Вкажіть суму оплати' };

  const soId = strOrNull(formData, 'so_id');
  try {
    await transaction((c) =>
      c.query(
        `insert into payments (customer_id, legal_entity_id, so_id, paid_on, amount, method, note, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          customerId,
          session.eid,
          soId,
          str(formData, 'paid_on') || new Date().toISOString().slice(0, 10),
          amount,
          str(formData, 'method') || 'bank',
          strOrNull(formData, 'note'),
          session.uid,
        ],
      ),
    );
  } catch (err) {
    return { error: toMessage(err) };
  }

  if (soId) revalidatePath(`/sales/${soId}`);
  revalidatePath('/sales/customers');
  return { ok: 'Оплату записано' };
}
