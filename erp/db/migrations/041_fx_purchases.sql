-- 041_fx_purchases.sql — валютні закупівлі й курсові різниці.
--
-- Заявка постачальнику може бути в валюті: ціни рядків — у валюті документа,
-- курс фіксується в шапці, а в облік (собівартість, кредиторка) все лягає
-- в гривні за цим курсом. Курсова різниця на дату оплати записується
-- витратою за окремою статтею — додатною чи від'ємною.

alter table purchase_orders add column if not exists currency text not null default 'UAH'
  check (currency in ('UAH','USD','EUR','PLN'));
alter table purchase_orders add column if not exists fx_rate numeric(12,6) not null default 1
  check (fx_rate > 0);

-- Стаття «Курсові різниці»: єдина з дозволеним мінусом — зміцнення гривні
-- зменшує витрати, і це нормальна, а не помилкова, ситуація.
alter table expenses drop constraint if exists expenses_category_check;
alter table expenses add constraint expenses_category_check check (category in (
  'rent','salary','utilities','logistics','marketing','bank','services','other',
  'production_salary','production_energy','spoilage','fx'
));
alter table expenses drop constraint if exists expenses_amount_net_check;
alter table expenses add constraint expenses_amount_net_check
  check (amount_net >= 0 or category = 'fx');

-- Рахунок операційної курсової різниці.
insert into chart_of_accounts (code, name, kind)
values ('945', 'Втрати від операційної курсової різниці', 'expense')
on conflict (code) do nothing;

-- Суми заявки — тепер у гривнях незалежно від валюти документа: усі
-- споживачі view (кредиторка, журнали, звіти) далі працюють без змін.
create or replace view v_po_amounts as
with lines as (
  select p.id as po_id,
         l.qty,
         l.received_qty,
         l.unit_price * p.fx_rate as unit_price,
         p.prices_include_vat,
         case when s.is_vat_payer then l.vat_rate else 0::numeric end as eff_rate
    from purchase_orders p
    join suppliers s on s.id = p.supplier_id
    join purchase_order_lines l on l.po_id = p.id
)
select po_id,
       sum(qty * case when prices_include_vat then unit_price / (1 + eff_rate / 100)
                 else unit_price end)                                   as net_amount,
       sum(qty * case when prices_include_vat then unit_price
                 else unit_price * (1 + eff_rate / 100) end)            as gross_amount,
       sum(received_qty * case when prices_include_vat then unit_price / (1 + eff_rate / 100)
                          else unit_price end)                          as received_net,
       sum(received_qty * case when prices_include_vat then unit_price
                          else unit_price * (1 + eff_rate / 100) end)   as received_gross
  from lines
 group by po_id;

-- Журнальні суми теж переводимо в гривні.
create or replace view v_po_totals as
select p.id as po_id,
       coalesce(sum(l.qty * l.unit_price * p.fx_rate), 0)          as total_amount,
       coalesce(sum(l.received_qty * l.unit_price * p.fx_rate), 0) as received_amount,
       coalesce(sum(l.qty), 0)                                     as total_qty,
       coalesce(sum(l.received_qty), 0)                            as received_qty
  from purchase_orders p
  left join purchase_order_lines l on l.po_id = p.id
 group by p.id;
