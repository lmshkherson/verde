-- 005_sales.sql — клієнти, замовлення B2B, відвантаження, оплати

create table if not exists customers (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  kind               text not null check (kind in ('network','distributor','pharmacy','horeca','retail')),
  edrpou             text,
  contact            text,
  phone              text,
  price_level        text not null default 'distributor' check (price_level in ('distributor','network','rrp')),
  payment_terms_days int not null default 0,
  credit_limit       numeric(14,2) not null default 0,
  is_active          boolean not null default true,
  note               text,
  created_at         timestamptz not null default now()
);

create table if not exists sales_orders (
  id          uuid primary key default gen_random_uuid(),
  number      text not null unique,
  customer_id uuid not null references customers(id),
  -- статус описує виконання, не оплату: оплата рахується з таблиці payments
  status      text not null default 'draft' check (status in ('draft','confirmed','shipped','cancelled')),
  ordered_on  date not null default current_date,
  ship_by     date,
  note        text,
  created_by  uuid references app_users(id),
  created_at  timestamptz not null default now()
);
create index if not exists sales_orders_status_idx on sales_orders (status, ordered_on desc);
create index if not exists sales_orders_customer_idx on sales_orders (customer_id);

create table if not exists sales_order_lines (
  id          uuid primary key default gen_random_uuid(),
  so_id       uuid not null references sales_orders(id) on delete cascade,
  item_id     uuid not null references items(id),
  qty         numeric(14,3) not null check (qty > 0),
  unit_price  numeric(14,2) not null check (unit_price >= 0),
  shipped_qty numeric(14,3) not null default 0 check (shipped_qty >= 0)
);
create index if not exists sales_order_lines_so_idx on sales_order_lines (so_id);

create table if not exists shipments (
  id          uuid primary key default gen_random_uuid(),
  number      text not null unique,
  so_id       uuid not null references sales_orders(id),
  shipped_on  date not null default current_date,
  ttn_number  text,
  carrier     text,
  created_by  uuid references app_users(id),
  created_at  timestamptz not null default now()
);
create index if not exists shipments_so_idx on shipments (so_id);

create table if not exists shipment_lines (
  id          uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  so_line_id  uuid not null references sales_order_lines(id),
  item_id     uuid not null references items(id),
  qty         numeric(14,3) not null check (qty > 0)
);

create table if not exists payments (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  so_id       uuid references sales_orders(id),
  paid_on     date not null default current_date,
  amount      numeric(14,2) not null check (amount <> 0),
  method      text not null default 'bank' check (method in ('bank','cash','other')),
  note        text,
  created_by  uuid references app_users(id),
  created_at  timestamptz not null default now()
);
create index if not exists payments_customer_idx on payments (customer_id, paid_on desc);
