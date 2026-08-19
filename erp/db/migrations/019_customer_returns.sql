-- Повернення від клієнта. Найскладніший документ у продажах: одночасно чіпає
-- склад, дохід, ПДВ і фінрезультат, причому в кожному — по-своєму.

-- Вирахування з доходу. Повернення не є витратою: воно зменшує дохід. Якби
-- ставили у витрати, виручка лишалася б завищеною, а маржа — неправдивою.
insert into chart_of_accounts (code, name, kind) values
  ('704', 'Вирахування з доходу', 'income')
on conflict (code) do nothing;

-- Новий тип руху: повернення на склад. Окремо від 'adjustment', бо це не
-- виправлення помилки, а господарська операція з документом і контрагентом.
alter table stock_moves drop constraint if exists stock_moves_move_type_check;
alter table stock_moves add constraint stock_moves_move_type_check check (move_type in (
  'opening','purchase_receipt','production_consume','production_output',
  'sale_shipment','sale_return','write_off','adjustment','transfer_in','transfer_out'));

create table if not exists customer_returns (
  id              uuid primary key default gen_random_uuid(),
  number          text not null unique,
  legal_entity_id uuid not null references legal_entities(id),
  customer_id     uuid not null references customers(id),
  -- Обидва посилання необов'язкові: клієнт не завжди пам'ятає, за якою саме
  -- накладною привезли товар, а повернення від цього нікуди не дінеться.
  so_id           uuid references sales_orders(id),
  shipment_id     uuid references shipments(id),
  returned_on     date not null default current_date,
  reason          text not null default 'surplus'
                    check (reason in ('surplus','quality','expiry','other')),
  status          text not null default 'draft'
                    check (status in ('draft','accepted','cancelled')),
  note            text,
  created_by      uuid references app_users(id),
  created_at      timestamptz not null default now()
);
create index if not exists customer_returns_entity_idx on customer_returns (legal_entity_id, returned_on desc);
create index if not exists customer_returns_shipment_idx on customer_returns (shipment_id);

create table if not exists customer_return_lines (
  id               uuid primary key default gen_random_uuid(),
  return_id        uuid not null references customer_returns(id) on delete cascade,
  item_id          uuid not null references items(id),
  -- Рядок відвантаження, якщо повернення прив'язане: за ним беремо і ціну,
  -- і собівартість, з якою товар пішов.
  shipment_line_id uuid references shipment_lines(id),
  batch_id         uuid references batches(id),
  qty              numeric(14,3) not null check (qty > 0),
  unit_price       numeric(14,4) not null default 0,   -- ціна продажу без ПДВ
  vat_rate         numeric(5,2)  not null default 20,
  unit_cost        numeric(14,4) not null default 0,   -- собівартість повернення
  -- Брак і прострочене на склад не повертаються: їхня вартість іде у втрати,
  -- а не назад у запаси. Інакше баланс показував би товар, якого немає.
  to_stock         boolean not null default true
);
create index if not exists customer_return_lines_ret_idx on customer_return_lines (return_id);

-- Розрахунок коригування — окремий вид документа в тій самій таблиці, що й
-- податкова накладна: у ЄРПН вони живуть поруч і нумеруються разом.
alter table tax_invoices add column if not exists kind text not null default 'invoice'
  check (kind in ('invoice','adjustment'));
alter table tax_invoices add column if not exists parent_invoice_id uuid references tax_invoices(id);
alter table tax_invoices add column if not exists return_id uuid references customer_returns(id);
-- Хто подає документ до ЄРПН. При зменшенні суми компенсації РК реєструє
-- покупець, а не продавець — і пропущений покупцем РК це його клопіт,
-- та все одно наш податковий кредит.
alter table tax_invoices add column if not exists registered_by text not null default 'seller'
  check (registered_by in ('seller','buyer'));

create unique index if not exists tax_invoices_return_key on tax_invoices (return_id)
  where return_id is not null;

-- В'юха розгорнула `t.*` на момент створення, тому нових колонок у ній немає.
-- Перестворюємо, інакше екран ПДВ не побачить ні виду документа, ні того,
-- хто його реєструє.
drop view if exists v_tax_invoice_status;

create view v_tax_invoice_status as
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

-- Суми повернення однією вибіркою — потрібні і в проводках, і в P&L, і на екрані.
create or replace view v_return_amounts as
select r.id as return_id,
       r.legal_entity_id,
       r.returned_on,
       coalesce(sum(l.qty * l.unit_price), 0)                                as net_amount,
       coalesce(sum(l.qty * l.unit_price * l.vat_rate / 100), 0)             as vat_amount,
       coalesce(sum(l.qty * l.unit_price * (1 + l.vat_rate / 100)), 0)       as gross_amount,
       coalesce(sum(l.qty * l.unit_cost) filter (where l.to_stock), 0)       as cost_returned,
       coalesce(sum(l.qty * l.unit_cost) filter (where not l.to_stock), 0)   as cost_lost
from customer_returns r
left join customer_return_lines l on l.return_id = r.id
where r.status = 'accepted'
group by r.id, r.legal_entity_id, r.returned_on;

-- Скільки з рядка відвантаження вже повернуто — щоб не прийняти більше, ніж везли.
create or replace view v_shipment_line_returned as
select l.shipment_line_id, sum(l.qty) as returned_qty
from customer_return_lines l
join customer_returns r on r.id = l.return_id
where l.shipment_line_id is not null and r.status = 'accepted'
group by l.shipment_line_id;

-- P&L з урахуванням повернень: дохід зменшується, собівартість повернутого
-- товару знімається із собівартості реалізації.
--
-- Вартість непридатного товару теж виходить із собівартості реалізації, але
-- лишається у витратах — просто окремим рядком втрат. Це перекласифікація, а
-- не додаткова втрата: товар уже був проданий, його вартість уже визнана. Якби
-- дописували її поверх собівартості, збиток рахувався б двічі — і саме на цю
-- суму результат у звіті розійшовся б із рахунком 791.
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

-- Дебіторка з урахуванням повернень: повернений товар зменшує борг клієнта.
-- Перелік колонок змінюється, тож в'юху доводиться перестворювати.
drop view if exists v_customer_balance;

create view v_customer_balance as
select c.id as customer_id,
       c.name,
       c.kind,
       c.credit_limit,
       coalesce(sh.shipped_amount, 0)                               as shipped_amount,
       coalesce(rt.returned_amount, 0)                              as returned_amount,
       coalesce(pa.paid_amount, 0)                                  as paid_amount,
       coalesce(sh.shipped_amount, 0) - coalesce(rt.returned_amount, 0)
         - coalesce(pa.paid_amount, 0)                              as balance_due
from customers c
left join (
  select o.customer_id, sum(t.shipped_amount) as shipped_amount
  from sales_orders o join v_so_totals t on t.so_id = o.id
  where o.status <> 'cancelled'
  group by o.customer_id
) sh on sh.customer_id = c.id
left join (
  select r.customer_id, sum(a.gross_amount) as returned_amount
  from customer_returns r join v_return_amounts a on a.return_id = r.id
  group by r.customer_id
) rt on rt.customer_id = c.id
left join (
  select customer_id, sum(amount) as paid_amount from payments group by customer_id
) pa on pa.customer_id = c.id;
