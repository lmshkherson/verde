-- 037_order_discounts.sql — знижка в замовленні клієнта.
--
-- Ціна каналу лишається в рядку як прайсова (list_price), а знижка з шапки
-- перераховує unit_price. Уся звітність (виручка, ПДВ, маржа, друковані
-- форми) й далі читає unit_price — тож знижка автоматично коректна скрізь,
-- а прайс поруч показує, від чого її дали.

alter table sales_orders add column if not exists discount_pct numeric(5,2) not null default 0
  check (discount_pct >= 0 and discount_pct < 100);

alter table sales_order_lines add column if not exists list_price numeric(12,4);
update sales_order_lines set list_price = unit_price where list_price is null;
