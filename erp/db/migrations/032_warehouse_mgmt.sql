-- 032_warehouse_mgmt.sql — склади як повноцінний довідник.
--
-- Склади досі були зашиті демо-набором: сировина, цех, готова продукція.
-- Додати орендований склад чи окремий морозильник можна було лише в базі.
-- Тепер довідник керується з інтерфейсу, а документи приходу дають вибрати,
-- куди саме оприбуткувати.
--
-- Тип складу лишається головним: за ним документи знаходять склад «за
-- замовчуванням», коли вибору немає (виробництво списує сировину зі складу
-- сировини, випускає на склад ГП).

-- Один склад кожного типу — типовий: саме його підставляють документи,
-- коли користувач нічого не обрав.
alter table warehouses add column if not exists is_default boolean not null default false;
alter table warehouses add column if not exists note text;

-- Наявні склади з демо-набору стають типовими для своїх типів.
update warehouses w set is_default = true
 where not exists (
   select 1 from warehouses o where o.kind = w.kind and o.is_default
 )
 and w.id = (select id from warehouses o where o.kind = w.kind order by code limit 1);
