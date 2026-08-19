-- 014_overhead_capacity.sql — розподіл загальновиробничих витрат за нормальною потужністю.
--
-- НП(С)БО 16 вимагає розділяти ЗВВ і поводитися з ними по-різному:
--   змінні   — розподіляються на випуск за фактичною потужністю періоду;
--   постійні — за НОРМАЛЬНОЮ потужністю, а нерозподілений залишок іде прямо
--              в собівартість реалізації того ж періоду.
--
-- Сенс правила: у місяць простою собівартість одиниці не має роздуватися.
-- Недозавантаження — це збиток періоду, а не вартість продукту.
--
-- Правило застосовується ЛИШЕ до бухгалтерської книги. Управлінська як і раніше
-- визнає весь цех витратами періоду — це третє джерело розбіжності між обліками.

alter table legal_entities add column if not exists overhead_allocation_base text not null default 'weight'
  check (overhead_allocation_base in ('quantity', 'weight'));

-- Ознака поведінки витрати. Погодинна оплата й енергія ростуть із випуском,
-- оренда й амортизація — ні.
alter table expenses     add column if not exists cost_behavior text not null default 'fixed'
  check (cost_behavior in ('variable', 'fixed'));
alter table employees    add column if not exists cost_behavior text not null default 'variable'
  check (cost_behavior in ('variable', 'fixed'));
alter table fixed_assets add column if not exists cost_behavior text not null default 'fixed'
  check (cost_behavior in ('variable', 'fixed'));

update expenses set cost_behavior = 'variable' where category = 'production_energy';

-- Нормальна потужність переглядається час від часу, тож зберігаємо історією,
-- а не одним числом: розподіл минулих періодів не має мінятися заднім числом.
create table if not exists normal_capacity (
  id              uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references legal_entities(id),
  valid_from      date not null,
  capacity        numeric(14,3) not null check (capacity > 0),
  note            text,
  created_at      timestamptz not null default now(),
  unique (legal_entity_id, valid_from)
);

-- Фактична база випуску за місяць: і в штуках, і у вазі — щоб можна було
-- перемкнути базу розподілу, не переписуючи запити.
create or replace view v_output_base_monthly as
select po.legal_entity_id,
       date_trunc('month', po.finished_at)::date        as period,
       sum(po.produced_qty)                             as quantity,
       sum(po.produced_qty * coalesce(i.weight_g, 0)) / 1000 as weight_kg
from production_orders po
join items i on i.id = po.product_item_id
where po.status = 'done' and po.finished_at is not null
group by po.legal_entity_id, date_trunc('month', po.finished_at);
