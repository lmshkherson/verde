import { NextResponse } from 'next/server';
import { transaction } from '@/lib/db';
import { nextDocNumber } from '@/lib/stock';
import { saleVatRate } from '@/lib/vat';

export const dynamic = 'force-dynamic';

/**
 * Приймання замовлень з інтернет-магазину (v-verde.ua).
 *
 * POST /api/shop-orders, заголовок Authorization: Bearer <токен із налаштувань>.
 * Тіло: { external_id, customer: { name, phone?, email?, np_city?, np_branch? },
 *         items: [{ sku? | barcode?, qty, price? }], note? }
 *
 * Створюється ЧЕРНЕТКА замовлення каналу «Сайт»: менеджер бачить її в
 * журналі, перевіряє і підтверджує — сайт нічого не відвантажує сам.
 * Повторна відправка того самого external_id повертає вже створене
 * замовлення, а не дубль.
 */

interface ShopItem {
  sku?: string;
  barcode?: string;
  qty: number;
  price?: number;
}

interface ShopOrder {
  external_id: string;
  customer: { name: string; phone?: string; email?: string; np_city?: string; np_branch?: string };
  items: ShopItem[];
  note?: string;
}

export async function POST(request: Request) {
  let payload: ShopOrder;
  try {
    payload = (await request.json()) as ShopOrder;
  } catch {
    return NextResponse.json({ error: 'Тіло запиту — не JSON' }, { status: 400 });
  }

  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

  try {
    const result = await transaction(async (c) => {
      const { rows: settingsRows } = await c.query<{
        shop_api_token: string | null;
        shop_entity_id: string | null;
      }>('select shop_api_token, shop_entity_id from settings where id = 1');
      const s = settingsRows[0];
      if (!s?.shop_api_token) {
        return { status: 503, body: { error: 'Приймання замовлень не налаштовано (немає токена)' } };
      }
      if (!token || token !== s.shop_api_token) {
        return { status: 401, body: { error: 'Невірний токен' } };
      }

      if (!payload.external_id || !payload.customer?.name || !Array.isArray(payload.items) || payload.items.length === 0) {
        return { status: 400, body: { error: 'Потрібні external_id, customer.name і хоча б один item' } };
      }

      // Ідемпотентність: те саме замовлення сайту не створюється двічі.
      const { rows: existing } = await c.query<{ number: string }>(
        'select number from sales_orders where external_ref = $1',
        [`shop:${payload.external_id}`],
      );
      if (existing[0]) {
        return { status: 200, body: { ok: true, order_number: existing[0].number, duplicate: true } };
      }

      const entityId =
        s.shop_entity_id ??
        (await c.query<{ id: string }>('select id from legal_entities where is_default limit 1')).rows[0]?.id;
      if (!entityId) return { status: 500, body: { error: 'Не налаштована юрособа для замовлень із сайту' } };

      const { rows: entityRows } = await c.query<{ is_vat_payer: boolean }>(
        'select is_vat_payer from legal_entities where id = $1',
        [entityId],
      );

      // Клієнт: шукаємо за телефоном, потім за назвою; не знайшли — заводимо.
      const phone = payload.customer.phone?.trim() || null;
      let customerId: string | null = null;
      if (phone) {
        const { rows } = await c.query<{ id: string }>(
          `select id from customers where regexp_replace(coalesce(phone, ''), '\\D', '', 'g')
                                          = regexp_replace($1, '\\D', '', 'g') limit 1`,
          [phone],
        );
        customerId = rows[0]?.id ?? null;
      }
      if (!customerId) {
        const { rows } = await c.query<{ id: string }>(
          'select id from customers where lower(name) = lower($1) limit 1',
          [payload.customer.name.trim()],
        );
        customerId = rows[0]?.id ?? null;
      }
      if (!customerId) {
        const { rows } = await c.query<{ id: string }>(
          `insert into customers (name, channel, phone, np_city, np_branch, note)
           values ($1, 'site', $2, $3, $4, $5) returning id`,
          [
            payload.customer.name.trim(),
            phone,
            payload.customer.np_city?.trim() || null,
            payload.customer.np_branch?.trim() || null,
            payload.customer.email ? `email: ${payload.customer.email}` : null,
          ],
        );
        customerId = rows[0].id;
      }

      const number = await nextDocNumber(c, entityId, 'ЗАМ');
      const { rows: orderRows } = await c.query<{ id: string }>(
        `insert into sales_orders (number, legal_entity_id, customer_id, note, external_ref)
         values ($1, $2, $3, $4, $5) returning id`,
        [
          number,
          entityId,
          customerId,
          payload.note ? `Із сайту: ${payload.note}` : 'Замовлення з сайту',
          `shop:${payload.external_id}`,
        ],
      );

      const missing: string[] = [];
      let added = 0;
      for (const item of payload.items) {
        const qty = Number(item.qty);
        if (!Number.isFinite(qty) || qty <= 0) continue;
        const { rows: itemRows } = await c.query<{
          id: string;
          vat_rate: number;
          site_price: number | null;
        }>(
          `select i.id, i.vat_rate, ip.price as site_price
             from items i
             left join item_prices ip on ip.item_id = i.id and ip.channel = 'site'
            where i.is_active and i.kind = 'finished'
              and (($1::text is not null and i.sku = $1) or ($2::text is not null and i.barcode = $2))
            limit 1`,
          [item.sku?.trim() || null, item.barcode?.trim() || null],
        );
        const found = itemRows[0];
        if (!found) {
          missing.push(item.sku ?? item.barcode ?? '?');
          continue;
        }
        const price = Number(item.price ?? 0) > 0 ? Number(item.price) : Number(found.site_price ?? 0);
        await c.query(
          `insert into sales_order_lines (so_id, item_id, qty, unit_price, vat_rate, list_price)
           values ($1, $2, $3, $4, $5, $4)`,
          [
            orderRows[0].id,
            found.id,
            qty,
            price,
            saleVatRate(entityRows[0]?.is_vat_payer ?? false, Number(found.vat_rate)),
          ],
        );
        added += 1;
      }

      if (added === 0) {
        // Замовлення без жодної впізнаної позиції не потрібне нікому.
        throw new Error(`Жодна позиція не знайдена в номенклатурі: ${missing.join(', ')}`);
      }

      return {
        status: 201,
        body: { ok: true, order_number: number, lines: added, unknown_items: missing },
      };
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Внутрішня помилка' },
      { status: 422 },
    );
  }
}
