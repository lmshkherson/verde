-- 034_recipe_versions.sql — техкарта з датою проведення.
--
-- Рецептура змінюється: замінили інгредієнт, скоригували норму. Стара
-- практика «редагуй чинну» знищує історію: варка минулого місяця виглядала б
-- звареною за сьогоднішньою картою. Тому версія техкарти стає документом:
--
--   чернетка   — редагується вільно, у виробництві не бере участі;
--   проведена  — зафіксована назавжди, має дату «діє з»; редагувати не можна,
--                можна лише створити нову версію на її основі.
--
-- Варка завжди посилається на конкретну версію (production_orders.recipe_id
-- так працював від початку), а нова варка бере версію, чинну на її дату:
-- остання проведена з effective_from не пізніше дати виробництва.

alter table recipes add column if not exists effective_from date;
alter table recipes add column if not exists approved_at timestamptz;
alter table recipes add column if not exists approved_by uuid references app_users(id);

-- Наявні рецептури вже беруть участь у виробництві — вважаємо їх проведеними
-- з дня створення, інакше після оновлення зупинилися б усі варки.
update recipes set effective_from = created_at::date, approved_at = created_at
 where approved_at is null;

alter table recipes add constraint recipes_approved_effective
  check (approved_at is null or effective_from is not null);

create index if not exists recipes_effective_idx
  on recipes (product_item_id, effective_from desc)
  where approved_at is not null;

-- Чинна версія кожного продукту станом на сьогодні.
create or replace view v_current_recipes as
select distinct on (product_item_id) *
  from recipes
 where approved_at is not null and is_active and effective_from <= current_date
 order by product_item_id, effective_from desc, version desc;

-- Специфікація етикетки застаріває, коли ЧИННА версія рецептури вже не та,
-- за якою її затверджували. Чернетка нової версії специфікацію не чіпає:
-- доки нову карту не провели, виробництво й етикетка живуть за старою.
create or replace view v_current_spec as
select s.*,
       r.version as current_recipe_version,
       (r.version is distinct from s.recipe_version) as recipe_changed
from product_specs s
left join lateral (
  select version from recipes
   where product_item_id = s.item_id and is_active
     and approved_at is not null and effective_from <= current_date
   order by effective_from desc, version desc
   limit 1
) r on true
where s.status = 'approved'
  and s.version = (
    select max(v.version) from product_specs v
     where v.item_id = s.item_id and v.status = 'approved'
  );
