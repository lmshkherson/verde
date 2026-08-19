-- 036_write_off_acts.sql — акт списання як повноцінний документ.
--
-- Разова операція списання лишалася без номера, статусу і друкованої форми.
-- Тепер є документ СПС: багато рядків, стаття витрат, чернетка → проведення,
-- скасування, Дт/Кт і акт на підпис комісії.
--
-- Стаття витрат — головна відмінність від старої операції: списання на
-- блогерів — це маркетинг, псування — «псування і втрати», зразки на
-- дегустацію — теж маркетинг. У фінрезультаті сума йде саме за статтею
-- (через expenses), а не в загальний котел «Списання».
--
-- Окремий сценарій — безоплатна відправка на основі замовлення: із
-- замовлення створюються і відвантаження (для ТТН), і акт списання; ціни
-- рядків обнуляються, тож виручки, дебіторки й ПДВ із продажу немає ніде.

create table if not exists write_offs (
  id              uuid primary key default gen_random_uuid(),
  number          text not null unique,
  legal_entity_id uuid not null references legal_entities(id),
  warehouse_id    uuid references warehouses(id),
  category        text not null default 'spoilage',
  reason          text,
  written_off_on  date not null default current_date,
  status          text not null default 'draft'
                    check (status in ('draft','posted','cancelled')),
  -- Джерела безоплатної відправки: замовлення і створене для ТТН відвантаження.
  so_id           uuid references sales_orders(id),
  shipment_id     uuid references shipments(id),
  note            text,
  created_by      uuid references app_users(id),
  created_at      timestamptz not null default now(),
  posted_at       timestamptz
);
create index if not exists write_offs_entity_idx on write_offs (legal_entity_id, written_off_on desc);

create table if not exists write_off_lines (
  id           uuid primary key default gen_random_uuid(),
  write_off_id uuid not null references write_offs(id) on delete cascade,
  item_id      uuid not null references items(id),
  qty          numeric(14,3) not null check (qty > 0),
  note         text
);
create index if not exists write_off_lines_doc_idx on write_off_lines (write_off_id);

-- Витрата, породжена актом: сума собівартості лягає за статтею акта.
alter table expenses add column if not exists write_off_id uuid references write_offs(id) on delete set null;

-- Нова стаття «псування і втрати» — для актів списання зіпсованого.
alter table expenses drop constraint if exists expenses_category_check;
alter table expenses add constraint expenses_category_check check (category in (
  'rent', 'salary', 'utilities', 'logistics', 'marketing', 'bank', 'services', 'other',
  'production_salary', 'production_energy', 'spoilage'
));

-- Фінрезультат: рядок «Списання» тепер лише для разових операцій без акта.
-- Акти йдуть через expenses за своєю статтею — інакше сума подвоїлася б.
drop view if exists v_pl_monthly;
create view v_pl_monthly as
with revenue as (
  select o.legal_entity_id,
         date_trunc('month', sh.shipped_on)::date as period,
         sum(sl.qty * l.unit_price)               as revenue_net
  from shipment_lines sl
  join sales_order_lines l on l.id = sl.so_line_id
  join shipments sh on sh.id = sl.shipment_id
  join sales_orders o on o.id = sh.so_id
  group by o.legal_entity_id, date_trunc('month', sh.shipped_on)
),
returns as (
  select a.legal_entity_id,
         date_trunc('month', a.returned_on)::date as period,
         sum(a.net_amount)                        as returns_net,
         sum(a.cost_returned)                     as cost_returned,
         sum(a.cost_lost)                         as cost_lost
  from v_return_amounts a
  group by a.legal_entity_id, date_trunc('month', a.returned_on)
),
cogs as (
  select m.legal_entity_id,
         date_trunc('month', sh.shipped_on)::date as period,
         sum(-m.qty * m.unit_cost)                as cogs
  from stock_moves m
  join shipments sh on sh.id = m.doc_id and m.doc_type = 'shipment'
  where m.move_type = 'sale_shipment'
  group by m.legal_entity_id, date_trunc('month', sh.shipped_on)
),
losses as (
  select legal_entity_id,
         date_trunc('month', moved_at)::date as period,
         sum(-qty * unit_cost)               as write_offs
  from stock_moves
  where move_type = 'write_off'
    and doc_type is distinct from 'write_off_act'
  group by legal_entity_id, date_trunc('month', moved_at)
),
exp as (
  select legal_entity_id,
         date_trunc('month', spent_on)::date as period,
         sum(amount_net) filter (where category in ('production_salary','production_energy')) as production,
         sum(amount_net) filter (where category not in ('production_salary','production_energy')) as other
  from expenses group by legal_entity_id, date_trunc('month', spent_on)
),
pay as (
  select legal_entity_id, period, production_cost, overhead_cost
  from v_payroll_totals where status <> 'draft'
),
dep as (
  select legal_entity_id, period,
         production_management,
         management - production_management as overhead_management
  from v_depreciation_totals
),
keys as (
  select legal_entity_id, period from revenue
  union select legal_entity_id, period from returns
  union select legal_entity_id, period from cogs
  union select legal_entity_id, period from losses
  union select legal_entity_id, period from exp
  union select legal_entity_id, period from pay
  union select legal_entity_id, period from dep
)
select k.legal_entity_id,
       k.period,
       coalesce(r.revenue_net, 0)                        as revenue_gross_net,
       coalesce(ret.returns_net, 0)                      as returns_net,
       coalesce(r.revenue_net, 0) - coalesce(ret.returns_net, 0) as revenue_net,
       coalesce(c.cogs, 0) - coalesce(ret.cost_returned, 0)
         - coalesce(ret.cost_lost, 0)                            as cogs,
       coalesce(r.revenue_net, 0) - coalesce(ret.returns_net, 0)
         - coalesce(c.cogs, 0) + coalesce(ret.cost_returned, 0)
         + coalesce(ret.cost_lost, 0)                            as gross_profit,
       coalesce(l.write_offs, 0) + coalesce(ret.cost_lost, 0)    as write_offs,
       coalesce(e.production, 0) + coalesce(p.production_cost, 0)
         + coalesce(d.production_management, 0)          as production_costs,
       coalesce(e.other, 0) + coalesce(p.overhead_cost, 0)
         + coalesce(d.overhead_management, 0)            as opex,
       coalesce(r.revenue_net, 0) - coalesce(ret.returns_net, 0)
         - coalesce(c.cogs, 0) + coalesce(ret.cost_returned, 0) + coalesce(ret.cost_lost, 0)
         - coalesce(l.write_offs, 0) - coalesce(ret.cost_lost, 0)
         - coalesce(e.production, 0) - coalesce(p.production_cost, 0) - coalesce(d.production_management, 0)
         - coalesce(e.other, 0) - coalesce(p.overhead_cost, 0) - coalesce(d.overhead_management, 0)
                                                         as net_result
from keys k
left join revenue r  on r.legal_entity_id = k.legal_entity_id and r.period = k.period
left join returns ret on ret.legal_entity_id = k.legal_entity_id and ret.period = k.period
left join cogs c     on c.legal_entity_id = k.legal_entity_id and c.period = k.period
left join losses l   on l.legal_entity_id = k.legal_entity_id and l.period = k.period
left join exp e      on e.legal_entity_id = k.legal_entity_id and e.period = k.period
left join pay p      on p.legal_entity_id = k.legal_entity_id and p.period = k.period
left join dep d      on d.legal_entity_id = k.legal_entity_id and d.period = k.period;
