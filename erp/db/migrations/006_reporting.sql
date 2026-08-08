-- 006_reporting.sql — резерв, доступний залишок, маржа, борги клієнтів

-- Зарезервовано під підтверджені, але ще не відвантажені замовлення.
create or replace view v_reserved as
select l.item_id, sum(l.qty - l.shipped_qty) as reserved_qty
from sales_order_lines l
join sales_orders o on o.id = l.so_id
where o.status = 'confirmed' and l.qty > l.shipped_qty
group by l.item_id;

-- Те, що менеджер реально може продати: залишок мінус резерв.
create or replace view v_item_available as
select s.item_id,
       s.sku,
       s.name,
       s.kind,
       s.unit,
       s.qty,
       s.avg_cost,
       coalesce(r.reserved_qty, 0)         as reserved_qty,
       s.qty - coalesce(r.reserved_qty, 0) as available_qty
from v_item_stock s
left join v_reserved r on r.item_id = s.item_id;

create or replace view v_so_totals as
select o.id as so_id,
       coalesce(sum(l.qty * l.unit_price), 0)         as total_amount,
       coalesce(sum(l.shipped_qty * l.unit_price), 0) as shipped_amount,
       coalesce(sum(l.qty), 0)                        as total_qty,
       coalesce(sum(l.shipped_qty), 0)                as shipped_qty
from sales_orders o
left join sales_order_lines l on l.so_id = o.id
group by o.id;

-- Собівартість відвантаженого: беремо з журналу рухів, тобто з фактичних партій.
create or replace view v_so_cogs as
select s.so_id, sum(-m.qty * m.unit_cost) as cogs
from stock_moves m
join shipments s on s.id = m.doc_id and m.doc_type = 'shipment'
where m.move_type = 'sale_shipment'
group by s.so_id;

create or replace view v_so_paid as
select so_id, sum(amount) as paid_amount
from payments
where so_id is not null
group by so_id;

-- Повна картка замовлення: сума, відвантажено, собівартість, маржа, оплата, борг.
create or replace view v_sales_orders_full as
select o.id,
       o.number,
       o.status,
       o.ordered_on,
       o.ship_by,
       o.customer_id,
       c.name  as customer_name,
       c.kind  as customer_kind,
       c.payment_terms_days,
       t.total_amount,
       t.shipped_amount,
       t.total_qty,
       t.shipped_qty,
       coalesce(g.cogs, 0)                              as cogs,
       t.shipped_amount - coalesce(g.cogs, 0)           as margin,
       case when t.shipped_amount > 0
            then round((t.shipped_amount - coalesce(g.cogs, 0)) / t.shipped_amount * 100, 1)
            else 0 end                                  as margin_pct,
       coalesce(p.paid_amount, 0)                       as paid_amount,
       t.shipped_amount - coalesce(p.paid_amount, 0)    as balance_due,
       case when o.status = 'shipped' and c.payment_terms_days >= 0
            then (select max(s.shipped_on) from shipments s where s.so_id = o.id) + c.payment_terms_days
            else null end                               as due_date
from sales_orders o
join customers c    on c.id = o.customer_id
left join v_so_totals t on t.so_id = o.id
left join v_so_cogs g   on g.so_id = o.id
left join v_so_paid p   on p.so_id = o.id;

-- Борг клієнта: відвантажено всього мінус усі оплати (зокрема не прив'язані до замовлення).
create or replace view v_customer_balance as
select c.id as customer_id,
       c.name,
       c.kind,
       c.credit_limit,
       coalesce(sh.shipped_amount, 0)                          as shipped_amount,
       coalesce(pa.paid_amount, 0)                             as paid_amount,
       coalesce(sh.shipped_amount, 0) - coalesce(pa.paid_amount, 0) as balance_due
from customers c
left join (
  select o.customer_id, sum(t.shipped_amount) as shipped_amount
  from sales_orders o join v_so_totals t on t.so_id = o.id
  where o.status <> 'cancelled'
  group by o.customer_id
) sh on sh.customer_id = c.id
left join (
  select customer_id, sum(amount) as paid_amount from payments group by customer_id
) pa on pa.customer_id = c.id;

-- Маржа в розрізі SKU: скільки продали, за скільки, з якою собівартістю.
create or replace view v_item_sales_margin as
with sold as (
  select sl.shipment_id,
         sl.item_id,
         sum(sl.qty)                as qty,
         sum(sl.qty * l.unit_price) as revenue
  from shipment_lines sl
  join sales_order_lines l on l.id = sl.so_line_id
  group by sl.shipment_id, sl.item_id
),
cost as (
  select m.doc_id as shipment_id,
         m.item_id,
         sum(-m.qty * m.unit_cost) as cogs
  from stock_moves m
  where m.doc_type = 'shipment' and m.move_type = 'sale_shipment'
  group by m.doc_id, m.item_id
)
select i.id as item_id,
       i.sku,
       i.name,
       coalesce(sum(s.qty), 0)                                as sold_qty,
       coalesce(sum(s.revenue), 0)                            as revenue,
       coalesce(sum(c.cogs), 0)                               as cogs,
       coalesce(sum(s.revenue), 0) - coalesce(sum(c.cogs), 0) as margin
from items i
left join sold s on s.item_id = i.id
left join cost c on c.shipment_id = s.shipment_id and c.item_id = s.item_id
where i.kind = 'finished'
group by i.id, i.sku, i.name;
