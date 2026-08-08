-- 001_core.sql — користувачі, довідники, нумерація документів

create table if not exists app_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  full_name     text not null,
  role          text not null check (role in ('owner','sales','production','warehouse')),
  password_hash text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
create unique index if not exists app_users_email_key on app_users (lower(email));

-- Єдина таблиця номенклатури: сировина, пакування, напівфабрикат і готова продукція.
-- Один item_id у складському журналі спрощує геть усе — від залишків до собівартості.
create table if not exists items (
  id                 uuid primary key default gen_random_uuid(),
  sku                text not null unique,
  name               text not null,
  kind               text not null check (kind in ('raw','packaging','semi','finished')),
  unit               text not null check (unit in ('kg','g','l','ml','pcs','pack')),
  shelf_life_days    int,
  min_stock          numeric(14,3) not null default 0,
  weight_g           numeric(10,3),
  pcs_per_box        int,
  price_distributor  numeric(14,2),
  price_network      numeric(14,2),
  price_rrp          numeric(14,2),
  is_active          boolean not null default true,
  note               text,
  created_at         timestamptz not null default now()
);
create index if not exists items_kind_idx on items (kind) where is_active;

create table if not exists warehouses (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  kind       text not null check (kind in ('raw','finished','wip')),
  is_active  boolean not null default true
);

create table if not exists settings (
  id                      int primary key default 1 check (id = 1),
  company_name            text not null default 'VERDE',
  currency                text not null default 'UAH',
  default_overhead_per_kg numeric(14,2) not null default 0,
  expiry_alert_days       int not null default 60
);
insert into settings (id) values (1) on conflict do nothing;

-- Наскрізна нумерація документів у форматі PREFIX-РІК-0001, з річним скиданням.
create table if not exists doc_counters (
  prefix  text primary key,
  year    int  not null,
  counter int  not null
);

create or replace function next_doc_number(p_prefix text) returns text as $$
declare
  y int := extract(year from now())::int;
  c int;
begin
  insert into doc_counters (prefix, year, counter)
  values (p_prefix, y, 1)
  on conflict (prefix) do update
    set counter = case when doc_counters.year = y then doc_counters.counter + 1 else 1 end,
        year    = y
  returning doc_counters.counter into c;

  return p_prefix || '-' || y || '-' || lpad(c::text, 4, '0');
end;
$$ language plpgsql;

create table if not exists audit_log (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  user_id   uuid references app_users(id),
  action    text not null,
  entity    text not null,
  entity_id text,
  details   jsonb
);
create index if not exists audit_log_at_idx on audit_log (at desc);
