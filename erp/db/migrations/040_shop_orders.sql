-- 040_shop_orders.sql — приймання замовлень з інтернет-магазину.
--
-- Сайт шле замовлення на /api/shop-orders із токеном; система створює
-- чернетку замовлення каналу «Сайт». Зовнішній номер зберігається, щоб
-- повторна відправка того самого замовлення не плодила дублі.

alter table settings add column if not exists shop_api_token text;
alter table settings add column if not exists shop_entity_id uuid references legal_entities(id);

alter table sales_orders add column if not exists external_ref text;
create unique index if not exists sales_orders_external_ref_key
  on sales_orders (external_ref) where external_ref is not null;
