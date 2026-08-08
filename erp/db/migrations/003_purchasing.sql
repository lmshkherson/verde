-- 003_purchasing.sql — постачальники, заявки на закупівлю, прихід сировини

create table if not exists suppliers (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  edrpou              text,
  contact             text,
  phone               text,
  payment_terms_days  int not null default 0,
  is_active           boolean not null default true,
  note                text,
  created_at          timestamptz not null default now()
);

create table if not exists purchase_orders (
  id          uuid primary key default gen_random_uuid(),
  number      text not null unique,
  supplier_id uuid not null references suppliers(id),
  status      text not null default 'draft' check (status in ('draft','ordered','received','cancelled')),
  ordered_on  date not null default current_date,
  expected_on date,
  note        text,
  created_by  uuid references app_users(id),
  created_at  timestamptz not null default now()
);
create index if not exists purchase_orders_status_idx on purchase_orders (status, ordered_on desc);

create table if not exists purchase_order_lines (
  id           uuid primary key default gen_random_uuid(),
  po_id        uuid not null references purchase_orders(id) on delete cascade,
  item_id      uuid not null references items(id),
  qty          numeric(14,3) not null check (qty > 0),
  unit_price   numeric(14,4) not null check (unit_price >= 0),
  received_qty numeric(14,3) not null default 0 check (received_qty >= 0)
);
create index if not exists purchase_order_lines_po_idx on purchase_order_lines (po_id);

create or replace view v_po_totals as
select p.id as po_id,
       coalesce(sum(l.qty * l.unit_price), 0)          as total_amount,
       coalesce(sum(l.received_qty * l.unit_price), 0) as received_amount,
       coalesce(sum(l.qty), 0)                         as total_qty,
       coalesce(sum(l.received_qty), 0)                as received_qty
from purchase_orders p
left join purchase_order_lines l on l.po_id = p.id
group by p.id;

-- Історія закупівельних цін — видно, як дорожчає сировина.
create or replace view v_purchase_price_history as
select m.item_id,
       m.moved_at,
       m.unit_cost,
       m.qty,
       s.name as supplier_name
from stock_moves m
left join purchase_orders p on p.id = m.doc_id and m.doc_type = 'purchase_order'
left join suppliers s on s.id = p.supplier_id
where m.move_type = 'purchase_receipt';
