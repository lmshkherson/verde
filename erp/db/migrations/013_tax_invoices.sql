-- 013_tax_invoices.sql — податкові накладні та декларація з ПДВ.
--
-- Строки реєстрації винесені в налаштування, а не зашиті в код: вони змінюються
-- законом, і оновлення програми не має бути умовою дотримання строку.
--
-- Коди УКТЗЕД і одиниць виміру заповнюються один раз у номенклатурі. Значення
-- за замовчуванням проставлені як робочі, але їх ОБОВ'ЯЗКОВО треба звірити:
-- помилковий код у податковій накладній — підстава для її неприйняття.

alter table settings add column if not exists pn_deadline_first_half  int not null default 5;
alter table settings add column if not exists pn_deadline_second_half int not null default 18;

alter table items add column if not exists uktzed   text;
alter table items add column if not exists uom_code text;

-- Покупець-неплатник ПДВ отримує накладну з умовним ІПН.
alter table customers add column if not exists ipn          text;
alter table customers add column if not exists is_vat_payer boolean not null default true;

create table if not exists tax_invoices (
  id                 uuid primary key default gen_random_uuid(),
  legal_entity_id    uuid not null references legal_entities(id),
  number             text not null,
  issued_on          date not null,
  shipment_id        uuid references shipments(id),
  customer_id        uuid references customers(id),
  counterparty_name  text not null,
  counterparty_ipn   text,
  base_amount        numeric(14,2) not null default 0,
  vat_amount         numeric(14,2) not null default 0,
  total_amount       numeric(14,2) not null default 0,
  vat_rate           numeric(5,2)  not null default 20,
  status             text not null default 'draft'
                       check (status in ('draft','registered','rejected','cancelled')),
  register_deadline  date,
  registered_on      date,
  note               text,
  created_by         uuid references app_users(id),
  created_at         timestamptz not null default now(),
  unique (legal_entity_id, number)
);
create index if not exists tax_invoices_period_idx on tax_invoices (legal_entity_id, issued_on desc);
create unique index if not exists tax_invoices_shipment_key on tax_invoices (shipment_id)
  where shipment_id is not null;

create table if not exists tax_invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references tax_invoices(id) on delete cascade,
  line_no     int not null,
  item_id     uuid references items(id),
  description text not null,
  uktzed      text,
  uom_code    text,
  qty         numeric(14,3) not null,
  unit_price  numeric(14,4) not null,
  vat_rate    numeric(5,2) not null default 20,
  base_amount numeric(14,2) not null,
  vat_amount  numeric(14,2) not null
);
create index if not exists tax_invoice_lines_idx on tax_invoice_lines (invoice_id);

-- Декларація зберігається, а не рахується на льоту, бо від'ємне значення
-- переноситься з періоду в період — ланцюжок має бути явним і перевірюваним.
create table if not exists vat_declarations (
  id               uuid primary key default gen_random_uuid(),
  legal_entity_id  uuid not null references legal_entities(id),
  period           date not null,
  status           text not null default 'draft' check (status in ('draft','submitted')),
  liability_base   numeric(14,2) not null default 0,
  liability_vat    numeric(14,2) not null default 0,
  credit_base      numeric(14,2) not null default 0,
  credit_vat       numeric(14,2) not null default 0,
  prev_negative    numeric(14,2) not null default 0,
  payable          numeric(14,2) not null default 0,
  negative_carry   numeric(14,2) not null default 0,
  prepared_on      date,
  submitted_on     date,
  created_by       uuid references app_users(id),
  created_at       timestamptz not null default now(),
  unique (legal_entity_id, period)
);

-- Відвантаження, на які ще не виписано податкову накладну.
create or replace view v_shipments_without_invoice as
select sh.id as shipment_id,
       o.legal_entity_id,
       sh.number,
       sh.shipped_on,
       o.customer_id,
       c.name  as customer_name,
       c.ipn   as customer_ipn,
       c.edrpou,
       c.is_vat_payer as customer_is_vat_payer,
       coalesce(sum(sl.qty * l.unit_price), 0)                  as base_amount,
       coalesce(sum(sl.qty * l.unit_price * l.vat_rate / 100), 0) as vat_amount
from shipments sh
join sales_orders o on o.id = sh.so_id
join customers c on c.id = o.customer_id
join shipment_lines sl on sl.shipment_id = sh.id
join sales_order_lines l on l.id = sl.so_line_id
join legal_entities e on e.id = o.legal_entity_id
where e.is_vat_payer
  and not exists (select 1 from tax_invoices ti where ti.shipment_id = sh.id)
group by sh.id, o.legal_entity_id, sh.number, sh.shipped_on, o.customer_id,
         c.name, c.ipn, c.edrpou, c.is_vat_payer
having coalesce(sum(sl.qty * l.unit_price * l.vat_rate / 100), 0) > 0;

-- Стан реєстрації: що прострочено, що горить, що вже зареєстровано.
create or replace view v_tax_invoice_status as
select t.*,
       case
         when t.status = 'registered' then 'registered'
         when t.status in ('rejected','cancelled') then t.status
         when t.register_deadline < current_date then 'overdue'
         when t.register_deadline <= current_date + 3 then 'due_soon'
         else 'pending'
       end as urgency,
       (t.register_deadline - current_date) as days_left
from tax_invoices t;
