-- 004_production.sql — рецептури (BOM) і виробничі замовлення

create table if not exists recipes (
  id              uuid primary key default gen_random_uuid(),
  product_item_id uuid not null references items(id),
  version         int  not null default 1,
  output_qty      numeric(14,3) not null check (output_qty > 0),  -- скільки одиниць ГП дає одна варка
  is_active       boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  unique (product_item_id, version)
);

create table if not exists recipe_lines (
  id            uuid primary key default gen_random_uuid(),
  recipe_id     uuid not null references recipes(id) on delete cascade,
  item_id       uuid not null references items(id),
  qty_per_batch numeric(14,4) not null check (qty_per_batch > 0),
  loss_pct      numeric(5,2) not null default 0 check (loss_pct >= 0 and loss_pct < 100),
  unique (recipe_id, item_id)
);

create table if not exists production_orders (
  id              uuid primary key default gen_random_uuid(),
  number          text not null unique,
  product_item_id uuid not null references items(id),
  recipe_id       uuid not null references recipes(id),
  planned_qty     numeric(14,3) not null check (planned_qty > 0),
  produced_qty    numeric(14,3) not null default 0 check (produced_qty >= 0),
  status          text not null default 'planned' check (status in ('planned','in_progress','done','cancelled')),
  planned_for     date,
  started_at      timestamptz,
  finished_at     timestamptz,
  overhead_cost   numeric(14,2) not null default 0 check (overhead_cost >= 0),
  output_batch_id uuid references batches(id),
  note            text,
  created_by      uuid references app_users(id),
  created_at      timestamptz not null default now()
);
create index if not exists production_orders_status_idx on production_orders (status, planned_for);

-- Потреба в сировині під відкриті виробничі замовлення проти фактичного залишку.
create or replace view v_production_requirements as
select po.id as production_order_id,
       rl.item_id,
       i.sku,
       i.name,
       i.unit,
       round(rl.qty_per_batch * (1 + rl.loss_pct / 100) * po.planned_qty / r.output_qty, 3) as required_qty,
       coalesce(st.qty, 0)     as available_qty,
       coalesce(st.avg_cost, 0) as avg_cost
from production_orders po
join recipes r        on r.id = po.recipe_id
join recipe_lines rl  on rl.recipe_id = r.id
join items i          on i.id = rl.item_id
left join v_item_stock st on st.item_id = rl.item_id
where po.status in ('planned','in_progress');

-- Планова собівартість одиниці ГП за рецептурою і поточними цінами сировини.
create or replace view v_recipe_cost as
select r.id as recipe_id,
       r.product_item_id,
       r.output_qty,
       sum(rl.qty_per_batch * (1 + rl.loss_pct / 100) * coalesce(st.avg_cost, 0)) as batch_material_cost,
       sum(rl.qty_per_batch * (1 + rl.loss_pct / 100) * coalesce(st.avg_cost, 0)) / r.output_qty as unit_material_cost
from recipes r
join recipe_lines rl on rl.recipe_id = r.id
left join v_item_stock st on st.item_id = rl.item_id
group by r.id, r.product_item_id, r.output_qty;

-- Фактична собівартість закритої партії: спожита сировина + накладні / фактичний випуск.
create or replace view v_production_actual_cost as
select po.id as production_order_id,
       po.number,
       po.produced_qty,
       coalesce(c.material_cost, 0)                                as material_cost,
       po.overhead_cost,
       coalesce(c.material_cost, 0) + po.overhead_cost             as total_cost,
       case when po.produced_qty > 0
            then (coalesce(c.material_cost, 0) + po.overhead_cost) / po.produced_qty
            else 0 end                                            as unit_cost
from production_orders po
left join (
  select doc_id, sum(-qty * unit_cost) as material_cost
  from stock_moves
  where move_type = 'production_consume' and doc_type = 'production_order'
  group by doc_id
) c on c.doc_id = po.id;
