'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { transaction } from '@/lib/db';
import { type ActionState, num, str, strOrNull, toMessage } from '@/lib/action-state';
import { allocateFefo, defaultWarehouseId, insertMoves, nextDocNumber, round2, round3 } from '@/lib/stock';
import { calcPurchaseVat, saleVatRate } from '@/lib/vat';
import { SALES_CHANNELS } from '@/lib/format';
import { resolveEntityId } from '@/lib/doc-entity';
import { requireRole } from '@/lib/session';
import { logAutoPoint } from '@/lib/haccp';
import { normalizeIban } from '@/lib/bank';

export async function createCustomer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('sales');
  const name = str(formData, 'name');
  if (!name) return { error: 'Вкажіть назву клієнта' };

  try {
    await transaction((c) =>
      c.query(
        `insert into customers (name, channel, edrpou, contact, phone, payment_terms_days, credit_limit, note)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          name,
          SALES_CHANNELS[str(formData, 'channel')] ? str(formData, 'channel') : 'small_wholesale',
          strOrNull(formData, 'edrpou'),
          strOrNull(formData, 'contact'),
          strOrNull(formData, 'phone'),
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

  const iban = normalizeIban(strOrNull(formData, 'iban'));
  if (iban.error) return { error: iban.error };

  try {
    await transaction((c) =>
      c.query(
        `update customers set
           name = $2, channel = $3, edrpou = $4, ipn = $5, is_vat_payer = $6,
           contact = $7, phone = $8,
           payment_terms_days = $9, credit_limit = $10, note = $11, address = $12,
           delivery_address = $13, iban = $14, bank_name = $15
         where id = $1`,
        [
          id,
          name,
          SALES_CHANNELS[str(formData, 'channel')] ? str(formData, 'channel') : 'small_wholesale',
          strOrNull(formData, 'edrpou'),
          strOrNull(formData, 'ipn'),
          formData.get('is_vat_payer') === 'on',
          strOrNull(formData, 'contact'),
          strOrNull(formData, 'phone'),
          num(formData, 'payment_terms_days'),
          num(formData, 'credit_limit'),
          strOrNull(formData, 'note'),
          strOrNull(formData, 'address'),
          strOrNull(formData, 'delivery_address'),
          iban.iban,
          strOrNull(formData, 'bank_name'),
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
      const entityId = await resolveEntityId(c, formData, session.eid);
      // Продавати самому собі не можна — це не документ, а помилка вибору.
      const { rows: check } = await c.query<{ legal_entity_id: string | null }>(
        'select legal_entity_id from customers where id = $1',
        [customerId],
      );
      if (check[0]?.legal_entity_id === entityId) {
        throw new Error('Не можна оформити продаж самому собі — оберіть іншу юрособу або іншого клієнта');
      }

      const number = await nextDocNumber(c, entityId, 'ЗАМ');
      const { rows } = await c.query<{ id: string }>(
        `insert into sales_orders (number, legal_entity_id, customer_id, ship_by, note, created_by)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [
          number,
          entityId,
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
        channel: string;
        seller_is_vat_payer: boolean;
      }>(
        `select o.status, c.channel, e.is_vat_payer as seller_is_vat_payer
           from sales_orders o
           join customers c on c.id = o.customer_id
           join legal_entities e on e.id = o.legal_entity_id
          where o.id = $1`,
        [soId],
      );
      const order = orderRows[0];
      if (!order) throw new Error('Замовлення не знайдено');
      if (order.status !== 'draft') throw new Error('Позиції можна додавати лише в чернетку');

      const { rows: itemRows } = await c.query<{ vat_rate: number; channel_price: number | null }>(
        `select i.vat_rate, ip.price as channel_price
           from items i
           left join item_prices ip on ip.item_id = i.id and ip.channel = $2
          where i.id = $1`,
        [itemId, order.channel],
      );
      const item = itemRows[0];
      if (!item) throw new Error('Товар не знайдено');

      // Ціни в прайсі зберігаються без ПДВ; менеджер може перекрити їх вручну.
      let price = num(formData, 'unit_price', 0);
      if (price <= 0) {
        price = Number(item.channel_price ?? 0);
        if (price <= 0) {
          throw new Error(
            `Для каналу «${SALES_CHANNELS[order.channel] ?? order.channel}» не задана ціна цього товару — заповніть її в картці або вкажіть вручну`,
          );
        }
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

/**
 * Пакетне додавання позицій — введення замовлення таблицею, як із бланка
 * замовлення клієнта. Ціна рядка — без ПДВ; порожня ціна означає «взяти з
 * прайсу клієнта», рівно як при додаванні по одній.
 */
export async function addSalesLines(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('sales');
  const soId = str(formData, 'so_id');

  let lines: { item_id: string; qty: number; unit_price: number }[];
  try {
    lines = JSON.parse(str(formData, 'lines'));
  } catch {
    return { error: 'Не вдалося прочитати рядки — оновіть сторінку і спробуйте ще раз' };
  }
  if (!Array.isArray(lines) || lines.length === 0) return { error: 'У замовленні немає жодного рядка' };
  if (lines.length > 200) return { error: 'Забагато рядків за раз — розбийте на два замовлення' };

  let saved = 0;
  try {
    await transaction(async (c) => {
      const { rows: orderRows } = await c.query<{
        status: string;
        channel: string;
        seller_is_vat_payer: boolean;
      }>(
        `select o.status, c.channel, e.is_vat_payer as seller_is_vat_payer
           from sales_orders o
           join customers c on c.id = o.customer_id
           join legal_entities e on e.id = o.legal_entity_id
          where o.id = $1`,
        [soId],
      );
      const order = orderRows[0];
      if (!order) throw new Error('Замовлення не знайдено');
      if (order.status !== 'draft') throw new Error('Позиції можна додавати лише в чернетку');

      for (const [i, line] of lines.entries()) {
        const row = i + 1;
        const qty = Number(line.qty);
        if (!line.item_id) throw new Error(`Рядок ${row}: не обрано товар`);
        if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Рядок ${row}: кількість має бути більшою за нуль`);

        const { rows: itemRows } = await c.query<{
          kind: string;
          vat_rate: number;
          channel_price: number | null;
        }>(
          `select i.kind, i.vat_rate, ip.price as channel_price
             from items i
             left join item_prices ip on ip.item_id = i.id and ip.channel = $2
            where i.id = $1 and i.is_active`,
          [line.item_id, order.channel],
        );
        const item = itemRows[0];
        if (!item) throw new Error(`Рядок ${row}: товар не знайдено`);
        if (item.kind !== 'finished') throw new Error(`Рядок ${row}: продавати можна лише готову продукцію`);

        let price = Number(line.unit_price) || 0;
        if (price <= 0) {
          price = Number(item.channel_price ?? 0);
          if (price <= 0) {
            throw new Error(
              `Рядок ${row}: для каналу «${SALES_CHANNELS[order.channel] ?? order.channel}» не задана ціна — заповніть у картці товару`,
            );
          }
        }

        await c.query(
          'insert into sales_order_lines (so_id, item_id, qty, unit_price, vat_rate) values ($1, $2, $3, $4, $5)',
          [soId, line.item_id, qty, price, saleVatRate(order.seller_is_vat_payer, item.vat_rate)],
        );
        saved += 1;
      }
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/sales/${soId}`);
  return { ok: `Додано рядків: ${saved}` };
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
interface ShipLine {
  id: string;
  item_id: string;
  qty: number;
  shipped_qty: number;
  unit_price: number;
  vat_rate: number;
  name: string;
}

interface ShipTransport {
  ttn?: string | null;
  carrier?: string | null;
  proxyNumber?: string | null;
  proxyDate?: string | null;
  proxyPerson?: string | null;
  proxyPosition?: string | null;
}

/**
 * Ядро відвантаження: списання за FEFO, внутрішня передача власній юрособі,
 * ПДВ-зобов'язання продавця і дзеркальний кредит покупця. Викликається і
 * дією з форми, і автоматичною внутрішньою реалізацією.
 */
async function shipOrderCore(
  c: import('pg').PoolClient,
  uid: string,
  soId: string,
  shippedOn: string,
  pickQty: (line: ShipLine) => number,
  transport: ShipTransport,
): Promise<{ number: string }> {
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

  const { rows: lines } = await c.query<ShipLine>(
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
        proxy_number, proxy_date, proxy_person, proxy_position, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [
      number,
      soId,
      shippedOn,
      transport.ttn ?? null,
      transport.carrier ?? null,
      transport.proxyNumber ?? null,
      transport.proxyDate ?? null,
      transport.proxyPerson ?? null,
      transport.proxyPosition ?? null,
      uid,
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
    const qty = round3(pickQty(line));
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
          userId: uid,
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
            userId: uid,
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
      uid,
      soId,
      JSON.stringify({ shipment: number, lines: shippedLines, internal: !!order.buyer_entity_id }),
    ],
  );

  return { number };
}

/**
 * Управлінський «загальний склад»: якщо юрособі документа бракує готової
 * продукції, нестача поповнюється автоматичною внутрішньою реалізацією від
 * юрособи, де товар є. Бухгалтерськи це повноцінний документ: продаж із ПДВ
 * у донора, оприбуткування за собівартістю з податковим кредитом у отримувача.
 */
async function ensureGroupStock(
  c: import('pg').PoolClient,
  uid: string,
  soId: string,
  shippedOn: string,
  pickQty: (line: ShipLine) => number,
): Promise<string[]> {
  const { rows: orderRows } = await c.query<{
    number: string;
    legal_entity_id: string;
    customer_entity_id: string | null;
  }>(
    `select o.number, o.legal_entity_id, c.legal_entity_id as customer_entity_id
       from sales_orders o join customers c on c.id = o.customer_id
      where o.id = $1`,
    [soId],
  );
  const order = orderRows[0];
  if (!order) return [];

  const { rows: lines } = await c.query<ShipLine>(
    `select l.id, l.item_id, l.qty, l.shipped_qty, l.unit_price, l.vat_rate, i.name
       from sales_order_lines l join items i on i.id = l.item_id
      where l.so_id = $1 order by i.name`,
    [soId],
  );
  const warehouseId = await defaultWarehouseId(c, 'finished');

  // Нестача по кожній позиції в юрособи документа (лише допущені партії).
  const shortages: { itemId: string; name: string; qty: number }[] = [];
  for (const line of lines) {
    const qty = round3(pickQty(line));
    if (qty <= 0) continue;
    const { rows: st } = await c.query<{ q: number }>(
      `select coalesce(sum(sb.qty), 0) as q
         from v_stock_batches sb
         join batches b on b.id = sb.batch_id
        where sb.item_id = $1 and sb.legal_entity_id = $2 and sb.warehouse_id = $3
          and b.quality_status = 'released'`,
      [line.item_id, order.legal_entity_id, warehouseId],
    );
    const shortage = round3(qty - Number(st[0].q));
    if (shortage > 0.0005) shortages.push({ itemId: line.item_id, name: line.name, qty: shortage });
  }
  if (shortages.length === 0) return [];

  // Внутрішній клієнт, що представляє юрособу документа в чужих продажах.
  const { rows: internalCust } = await c.query<{ id: string; channel: string }>(
    'select id, channel from customers where legal_entity_id = $1 and is_active limit 1',
    [order.legal_entity_id],
  );
  if (!internalCust[0]) {
    throw new Error(
      'Товару бракує на складі юрособи документа, а внутрішнього клієнта для автопоповнення немає. ' +
        'Створіть клієнта, прив’язаного до цієї юрособи (сторінка «Юрособи»), або оформіть внутрішню реалізацію вручну.',
    );
  }

  // Донор для кожної позиції — юрособа з достатнім допущеним залишком.
  const byDonor = new Map<string, { itemId: string; name: string; qty: number }[]>();
  for (const sh of shortages) {
    const { rows: donors } = await c.query<{ legal_entity_id: string; q: number }>(
      `select sb.legal_entity_id, sum(sb.qty) as q
         from v_stock_batches sb
         join batches b on b.id = sb.batch_id
        where sb.item_id = $1 and sb.warehouse_id = $2 and sb.legal_entity_id <> $3
          and b.quality_status = 'released'
        group by sb.legal_entity_id
       having sum(sb.qty) >= $4
        order by sum(sb.qty) desc
        limit 1`,
      [sh.itemId, warehouseId, order.legal_entity_id, sh.qty],
    );
    if (!donors[0]) {
      throw new Error(
        `«${sh.name}»: бракує ${sh.qty} і в жодної юрособи групи немає достатнього залишку`,
      );
    }
    const key = donors[0].legal_entity_id;
    if (!byDonor.has(key)) byDonor.set(key, []);
    byDonor.get(key)!.push(sh);
  }

  const created: string[] = [];
  for (const [donorId, items] of byDonor) {
    const { rows: donorRows } = await c.query<{ short_name: string; is_vat_payer: boolean }>(
      'select short_name, is_vat_payer from legal_entities where id = $1',
      [donorId],
    );
    const number = await nextDocNumber(c, donorId, 'ЗАМ');
    const { rows: soRows } = await c.query<{ id: string }>(
      `insert into sales_orders (number, legal_entity_id, customer_id, status, note, created_by)
       values ($1, $2, $3, 'confirmed', $4, $5) returning id`,
      [
        number,
        donorId,
        internalCust[0].id,
        `Автоматична внутрішня реалізація для ${order.number}`,
        uid,
      ],
    );

    for (const it of items) {
      const { rows: itemRows } = await c.query<{ vat_rate: number; channel_price: number | null }>(
        `select i.vat_rate, ip.price as channel_price
           from items i
           left join item_prices ip on ip.item_id = i.id and ip.channel = $2
          where i.id = $1`,
        [it.itemId, internalCust[0].channel],
      );
      const price = Number(itemRows[0]?.channel_price ?? 0);
      if (price <= 0) {
        throw new Error(
          `«${it.name}»: для автоматичної внутрішньої реалізації потрібна ціна каналу «${SALES_CHANNELS[internalCust[0].channel] ?? internalCust[0].channel}» — заповніть її в картці товару`,
        );
      }
      await c.query(
        'insert into sales_order_lines (so_id, item_id, qty, unit_price, vat_rate) values ($1, $2, $3, $4, $5)',
        [
          soRows[0].id,
          it.itemId,
          it.qty,
          price,
          saleVatRate(donorRows[0].is_vat_payer, Number(itemRows[0].vat_rate)),
        ],
      );
    }

    await shipOrderCore(
      c,
      uid,
      soRows[0].id,
      shippedOn,
      (l) => round3(l.qty - l.shipped_qty),
      {},
    );
    created.push(`${number} (${donorRows[0].short_name})`);
  }
  return created;
}

export async function shipSalesOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('sales', 'warehouse');
  const soId = str(formData, 'so_id');
  const shippedOn = str(formData, 'shipped_on') || new Date().toISOString().slice(0, 10);

  let internal: string[] = [];
  try {
    await transaction(async (c) => {
      const pickQty = (line: ShipLine) =>
        round3(num(formData, `qty_${line.id}`, round3(line.qty - line.shipped_qty)));

      internal = await ensureGroupStock(c, session.uid, soId, shippedOn, pickQty);
      await shipOrderCore(c, session.uid, soId, shippedOn, pickQty, {
        ttn: strOrNull(formData, 'ttn_number'),
        carrier: strOrNull(formData, 'carrier'),
        proxyNumber: strOrNull(formData, 'proxy_number'),
        proxyDate: strOrNull(formData, 'proxy_date'),
        proxyPerson: strOrNull(formData, 'proxy_person'),
        proxyPosition: strOrNull(formData, 'proxy_position'),
      });
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/sales/${soId}`);
  revalidatePath('/stock');
  return {
    ok:
      internal.length > 0
        ? `Відвантаження проведено. Товару бракувало — автоматично оформлено внутрішню реалізацію: ${internal.join(', ')}`
        : 'Відвантаження проведено',
  };
}

export async function recordPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('sales');
  const amount = num(formData, 'amount');
  const customerId = str(formData, 'customer_id');
  if (!customerId) return { error: 'Оберіть клієнта' };
  if (amount === 0) return { error: 'Вкажіть суму оплати' };

  const soId = strOrNull(formData, 'so_id');
  try {
    await transaction(async (c) => {
      // Гроші лягають тій юрособі, чиє замовлення оплачують.
      const { rows: ent } = soId
        ? await c.query<{ legal_entity_id: string }>(
            'select legal_entity_id from sales_orders where id = $1',
            [soId],
          )
        : { rows: [] as { legal_entity_id: string }[] };
      await c.query(
        `insert into payments (customer_id, legal_entity_id, so_id, paid_on, amount, method, note, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          customerId,
          ent[0]?.legal_entity_id ?? session.eid,
          soId,
          str(formData, 'paid_on') || new Date().toISOString().slice(0, 10),
          amount,
          str(formData, 'method') || 'bank',
          strOrNull(formData, 'note'),
          session.uid,
        ],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  if (soId) revalidatePath(`/sales/${soId}`);
  revalidatePath('/sales/customers');
  return { ok: 'Оплату записано' };
}

/**
 * Реквізити перевезення для ТТН. Заповнюються окремо від відвантаження, бо
 * марку автомобіля й прізвище водія дізнаються на завантаженні, а не тоді, коли
 * менеджер виписує документ.
 */
export async function updateShipmentTransport(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireRole('sales', 'warehouse');
  const shipmentId = str(formData, 'shipment_id');
  if (!shipmentId) return { error: 'Не вказано відвантаження' };

  const tempAtLoading =
    str(formData, 'temp_at_loading') === '' ? null : num(formData, 'temp_at_loading');

  try {
    await transaction(async (c) => {
      await c.query(
        `update shipments set
           ttn_number = $2, carrier = $3, carrier_edrpou = $4, carrier_storage_place = $5,
           transport_kind = $6, vehicle_model = $7, vehicle_plate = $8,
           trailer_model = $9, trailer_plate = $10, driver_name = $11,
           freight_payer = $12, loading_point = $13, unloading_point = $14,
           gross_weight_kg = $15, places = $16,
           temp_mode = $17, body_type = $18, temp_at_loading = $19, temp_at_unloading = $20
         where id = $1`,
        [
          shipmentId,
          strOrNull(formData, 'ttn_number'),
          strOrNull(formData, 'carrier'),
          strOrNull(formData, 'carrier_edrpou'),
          strOrNull(formData, 'carrier_storage_place'),
          strOrNull(formData, 'transport_kind'),
          strOrNull(formData, 'vehicle_model'),
          strOrNull(formData, 'vehicle_plate'),
          strOrNull(formData, 'trailer_model'),
          strOrNull(formData, 'trailer_plate'),
          strOrNull(formData, 'driver_name'),
          strOrNull(formData, 'freight_payer'),
          strOrNull(formData, 'loading_point'),
          strOrNull(formData, 'unloading_point'),
          num(formData, 'gross_weight_kg') || null,
          num(formData, 'places') || null,
          strOrNull(formData, 'temp_mode'),
          strOrNull(formData, 'body_type'),
          tempAtLoading,
          str(formData, 'temp_at_unloading') === '' ? null : num(formData, 'temp_at_unloading'),
        ],
      );

      // Температура в кузові на завантаженні — запис точки контролю
      // «Відвантаження». Вона вже виміряна й записана в ТТН, тож просити
      // ту саму цифру вдруге, вже в журнал, немає сенсу.
      if (tempAtLoading !== null) {
        await logAutoPoint(c, 'shipping', session.eid, session.uid, tempAtLoading, {
          docType: 'shipment',
          docId: shipmentId,
        });
      }
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/shipments/${shipmentId}/ttn`);
  revalidatePath('/haccp');
  return { ok: 'Реквізити збережено' };
}
