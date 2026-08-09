-- 012_payroll_assets.sql — зарплата, основні засоби й амортизація.
--
-- Обидві ділянки додають нові точки розбіжності між книгами:
--   зарплата цеху — Дт 23 у бухгалтерському обліку проти Дт 91 в управлінському
--   амортизація  — різні строки корисного використання, отже різні суми
--
-- Підрозділ працівника й ОЗ визначає рахунок витрат, тож рознесення відбувається
-- автоматично, а не руками при кожному нарахуванні.

alter table settings add column if not exists pdfo_rate     numeric(5,2) not null default 18;
alter table settings add column if not exists military_rate numeric(5,2) not null default 5;
alter table settings add column if not exists esv_rate      numeric(5,2) not null default 22;

-- ─── Зарплата ───────────────────────────────────────────────────────────────

create table if not exists employees (
  id              uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references legal_entities(id),
  full_name       text not null,
  position        text,
  -- Підрозділ визначає рахунок витрат: цех іде у виробництво, решта — у період.
  department      text not null check (department in ('production','admin','sales')),
  monthly_salary  numeric(14,2) not null default 0 check (monthly_salary >= 0),
  hired_on        date,
  is_active       boolean not null default true,
  note            text,
  created_at      timestamptz not null default now()
);
create index if not exists employees_entity_idx on employees (legal_entity_id) where is_active;

create table if not exists payroll_runs (
  id              uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references legal_entities(id),
  period          date not null,
  status          text not null default 'draft' check (status in ('draft','posted','paid')),
  paid_on         date,
  note            text,
  created_by      uuid references app_users(id),
  created_at      timestamptz not null default now(),
  unique (legal_entity_id, period)
);

create table if not exists payroll_lines (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references payroll_runs(id) on delete cascade,
  employee_id uuid not null references employees(id),
  department  text not null,
  gross       numeric(14,2) not null check (gross >= 0),
  pdfo        numeric(14,2) not null default 0,
  military    numeric(14,2) not null default 0,
  esv         numeric(14,2) not null default 0,
  net         numeric(14,2) not null default 0,
  unique (run_id, employee_id)
);

create or replace view v_payroll_totals as
select r.id as run_id,
       r.legal_entity_id,
       r.period,
       r.status,
       coalesce(sum(l.gross), 0)                                   as gross,
       coalesce(sum(l.pdfo), 0)                                    as pdfo,
       coalesce(sum(l.military), 0)                                as military,
       coalesce(sum(l.esv), 0)                                     as esv,
       coalesce(sum(l.net), 0)                                     as net,
       coalesce(sum(l.gross + l.esv), 0)                           as total_cost,
       coalesce(sum(l.gross + l.esv) filter (where l.department = 'production'), 0) as production_cost,
       coalesce(sum(l.gross + l.esv) filter (where l.department <> 'production'), 0) as overhead_cost
from payroll_runs r
left join payroll_lines l on l.run_id = r.id
group by r.id, r.legal_entity_id, r.period, r.status;

-- ─── Основні засоби ─────────────────────────────────────────────────────────

create table if not exists fixed_assets (
  id                   uuid primary key default gen_random_uuid(),
  legal_entity_id      uuid not null references legal_entities(id),
  name                 text not null,
  inventory_no         text,
  department           text not null check (department in ('production','admin','sales')),
  acquired_on          date not null,
  cost                 numeric(14,2) not null check (cost > 0),
  residual_value       numeric(14,2) not null default 0 check (residual_value >= 0),
  -- Строк для бухгалтерського обліку і, окремо, для управлінського. Саме тут
  -- виникає класична розбіжність: бухгалтерія тримає податковий мінімум,
  -- управлінський облік — реальний строк служби обладнання.
  useful_life_months   int not null check (useful_life_months > 0),
  useful_life_mgmt     int check (useful_life_mgmt > 0),
  disposed_on          date,
  is_active            boolean not null default true,
  note                 text,
  created_at           timestamptz not null default now()
);

create table if not exists depreciation_runs (
  id              uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references legal_entities(id),
  period          date not null,
  created_by      uuid references app_users(id),
  created_at      timestamptz not null default now(),
  unique (legal_entity_id, period)
);

create table if not exists depreciation_lines (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references depreciation_runs(id) on delete cascade,
  asset_id           uuid not null references fixed_assets(id),
  department         text not null,
  amount_accounting  numeric(14,2) not null default 0,
  amount_management  numeric(14,2) not null default 0,
  unique (run_id, asset_id)
);

-- Скільки амортизації вже нараховано, щоб не перевищити вартість, що амортизується.
create or replace view v_asset_depreciation as
select a.id as asset_id,
       a.legal_entity_id,
       a.name,
       a.cost,
       a.residual_value,
       a.cost - a.residual_value                            as depreciable,
       coalesce(sum(l.amount_accounting), 0)                as accumulated_accounting,
       coalesce(sum(l.amount_management), 0)                as accumulated_management,
       a.cost - coalesce(sum(l.amount_accounting), 0)       as book_value_accounting,
       a.cost - coalesce(sum(l.amount_management), 0)       as book_value_management
from fixed_assets a
left join depreciation_lines l on l.asset_id = a.id
group by a.id;

create or replace view v_depreciation_totals as
select r.id as run_id,
       r.legal_entity_id,
       r.period,
       coalesce(sum(l.amount_accounting), 0) as accounting,
       coalesce(sum(l.amount_management), 0) as management,
       coalesce(sum(l.amount_accounting) filter (where l.department = 'production'), 0) as production_accounting,
       coalesce(sum(l.amount_management) filter (where l.department = 'production'), 0) as production_management
from depreciation_runs r
left join depreciation_lines l on l.run_id = r.id
group by r.id, r.legal_entity_id, r.period;

-- ─── Фінансовий результат з урахуванням зарплати й амортизації ──────────────
-- Управлінський погляд: усе, що стосується цеху, — витрати періоду.

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
  from stock_moves where move_type = 'write_off'
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
  union select legal_entity_id, period from cogs
  union select legal_entity_id, period from losses
  union select legal_entity_id, period from exp
  union select legal_entity_id, period from pay
  union select legal_entity_id, period from dep
)
select k.legal_entity_id,
       k.period,
       coalesce(r.revenue_net, 0)                       as revenue_net,
       coalesce(c.cogs, 0)                              as cogs,
       coalesce(r.revenue_net, 0) - coalesce(c.cogs, 0) as gross_profit,
       coalesce(l.write_offs, 0)                        as write_offs,
       coalesce(e.production, 0) + coalesce(p.production_cost, 0)
         + coalesce(d.production_management, 0)         as production_costs,
       coalesce(e.other, 0) + coalesce(p.overhead_cost, 0)
         + coalesce(d.overhead_management, 0)           as opex,
       coalesce(r.revenue_net, 0) - coalesce(c.cogs, 0) - coalesce(l.write_offs, 0)
         - coalesce(e.production, 0) - coalesce(p.production_cost, 0) - coalesce(d.production_management, 0)
         - coalesce(e.other, 0) - coalesce(p.overhead_cost, 0) - coalesce(d.overhead_management, 0)
                                                        as net_result
from keys k
left join revenue r on r.legal_entity_id = k.legal_entity_id and r.period = k.period
left join cogs c    on c.legal_entity_id = k.legal_entity_id and c.period = k.period
left join losses l  on l.legal_entity_id = k.legal_entity_id and l.period = k.period
left join exp e     on e.legal_entity_id = k.legal_entity_id and e.period = k.period
left join pay p     on p.legal_entity_id = k.legal_entity_id and p.period = k.period
left join dep d     on d.legal_entity_id = k.legal_entity_id and d.period = k.period;
