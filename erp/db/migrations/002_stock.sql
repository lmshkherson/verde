-- 002_stock.sql — партії та журнал рухів. Залишки ніколи не правляться напряму:
-- вони завжди є сумою рухів, тож будь-яку цифру можна пояснити документом.

create table if not exists batches (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references items(id),
  code         text not null,
  produced_on  date,
  expires_on   date,
  source       text not null check (source in ('purchase','production','opening')),
  created_at   timestamptz not null default now(),
  unique (item_id, code)
);
create index if not exists batches_expiry_idx on batches (expires_on);

create table if not exists stock_moves (
  id           bigserial primary key,
  moved_at     timestamptz not null default now(),
  item_id      uuid not null references items(id),
  batch_id     uuid references batches(id),
  warehouse_id uuid not null references warehouses(id),
  qty          numeric(14,3) not null check (qty <> 0),   -- + прихід, − видаток
  unit_cost    numeric(14,4) not null default 0 check (unit_cost >= 0),
  move_type    text not null check (move_type in (
                 'opening','purchase_receipt','production_consume','production_output',
                 'sale_shipment','write_off','adjustment','transfer_in','transfer_out')),
  doc_type     text,
  doc_id       uuid,
  user_id      uuid references app_users(id),
  note         text
);
create index if not exists stock_moves_item_idx on stock_moves (item_id, warehouse_id);
create index if not exists stock_moves_doc_idx  on stock_moves (doc_type, doc_id);
create index if not exists stock_moves_at_idx   on stock_moves (moved_at desc);
create index if not exists stock_moves_batch_idx on stock_moves (batch_id);

-- Залишок і вартість у розрізі партії та складу.
create or replace view v_stock_batches as
select m.item_id,
       m.warehouse_id,
       m.batch_id,
       sum(m.qty)               as qty,
       sum(m.qty * m.unit_cost) as value
from stock_moves m
group by m.item_id, m.warehouse_id, m.batch_id
having abs(sum(m.qty)) > 0.0005;

-- Зведений залишок по номенклатурі + середньозважена собівартість.
create or replace view v_item_stock as
select i.id        as item_id,
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
left join v_stock_batches b on b.item_id = i.id
group by i.id, i.sku, i.name, i.kind, i.unit, i.min_stock;

-- Партії, що добігають кінця терміну придатності (лише ті, що ще лежать на складі).
create or replace view v_expiring_batches as
select b.id as batch_id,
       b.code,
       b.expires_on,
       (b.expires_on - current_date) as days_left,
       i.id   as item_id,
       i.sku,
       i.name,
       i.unit,
       sb.warehouse_id,
       sb.qty
from batches b
join items i on i.id = b.item_id
join v_stock_batches sb on sb.batch_id = b.id
where b.expires_on is not null and sb.qty > 0;

create or replace view v_low_stock as
select *
from v_item_stock
where min_stock > 0 and qty < min_stock;
