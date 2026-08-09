-- Повернення постачальнику — дзеркало повернення від клієнта, але простіше:
-- доходу тут немає, є запаси, кредиторка й податковий кредит.

alter table stock_moves drop constraint if exists stock_moves_move_type_check;
alter table stock_moves add constraint stock_moves_move_type_check check (move_type in (
  'opening','purchase_receipt','production_consume','production_output',
  'sale_shipment','sale_return','purchase_return','write_off','adjustment',
  'transfer_in','transfer_out'));

create table if not exists supplier_returns (
  id              uuid primary key default gen_random_uuid(),
  number          text not null unique,
  legal_entity_id uuid not null references legal_entities(id),
  supplier_id     uuid not null references suppliers(id),
  -- Заявка необов'язкова: партію могли привезти давно, а брак виявитись зараз.
  po_id           uuid references purchase_orders(id),
  returned_on     date not null default current_date,
  reason          text not null default 'quality'
                    check (reason in ('quality','surplus','expiry','other')),
  status          text not null default 'draft'
                    check (status in ('draft','accepted','cancelled')),
  note            text,
  created_by      uuid references app_users(id),
  created_at      timestamptz not null default now()
);
create index if not exists supplier_returns_entity_idx on supplier_returns (legal_entity_id, returned_on desc);

create table if not exists supplier_return_lines (
  id          uuid primary key default gen_random_uuid(),
  return_id   uuid not null references supplier_returns(id) on delete cascade,
  item_id     uuid not null references items(id),
  po_line_id  uuid references purchase_order_lines(id),
  batch_id    uuid references batches(id),
  qty         numeric(14,3) not null check (qty > 0),
  -- Собівартість оприбуткування: у платника ПДВ це база без податку, у
  -- єдинника — повна ціна. Повертати треба рівно за нею, інакше повернення
  -- саме по собі створило б прибуток або збиток на складі.
  unit_cost   numeric(14,4) not null default 0,
  -- Податковий кредит, який доведеться зняти. У єдинника нуль: він його й не брав.
  unit_vat    numeric(14,4) not null default 0,
  vat_rate    numeric(5,2)  not null default 20
);
create index if not exists supplier_return_lines_ret_idx on supplier_return_lines (return_id);

create or replace view v_supplier_return_amounts as
select r.id as return_id,
       r.legal_entity_id,
       r.supplier_id,
       r.returned_on,
       coalesce(sum(l.qty * l.unit_cost), 0)                as net_amount,
       coalesce(sum(l.qty * l.unit_vat), 0)                 as vat_amount,
       coalesce(sum(l.qty * (l.unit_cost + l.unit_vat)), 0) as gross_amount
from supplier_returns r
left join supplier_return_lines l on l.return_id = r.id
where r.status = 'accepted'
group by r.id, r.legal_entity_id, r.supplier_id, r.returned_on;

-- Скільки з рядка заявки вже повернуто — щоб не віддати більше, ніж отримали.
create or replace view v_po_line_returned as
select l.po_line_id, sum(l.qty) as returned_qty
from supplier_return_lines l
join supplier_returns r on r.id = l.return_id
where l.po_line_id is not null and r.status = 'accepted'
group by l.po_line_id;

-- Кредиторка з урахуванням повернень: повернений товар зменшує наш борг.
-- Перелік колонок росте, тож в'юху доводиться перестворювати.
drop view if exists v_supplier_balance;

-- Якщо за нього вже заплатили, сальдо стане дебетовим — це аванс, який
-- постачальник має відпрацювати або віддати.
create view v_supplier_balance as
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
  union select legal_entity_id, supplier_id from billed
  union select legal_entity_id, supplier_id from returned
  union select legal_entity_id, supplier_id from paid
)
select k.legal_entity_id,
       k.supplier_id,
       coalesce(r.amount, 0) + coalesce(b.amount, 0)                          as billed_gross,
       coalesce(ret.amount, 0)                                                as returned_gross,
       coalesce(p.amount, 0)                                                  as paid_amount,
       coalesce(r.amount, 0) + coalesce(b.amount, 0) - coalesce(ret.amount, 0)
         - coalesce(p.amount, 0)                                              as balance_due
from keys k
left join received r  on r.legal_entity_id = k.legal_entity_id and r.supplier_id = k.supplier_id
left join billed   b  on b.legal_entity_id = k.legal_entity_id and b.supplier_id = k.supplier_id
left join returned ret on ret.legal_entity_id = k.legal_entity_id and ret.supplier_id = k.supplier_id
left join paid     p  on p.legal_entity_id = k.legal_entity_id and p.supplier_id = k.supplier_id;
