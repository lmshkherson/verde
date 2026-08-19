-- 007_entities_vat.sql — кілька юридичних осіб і облік ПДВ.
--
-- Дві речі, які визначили дизайн:
--  1. Склад спільний, тож власник — це властивість кожного залишку, а не складу.
--     Через це legal_entity_id стоїть на stock_moves: одна фізична партія може
--     лежати на одній полиці, але частково належати різним юрособам.
--  2. Статуси оподаткування різні. Для платника ПДВ вхідний податок — це кредит,
--     він НЕ входить у собівартість. Для єдинника входить повністю. Тому та сама
--     партія має різну собівартість у різних юросіб, і середньозважена ціна
--     рахується в розрізі (номенклатура × юрособа).

create table if not exists legal_entities (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  short_name    text not null,
  edrpou        text,
  ipn           text,                      -- ІПН платника ПДВ
  tax_system    text not null default 'general' check (tax_system in ('general', 'single_tax')),
  is_vat_payer  boolean not null default false,
  vat_rate      numeric(5,2) not null default 20 check (vat_rate >= 0 and vat_rate < 100),
  bank_account  text,
  bank_name     text,
  address       text,
  is_active     boolean not null default true,
  is_default    boolean not null default false,
  created_at    timestamptz not null default now()
);
create unique index if not exists legal_entities_short_name_key on legal_entities (lower(short_name));

-- Переносимо єдину компанію з settings у першу юрособу, щоб наявні дані не осиротіли.
insert into legal_entities (name, short_name, tax_system, is_vat_payer, is_default)
select s.company_name, s.company_name, 'general', true, true
from settings s
where not exists (select 1 from legal_entities);

-- ─── Юрособа на документах і рухах ──────────────────────────────────────────

alter table stock_moves       add column if not exists legal_entity_id uuid references legal_entities(id);
alter table purchase_orders   add column if not exists legal_entity_id uuid references legal_entities(id);
alter table sales_orders      add column if not exists legal_entity_id uuid references legal_entities(id);
alter table production_orders add column if not exists legal_entity_id uuid references legal_entities(id);
alter table payments          add column if not exists legal_entity_id uuid references legal_entities(id);
alter table app_users         add column if not exists default_entity_id uuid references legal_entities(id);

update stock_moves       set legal_entity_id = (select id from legal_entities where is_default) where legal_entity_id is null;
update purchase_orders   set legal_entity_id = (select id from legal_entities where is_default) where legal_entity_id is null;
update sales_orders      set legal_entity_id = (select id from legal_entities where is_default) where legal_entity_id is null;
update production_orders set legal_entity_id = (select id from legal_entities where is_default) where legal_entity_id is null;
update payments          set legal_entity_id = (select id from legal_entities where is_default) where legal_entity_id is null;
update app_users         set default_entity_id = (select id from legal_entities where is_default) where default_entity_id is null;

alter table stock_moves       alter column legal_entity_id set not null;
alter table purchase_orders   alter column legal_entity_id set not null;
alter table sales_orders      alter column legal_entity_id set not null;
alter table production_orders alter column legal_entity_id set not null;
alter table payments          alter column legal_entity_id set not null;

create index if not exists stock_moves_entity_idx on stock_moves (legal_entity_id, item_id, warehouse_id);

-- ─── Нумерація документів окремою серією для кожної юрособи ─────────────────

alter table doc_counters add column if not exists legal_entity_id uuid references legal_entities(id);
update doc_counters set legal_entity_id = (select id from legal_entities where is_default) where legal_entity_id is null;

alter table doc_counters drop constraint if exists doc_counters_pkey;
alter table doc_counters alter column legal_entity_id set not null;
alter table doc_counters add primary key (legal_entity_id, prefix);

drop function if exists next_doc_number(text);

create or replace function next_doc_number(p_entity uuid, p_prefix text) returns text as $$
declare
  y int := extract(year from now())::int;
  c int;
  s text;
begin
  insert into doc_counters (legal_entity_id, prefix, year, counter)
  values (p_entity, p_prefix, y, 1)
  on conflict (legal_entity_id, prefix) do update
    set counter = case when doc_counters.year = y then doc_counters.counter + 1 else 1 end,
        year    = y
  returning doc_counters.counter into c;

  select short_name into s from legal_entities where id = p_entity;

  -- Префікс юрособи в номері рятує від плутанини, коли документи двох ТОВ
  -- лежать в одній теці у бухгалтера.
  return coalesce(upper(left(regexp_replace(s, '[^[:alnum:]]', '', 'g'), 3)) || '-', '')
         || p_prefix || '-' || y || '-' || lpad(c::text, 4, '0');
end;
$$ language plpgsql;

-- ─── ПДВ ────────────────────────────────────────────────────────────────────

-- Ставка на номенклатурі: харчі здебільшого 20%, але буває 14% і 0%.
alter table items add column if not exists vat_rate numeric(5,2) not null default 20
  check (vat_rate >= 0 and vat_rate < 100);

-- Ціни в прайсі зберігаються БЕЗ ПДВ. Наявні значення прийшли з роздрібного
-- прайсу, тобто були з ПДВ — розгортаємо їх до бази оподаткування один раз.
update items
   set price_distributor = round(price_distributor / (1 + vat_rate / 100), 2),
       price_network     = round(price_network     / (1 + vat_rate / 100), 2),
       price_rrp         = round(price_rrp         / (1 + vat_rate / 100), 2)
 where vat_rate > 0
   and (price_distributor is not null or price_network is not null or price_rrp is not null);

-- Постачальник-неплатник не виставляє ПДВ, тож кредиту з його ціни не буде
-- навіть у платника.
alter table suppliers add column if not exists is_vat_payer boolean not null default true;

-- Ціни в заявці постачальнику зазвичай приходять з ПДВ — фіксуємо це на документі,
-- щоб при оприбуткуванні не гадати.
alter table purchase_orders add column if not exists prices_include_vat boolean not null default true;

-- Ставку фіксуємо в момент продажу: зміна ставки в довіднику не має заднім
-- числом переписувати вже виписані документи.
alter table sales_order_lines add column if not exists vat_rate numeric(5,2) not null default 0;
alter table purchase_order_lines add column if not exists vat_rate numeric(5,2) not null default 0;

-- Клієнт може виявитися власною юрособою — тоді відвантаження одночасно
-- оприбутковує товар у покупця.
alter table customers add column if not exists legal_entity_id uuid references legal_entities(id);

-- Реєстр ПДВ: зобов'язання з продажів і кредит із закупівель.
create table if not exists vat_entries (
  id                  uuid primary key default gen_random_uuid(),
  legal_entity_id     uuid not null references legal_entities(id),
  kind                text not null check (kind in ('liability', 'credit')),
  doc_type            text not null,
  doc_id              uuid,
  doc_number          text,
  occurred_on         date not null default current_date,
  base_amount         numeric(14,2) not null,
  vat_amount          numeric(14,2) not null,
  vat_rate            numeric(5,2) not null,
  counterparty_name   text,
  counterparty_edrpou text,
  note                text,
  created_at          timestamptz not null default now()
);
create index if not exists vat_entries_entity_idx on vat_entries (legal_entity_id, occurred_on desc);

-- ─── Перебудова звітних в'юх у розрізі юрособи ──────────────────────────────

drop view if exists
  v_item_sales_margin, v_customer_balance, v_sales_orders_full, v_so_paid, v_so_cogs,
  v_so_totals, v_item_available, v_reserved, v_production_actual_cost, v_recipe_cost,
  v_production_requirements, v_purchase_price_history, v_po_totals, v_low_stock,
  v_expiring_batches, v_item_stock, v_stock_batches cascade;

create view v_stock_batches as
select m.legal_entity_id,
       m.item_id,
       m.warehouse_id,
       m.batch_id,
       sum(m.qty)               as qty,
       sum(m.qty * m.unit_cost) as value
from stock_moves m
group by m.legal_entity_id, m.item_id, m.warehouse_id, m.batch_id
having abs(sum(m.qty)) > 0.0005;

-- Собівартість середньозважена в межах юрособи: у ТОВ і ФОП вона різна навіть
-- для однієї партії, бо по-різному лягає вхідний ПДВ.
create view v_item_stock as
select i.id        as item_id,
       e.id        as legal_entity_id,
       i.sku,
       i.name,
       i.kind,
       i.unit,
       i.min_stock,
       coalesce(sum(b.qty), 0)   as qty,
       coalesce(sum(b.value), 0) as value,
       case when coalesce(sum(b.qty), 0) > 0
            then sum(b.value) / sum(b.qty)
            else 0 end           as avg_cost
from items i
cross join legal_entities e
left join v_stock_batches b on b.item_id = i.id and b.legal_entity_id = e.id
group by i.id, e.id, i.sku, i.name, i.kind, i.unit, i.min_stock;

create view v_expiring_batches as
select b.id as batch_id,
       b.code,
       b.expires_on,
       (b.expires_on - current_date) as days_left,
       i.id   as item_id,
       i.sku,
       i.name,
       i.unit,
       sb.warehouse_id,
       sb.legal_entity_id,
       sb.qty
from batches b
join items i on i.id = b.item_id
join v_stock_batches sb on sb.batch_id = b.id
where b.expires_on is not null and sb.qty > 0;

-- Дефіцит рахуємо по всіх юрособах разом: закуповувати треба фізично, а не юридично.
create view v_low_stock as
select item_id, sku, name, kind, unit, min_stock, sum(qty) as qty
from v_item_stock
group by item_id, sku, name, kind, unit, min_stock
having min_stock > 0 and sum(qty) < min_stock;

create view v_po_totals as
select p.id as po_id,
       coalesce(sum(l.qty * l.unit_price), 0)          as total_amount,
       coalesce(sum(l.received_qty * l.unit_price), 0) as received_amount,
       coalesce(sum(l.qty), 0)                         as total_qty,
       coalesce(sum(l.received_qty), 0)                as received_qty
from purchase_orders p
left join purchase_order_lines l on l.po_id = p.id
group by p.id;

create view v_purchase_price_history as
select m.item_id,
       m.legal_entity_id,
       m.moved_at,
       m.unit_cost,
       m.qty,
       s.name as supplier_name
from stock_moves m
left join purchase_orders p on p.id = m.doc_id and m.doc_type = 'purchase_order'
left join suppliers s on s.id = p.supplier_id
where m.move_type = 'purchase_receipt';

create view v_production_requirements as
select po.id as production_order_id,
       rl.item_id,
       i.sku,
       i.name,
       i.unit,
       round(rl.qty_per_batch * (1 + rl.loss_pct / 100) * po.planned_qty / r.output_qty, 3) as required_qty,
       coalesce(st.qty, 0)      as available_qty,
       coalesce(st.avg_cost, 0) as avg_cost
from production_orders po
join recipes r        on r.id = po.recipe_id
join recipe_lines rl  on rl.recipe_id = r.id
join items i          on i.id = rl.item_id
left join v_item_stock st on st.item_id = rl.item_id and st.legal_entity_id = po.legal_entity_id
where po.status in ('planned','in_progress');

create view v_recipe_cost as
select r.id as recipe_id,
       st.legal_entity_id,
       r.product_item_id,
       r.output_qty,
       sum(rl.qty_per_batch * (1 + rl.loss_pct / 100) * coalesce(st.avg_cost, 0)) as batch_material_cost,
       sum(rl.qty_per_batch * (1 + rl.loss_pct / 100) * coalesce(st.avg_cost, 0)) / r.output_qty as unit_material_cost
from recipes r
join recipe_lines rl on rl.recipe_id = r.id
join v_item_stock st on st.item_id = rl.item_id
group by r.id, st.legal_entity_id, r.product_item_id, r.output_qty;

create view v_production_actual_cost as
select po.id as production_order_id,
       po.number,
       po.legal_entity_id,
       po.produced_qty,
       coalesce(c.material_cost, 0)                    as material_cost,
       po.overhead_cost,
       coalesce(c.material_cost, 0) + po.overhead_cost as total_cost,
       case when po.produced_qty > 0
            then (coalesce(c.material_cost, 0) + po.overhead_cost) / po.produced_qty
            else 0 end                                as unit_cost
from production_orders po
left join (
  select doc_id, sum(-qty * unit_cost) as material_cost
  from stock_moves
  where move_type = 'production_consume' and doc_type = 'production_order'
  group by doc_id
) c on c.doc_id = po.id;

create view v_reserved as
select o.legal_entity_id, l.item_id, sum(l.qty - l.shipped_qty) as reserved_qty
from sales_order_lines l
join sales_orders o on o.id = l.so_id
where o.status = 'confirmed' and l.qty > l.shipped_qty
group by o.legal_entity_id, l.item_id;

create view v_item_available as
select s.item_id,
       s.legal_entity_id,
       s.sku,
       s.name,
       s.kind,
       s.unit,
       s.qty,
       s.avg_cost,
       coalesce(r.reserved_qty, 0)         as reserved_qty,
       s.qty - coalesce(r.reserved_qty, 0) as available_qty
from v_item_stock s
left join v_reserved r on r.item_id = s.item_id and r.legal_entity_id = s.legal_entity_id;

-- Суми замовлення: база, ПДВ і разом. Для неплатника ПДВ ставка в рядках нульова,
-- тож total = база, і жодних окремих гілок у звітах не потрібно.
create view v_so_totals as
select o.id as so_id,
       coalesce(sum(l.qty * l.unit_price), 0)                            as net_amount,
       coalesce(sum(l.qty * l.unit_price * l.vat_rate / 100), 0)         as vat_amount,
       coalesce(sum(l.qty * l.unit_price * (1 + l.vat_rate / 100)), 0)   as total_amount,
       coalesce(sum(l.shipped_qty * l.unit_price), 0)                    as shipped_net,
       coalesce(sum(l.shipped_qty * l.unit_price * (1 + l.vat_rate / 100)), 0) as shipped_amount,
       coalesce(sum(l.qty), 0)                                           as total_qty,
       coalesce(sum(l.shipped_qty), 0)                                   as shipped_qty
from sales_orders o
left join sales_order_lines l on l.so_id = o.id
group by o.id;

create view v_so_cogs as
select s.so_id, sum(-m.qty * m.unit_cost) as cogs
from stock_moves m
join shipments s on s.id = m.doc_id and m.doc_type = 'shipment'
where m.move_type = 'sale_shipment'
group by s.so_id;

create view v_so_paid as
select so_id, sum(amount) as paid_amount
from payments
where so_id is not null
group by so_id;

-- Маржа рахується від бази без ПДВ: податок — не виручка, він транзитом іде в бюджет.
create view v_sales_orders_full as
select o.id,
       o.number,
       o.status,
       o.ordered_on,
       o.ship_by,
       o.legal_entity_id,
       le.short_name as entity_name,
       o.customer_id,
       c.name  as customer_name,
       c.kind  as customer_kind,
       c.legal_entity_id is not null as is_internal,
       c.payment_terms_days,
       t.net_amount,
       t.vat_amount,
       t.total_amount,
       t.shipped_net,
       t.shipped_amount,
       t.total_qty,
       t.shipped_qty,
       coalesce(g.cogs, 0)                            as cogs,
       t.shipped_net - coalesce(g.cogs, 0)            as margin,
       case when t.shipped_net > 0
            then round((t.shipped_net - coalesce(g.cogs, 0)) / t.shipped_net * 100, 1)
            else 0 end                                as margin_pct,
       coalesce(p.paid_amount, 0)                     as paid_amount,
       t.shipped_amount - coalesce(p.paid_amount, 0)  as balance_due,
       case when o.status = 'shipped' and c.payment_terms_days >= 0
            then (select max(s.shipped_on) from shipments s where s.so_id = o.id) + c.payment_terms_days
            else null end                             as due_date
from sales_orders o
join customers c      on c.id = o.customer_id
join legal_entities le on le.id = o.legal_entity_id
left join v_so_totals t on t.so_id = o.id
left join v_so_cogs g   on g.so_id = o.id
left join v_so_paid p   on p.so_id = o.id;

create view v_customer_balance as
select c.id as customer_id,
       c.name,
       c.kind,
       c.credit_limit,
       coalesce(sh.shipped_amount, 0)                               as shipped_amount,
       coalesce(pa.paid_amount, 0)                                  as paid_amount,
       coalesce(sh.shipped_amount, 0) - coalesce(pa.paid_amount, 0) as balance_due
from customers c
left join (
  select o.customer_id, sum(t.shipped_amount) as shipped_amount
  from sales_orders o join v_so_totals t on t.so_id = o.id
  where o.status <> 'cancelled'
  group by o.customer_id
) sh on sh.customer_id = c.id
left join (
  select customer_id, sum(amount) as paid_amount from payments group by customer_id
) pa on pa.customer_id = c.id;

create view v_item_sales_margin as
with sold as (
  select o.legal_entity_id,
         sl.shipment_id,
         sl.item_id,
         sum(sl.qty)                as qty,
         sum(sl.qty * l.unit_price) as revenue
  from shipment_lines sl
  join sales_order_lines l on l.id = sl.so_line_id
  join shipments sh on sh.id = sl.shipment_id
  join sales_orders o on o.id = sh.so_id
  group by o.legal_entity_id, sl.shipment_id, sl.item_id
),
cost as (
  select m.doc_id as shipment_id,
         m.item_id,
         sum(-m.qty * m.unit_cost) as cogs
  from stock_moves m
  where m.doc_type = 'shipment' and m.move_type = 'sale_shipment'
  group by m.doc_id, m.item_id
)
select i.id as item_id,
       s.legal_entity_id,
       i.sku,
       i.name,
       coalesce(sum(s.qty), 0)                                as sold_qty,
       coalesce(sum(s.revenue), 0)                            as revenue,
       coalesce(sum(c.cogs), 0)                               as cogs,
       coalesce(sum(s.revenue), 0) - coalesce(sum(c.cogs), 0) as margin
from items i
left join sold s on s.item_id = i.id
left join cost c on c.shipment_id = s.shipment_id and c.item_id = s.item_id
where i.kind = 'finished'
group by i.id, s.legal_entity_id, i.sku, i.name;

-- Зведення для декларації: зобов'язання мінус кредит за місяць.
create view v_vat_summary as
select legal_entity_id,
       date_trunc('month', occurred_on)::date                      as period,
       sum(vat_amount) filter (where kind = 'liability')            as liability,
       sum(vat_amount) filter (where kind = 'credit')               as credit,
       coalesce(sum(vat_amount) filter (where kind = 'liability'), 0)
         - coalesce(sum(vat_amount) filter (where kind = 'credit'), 0) as payable
from vat_entries
group by legal_entity_id, date_trunc('month', occurred_on);
