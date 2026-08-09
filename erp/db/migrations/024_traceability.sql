-- Простежуваність партій і відкликання продукту.
--
-- Закон вимагає від оператора ринку харчових продуктів простежуваності
-- «крок назад — крок вперед». Дані для цього вже є в журналі рухів: партія,
-- документ і тип руху. Бракувало лише зв'язку через варку — саме вона
-- перетворює партії сировини на партію готової продукції.

-- Ребро «спожито → випущено»: усе, що варка списала, породило те, що вона
-- випустила. Через цю в'юху ланцюжок проходить і кілька рівнів, якщо між
-- сировиною й готовою продукцією є напівфабрикат.
create or replace view v_batch_edges as
select distinct
       cons.batch_id  as source_batch_id,
       outp.batch_id  as result_batch_id,
       cons.doc_id    as production_order_id
from stock_moves cons
join stock_moves outp
  on outp.doc_id = cons.doc_id
 and outp.doc_type = 'production_order'
 and outp.move_type = 'production_output'
where cons.doc_type = 'production_order'
  and cons.move_type = 'production_consume'
  and cons.batch_id is not null
  and outp.batch_id is not null;

-- Звідки партія взялася: прихід від постачальника або власна варка.
create or replace view v_batch_origin as
select b.id as batch_id,
       b.item_id,
       b.code,
       b.source,
       po.id       as purchase_order_id,
       po.number   as purchase_number,
       s.name      as supplier_name,
       s.edrpou    as supplier_edrpou,
       pr.id       as production_order_id,
       pr.number   as production_number
from batches b
left join lateral (
  select m.doc_id from stock_moves m
   where m.batch_id = b.id and m.move_type = 'purchase_receipt'
     and m.doc_type = 'purchase_order'
   limit 1
) rec on true
left join purchase_orders po on po.id = rec.doc_id
left join suppliers s on s.id = po.supplier_id
left join lateral (
  select m.doc_id from stock_moves m
   where m.batch_id = b.id and m.move_type = 'production_output'
   limit 1
) made on true
left join production_orders pr on pr.id = made.doc_id;

-- Куди партія поїхала: відвантаження, клієнт, кількість.
create or replace view v_batch_shipments as
select m.batch_id,
       sh.id        as shipment_id,
       sh.number    as shipment_number,
       sh.shipped_on,
       o.legal_entity_id,
       c.id         as customer_id,
       c.name       as customer_name,
       c.phone      as customer_phone,
       m.item_id,
       sum(-m.qty)  as qty
from stock_moves m
join shipments sh on sh.id = m.doc_id and m.doc_type = 'shipment'
join sales_orders o on o.id = sh.so_id
join customers c on c.id = o.customer_id
where m.move_type = 'sale_shipment'
group by m.batch_id, sh.id, sh.number, sh.shipped_on, o.legal_entity_id,
         c.id, c.name, c.phone, m.item_id;

-- ─── Відкликання ────────────────────────────────────────────────────────────
-- Документ перетворює результат простежуваності на чек-лист: кого повідомили,
-- скільки повернули. Без нього відкликання живе в голові й у месенджері.

create table if not exists recalls (
  id              uuid primary key default gen_random_uuid(),
  number          text not null unique,
  legal_entity_id uuid not null references legal_entities(id),
  batch_id        uuid not null references batches(id),
  reason          text not null default 'quality'
                    check (reason in ('quality','contamination','labeling','expiry','other')),
  declared_on     date not null default current_date,
  status          text not null default 'draft'
                    check (status in ('draft','announced','closed','cancelled')),
  note            text,
  created_by      uuid references app_users(id),
  created_at      timestamptz not null default now()
);
create index if not exists recalls_entity_idx on recalls (legal_entity_id, declared_on desc);

create table if not exists recall_lines (
  id            uuid primary key default gen_random_uuid(),
  recall_id     uuid not null references recalls(id) on delete cascade,
  shipment_id   uuid references shipments(id),
  customer_id   uuid not null references customers(id),
  item_id       uuid not null references items(id),
  batch_id      uuid not null references batches(id),
  shipped_qty   numeric(14,3) not null default 0,
  recovered_qty numeric(14,3) not null default 0,
  notified_at   timestamptz,
  note          text
);
-- Одне відвантаження партії потрапляє в одне відкликання один раз: інакше
-- у чек-листі з'явилися б дублі, а кількість до вилучення подвоїлась би.
create unique index if not exists recall_lines_key
  on recall_lines (recall_id, shipment_id, item_id, batch_id);

create or replace view v_recall_progress as
select r.id as recall_id,
       count(l.id)::int                                        as lines,
       count(l.notified_at)::int                               as notified,
       coalesce(sum(l.shipped_qty), 0)                          as shipped_qty,
       coalesce(sum(l.recovered_qty), 0)                        as recovered_qty
from recalls r
left join recall_lines l on l.recall_id = r.id
group by r.id;
