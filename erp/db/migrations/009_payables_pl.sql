-- 009_payables_pl.sql — кредиторка й операційні витрати для фінансового результату.
--
-- Правило, яке тут закріплюється:
--   продаж    → дохід без ПДВ, дебіторка з ПДВ
--   закупівля → витрати й собівартість без ПДВ, кредиторка з ПДВ
--   ПДВ       → окремим реєстром, у фінансовий результат не потрапляє взагалі
--
-- Для неплатника ПДВ «без ПДВ» дорівнює повній ціні — податок для нього не
-- відшкодовується і є звичайною витратою.

create table if not exists supplier_payments (
  id              uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references legal_entities(id),
  supplier_id     uuid not null references suppliers(id),
  po_id           uuid references purchase_orders(id),
  paid_on         date not null default current_date,
  amount          numeric(14,2) not null check (amount <> 0),
  method          text not null default 'bank' check (method in ('bank','cash','other')),
  note            text,
  created_by      uuid references app_users(id),
  created_at      timestamptz not null default now()
);
create index if not exists supplier_payments_idx on supplier_payments (legal_entity_id, supplier_id, paid_on desc);

-- Операційні витрати, що не проходять через склад: оренда, зарплата, реклама.
-- У P&L беруться без ПДВ, у кредиторку — з ПДВ.
create table if not exists expenses (
  id              uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references legal_entities(id),
  category        text not null check (category in
                    ('rent','salary','utilities','logistics','marketing','bank','services','other')),
  spent_on        date not null default current_date,
  description     text,
  amount_net      numeric(14,2) not null check (amount_net >= 0),
  vat_amount      numeric(14,2) not null default 0 check (vat_amount >= 0),
  supplier_id     uuid references suppliers(id),
  created_by      uuid references app_users(id),
  created_at      timestamptz not null default now()
);
create index if not exists expenses_period_idx on expenses (legal_entity_id, spent_on desc);

-- Суми заявки постачальнику в трьох вимірах одразу. Ціна в рядку зберігається
-- так, як її ввели, тож розкладаємо її тут, а не в кожному запиті окремо.
create or replace view v_po_amounts as
with lines as (
  select p.id as po_id,
         l.qty,
         l.received_qty,
         l.unit_price,
         p.prices_include_vat,
         case when s.is_vat_payer then l.vat_rate else 0 end as eff_rate
  from purchase_orders p
  join suppliers s on s.id = p.supplier_id
  join purchase_order_lines l on l.po_id = p.id
)
select po_id,
       sum(qty * case when prices_include_vat
                      then unit_price / (1 + eff_rate / 100)
                      else unit_price end)                       as net_amount,
       sum(qty * case when prices_include_vat
                      then unit_price
                      else unit_price * (1 + eff_rate / 100) end) as gross_amount,
       sum(received_qty * case when prices_include_vat
                               then unit_price / (1 + eff_rate / 100)
                               else unit_price end)               as received_net,
       sum(received_qty * case when prices_include_vat
                               then unit_price
                               else unit_price * (1 + eff_rate / 100) end) as received_gross
from lines
group by po_id;

-- Кредиторка: скільки оприбутковано з ПДВ мінус скільки заплачено.
-- Витрати з прив'язаним постачальником теж створюють борг.
create or replace view v_supplier_balance as
with received as (
  select p.legal_entity_id, p.supplier_id, sum(a.received_gross) as amount
  from purchase_orders p
  join v_po_amounts a on a.po_id = p.id
  where p.status <> 'cancelled'
  group by p.legal_entity_id, p.supplier_id
),
billed as (
  select legal_entity_id, supplier_id, sum(amount_net + vat_amount) as amount
  from expenses where supplier_id is not null
  group by legal_entity_id, supplier_id
),
paid as (
  select legal_entity_id, supplier_id, sum(amount) as amount
  from supplier_payments group by legal_entity_id, supplier_id
),
keys as (
  select legal_entity_id, supplier_id from received
  union select legal_entity_id, supplier_id from billed
  union select legal_entity_id, supplier_id from paid
)
select k.legal_entity_id,
       k.supplier_id,
       coalesce(r.amount, 0) + coalesce(b.amount, 0)                            as billed_gross,
       coalesce(p.amount, 0)                                                    as paid_amount,
       coalesce(r.amount, 0) + coalesce(b.amount, 0) - coalesce(p.amount, 0)    as balance_due
from keys k
left join received r on r.legal_entity_id = k.legal_entity_id and r.supplier_id = k.supplier_id
left join billed   b on b.legal_entity_id = k.legal_entity_id and b.supplier_id = k.supplier_id
left join paid     p on p.legal_entity_id = k.legal_entity_id and p.supplier_id = k.supplier_id;

-- Дебіторка в розрізі юрособи: та сама мережа може бути винна різним ТОВ по-різному.
create or replace view v_customer_balance_by_entity as
with shipped as (
  select o.legal_entity_id, o.customer_id, sum(t.shipped_amount) as amount
  from sales_orders o
  join v_so_totals t on t.so_id = o.id
  where o.status <> 'cancelled'
  group by o.legal_entity_id, o.customer_id
),
paid as (
  select legal_entity_id, customer_id, sum(amount) as amount
  from payments group by legal_entity_id, customer_id
),
keys as (
  select legal_entity_id, customer_id from shipped
  union select legal_entity_id, customer_id from paid
)
select k.legal_entity_id,
       k.customer_id,
       coalesce(s.amount, 0)                        as shipped_gross,
       coalesce(p.amount, 0)                        as paid_amount,
       coalesce(s.amount, 0) - coalesce(p.amount, 0) as balance_due
from keys k
left join shipped s on s.legal_entity_id = k.legal_entity_id and s.customer_id = k.customer_id
left join paid    p on p.legal_entity_id = k.legal_entity_id and p.customer_id = k.customer_id;

-- Помісячний фінансовий результат. Дохід — без ПДВ, собівартість — без ПДВ,
-- ПДВ сюди не входить у жодному вигляді.
create or replace view v_pl_monthly as
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
opex as (
  select legal_entity_id,
         date_trunc('month', spent_on)::date as period,
         sum(amount_net)                     as opex
  from expenses group by legal_entity_id, date_trunc('month', spent_on)
),
keys as (
  select legal_entity_id, period from revenue
  union select legal_entity_id, period from cogs
  union select legal_entity_id, period from losses
  union select legal_entity_id, period from opex
)
select k.legal_entity_id,
       k.period,
       coalesce(r.revenue_net, 0)                          as revenue_net,
       coalesce(c.cogs, 0)                                 as cogs,
       coalesce(r.revenue_net, 0) - coalesce(c.cogs, 0)    as gross_profit,
       coalesce(l.write_offs, 0)                           as write_offs,
       coalesce(o.opex, 0)                                 as opex,
       coalesce(r.revenue_net, 0) - coalesce(c.cogs, 0)
         - coalesce(l.write_offs, 0) - coalesce(o.opex, 0) as net_result
from keys k
left join revenue r on r.legal_entity_id = k.legal_entity_id and r.period = k.period
left join cogs c    on c.legal_entity_id = k.legal_entity_id and c.period = k.period
left join losses l  on l.legal_entity_id = k.legal_entity_id and l.period = k.period
left join opex o    on o.legal_entity_id = k.legal_entity_id and o.period = k.period;
