-- 030_receipts.sql — надходження як самостійний документ.
--
-- Досі прихід був етапом заявки на закупівлю: спершу замовили, потім
-- прийняли. Для планових поставок сировини це правильно, але життя ширше:
-- послуги ніхто наперед не «замовляє» в системі, а частину сировини купують
-- без заявки взагалі. Вигадувати заявку заднім числом заради приходу —
-- підганяти роботу під програму замість навпаки.
--
-- Тому надходження стає окремим документом, який можна створити з нуля.
-- Заявка при цьому нікуди не дінеться: там, де вона є, вона й лишається
-- зручнішою, бо стежить за недопоставками.

create table if not exists receipts (
  id                 uuid primary key default gen_random_uuid(),
  number             text not null unique,
  legal_entity_id    uuid not null references legal_entities(id),
  supplier_id        uuid not null references suppliers(id),
  -- Заявка не обов'язкова. Якщо вона є — документ на неї посилається, і це
  -- корисно для історії; якщо немає — надходження живе саме по собі.
  po_id              uuid references purchase_orders(id),
  received_on        date not null default current_date,
  -- Реквізити документа постачальника: саме він є первинним, а наш номер
  -- потрібен лише для внутрішнього порядку.
  supplier_doc_number text,
  supplier_doc_date   date,
  prices_include_vat  boolean not null default true,
  warehouse_id       uuid references warehouses(id),
  status             text not null default 'draft'
                       check (status in ('draft','posted','cancelled')),
  note               text,
  created_by         uuid references app_users(id),
  created_at         timestamptz not null default now(),
  posted_at          timestamptz
);
create index if not exists receipts_entity_idx on receipts (legal_entity_id, received_on desc);

create table if not exists receipt_lines (
  id            uuid primary key default gen_random_uuid(),
  receipt_id    uuid not null references receipts(id) on delete cascade,
  -- Товар іде на склад і в запаси, послуга — одразу у витрати періоду.
  -- Один документ може містити і те, і те: перевізник часто виставляє
  -- доставку тим самим актом, що й товар.
  kind          text not null check (kind in ('goods','service')),
  item_id       uuid references items(id),
  description   text,
  category      text,
  cost_behavior text not null default 'fixed' check (cost_behavior in ('fixed','variable')),
  qty           numeric(14,3) not null default 1 check (qty > 0),
  unit_price    numeric(14,4) not null default 0 check (unit_price >= 0),
  vat_rate      numeric(5,2) not null default 20,
  batch_code    text,
  expires_on    date,
  -- Товарний рядок без номенклатури безглуздий, як і послуга без опису.
  constraint receipt_lines_shape check (
    (kind = 'goods' and item_id is not null) or
    (kind = 'service' and description is not null and category is not null)
  )
);
create index if not exists receipt_lines_receipt_idx on receipt_lines (receipt_id);

-- Витрата, породжена надходженням. Потрібно, щоб скасування документа
-- прибирало за собою, а не лишало сироту в фінрезультаті.
alter table expenses add column if not exists receipt_id uuid references receipts(id) on delete set null;

-- Суми документа. Ціни в рядках зберігаються так, як їх дав постачальник,
-- а прапорець «з ПДВ» на шапці каже, як їх читати — рівно як у заявці.
create or replace view v_receipt_amounts as
select r.id as receipt_id,
       coalesce(sum(
         case when r.prices_include_vat
              then round(l.qty * l.unit_price / (1 + l.vat_rate / 100), 2)
              else round(l.qty * l.unit_price, 2) end
       ), 0) as net_amount,
       coalesce(sum(
         case when r.prices_include_vat
              then round(l.qty * l.unit_price - l.qty * l.unit_price / (1 + l.vat_rate / 100), 2)
              else round(l.qty * l.unit_price * l.vat_rate / 100, 2) end
       ), 0) as vat_amount,
       coalesce(sum(
         case when r.prices_include_vat
              then round(l.qty * l.unit_price, 2)
              else round(l.qty * l.unit_price * (1 + l.vat_rate / 100), 2) end
       ), 0) as gross_amount,
       count(l.id) filter (where l.kind = 'goods')::int   as goods_lines,
       count(l.id) filter (where l.kind = 'service')::int as service_lines
from receipts r
left join receipt_lines l on l.receipt_id = r.id
group by r.id;

-- Кредиторка тепер має три джерела: приймання за заявками, надходження без
-- заявки та операційні витрати. Витрати, породжені надходженням, у сумі не
-- подвоюються — вони й є той самий рядок послуги.
drop view if exists v_supplier_balance;
create view v_supplier_balance as
with received as (
  select p.legal_entity_id, p.supplier_id, sum(a.received_gross) as amount
  from purchase_orders p
  join v_po_amounts a on a.po_id = p.id
  where p.status <> 'cancelled'
  group by p.legal_entity_id, p.supplier_id
),
receipted as (
  select r.legal_entity_id, r.supplier_id,
         sum(a.gross_amount) filter (where a.goods_lines > 0) as amount
  from receipts r
  join lateral (
    select coalesce(sum(
             case when r.prices_include_vat
                  then round(l.qty * l.unit_price, 2)
                  else round(l.qty * l.unit_price * (1 + l.vat_rate / 100), 2) end
           ), 0) as gross_amount,
           count(*) filter (where l.kind = 'goods')::int as goods_lines
      from receipt_lines l
     where l.receipt_id = r.id and l.kind = 'goods'
  ) a on true
  where r.status = 'posted'
  group by r.legal_entity_id, r.supplier_id
),
billed as (
  select legal_entity_id, supplier_id, sum(amount_net + vat_amount) as amount
  from expenses where supplier_id is not null
  group by legal_entity_id, supplier_id
),
returned as (
  select legal_entity_id, supplier_id, sum(gross_amount) as amount
  from v_supplier_return_amounts
  group by legal_entity_id, supplier_id
),
paid as (
  select legal_entity_id, supplier_id, sum(amount) as amount
  from supplier_payments group by legal_entity_id, supplier_id
),
keys as (
  select legal_entity_id, supplier_id from received
  union select legal_entity_id, supplier_id from receipted
  union select legal_entity_id, supplier_id from billed
  union select legal_entity_id, supplier_id from returned
  union select legal_entity_id, supplier_id from paid
)
select k.legal_entity_id,
       k.supplier_id,
       coalesce(r.amount, 0) + coalesce(rc.amount, 0) + coalesce(b.amount, 0) as billed_gross,
       coalesce(rt.amount, 0)                                                 as returned_gross,
       coalesce(p.amount, 0)                                                  as paid_amount,
       coalesce(r.amount, 0) + coalesce(rc.amount, 0) + coalesce(b.amount, 0)
         - coalesce(rt.amount, 0) - coalesce(p.amount, 0)                     as balance_due
from keys k
left join received  r  on r.legal_entity_id  = k.legal_entity_id and r.supplier_id  = k.supplier_id
left join receipted rc on rc.legal_entity_id = k.legal_entity_id and rc.supplier_id = k.supplier_id
left join billed    b  on b.legal_entity_id  = k.legal_entity_id and b.supplier_id  = k.supplier_id
left join returned  rt on rt.legal_entity_id = k.legal_entity_id and rt.supplier_id = k.supplier_id
left join paid      p  on p.legal_entity_id  = k.legal_entity_id and p.supplier_id  = k.supplier_id;
