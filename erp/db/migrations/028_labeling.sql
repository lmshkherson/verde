-- 028_labeling.sql — маркування: харчова цінність, алергени, специфікація.
--
-- Дані для етикетки вже є в системі: рецептура каже, скільки чого закладено,
-- а вихід варки — скільки продукту з цього вийшло. Бракувало лише поживного
-- складу сировини. Далі це арифметика, і робити її вручну в таблиці означає
-- перераховувати все заново після кожної зміни рецептури.
--
-- Обсяг обов'язкової інформації — ст. 6 ЗУ № 2639-VIII «Про інформацію для
-- споживачів щодо харчових продуктів». Коефіцієнти перерахунку енергетичної
-- цінності — з додатка до нього; вони ж у Регламенті (ЄС) № 1169/2011.

-- ─── Поживний склад сировини ────────────────────────────────────────────────
-- Усе на 100 г продукту, як і вимагає маркування. Порожнє поле означає
-- «даних немає» — і це не нуль: нуль жиру в олії був би брехнею на етикетці,
-- тому специфікація з порожніми полями не затверджується.
alter table items add column if not exists kcal_100      numeric(8,2);
alter table items add column if not exists protein_100   numeric(8,2);
alter table items add column if not exists fat_100       numeric(8,2);
alter table items add column if not exists fat_sat_100   numeric(8,2);
-- Вуглеводи включають багатоатомні спирти, але не харчові волокна — так само,
-- як у таблиці на етикетці.
alter table items add column if not exists carbs_100     numeric(8,2);
alter table items add column if not exists sugars_100    numeric(8,2);
alter table items add column if not exists polyols_100   numeric(8,2);
alter table items add column if not exists fiber_100     numeric(8,2);
alter table items add column if not exists salt_100      numeric(8,3);

-- Назва інгредієнта так, як вона має стояти у складі: «паста фінікова», а не
-- «Фініки Деглет Нур паста» з довідника закупівель.
alter table items add column if not exists label_name text;
-- Звідки взято поживні дані. Закон допускає і розрахунок за даними
-- постачальника, і лабораторний аналіз — але джерело треба знати.
alter table items add column if not exists nutrition_source text;
alter table items add column if not exists country_of_origin text;

-- ─── Алергени ───────────────────────────────────────────────────────────────
-- Перелік закритий: 14 груп із додатка до ЗУ № 2639-VIII. Саме тому це
-- довідник, а не вільний текст — «горішки» в примітці етикетку не рятують.
create table if not exists allergens (
  code       text primary key,
  name       text not null,
  sort_order int not null default 0
);

insert into allergens (code, name, sort_order) values
  ('gluten',      'Злаки, що містять глютен', 1),
  ('crustaceans', 'Ракоподібні', 2),
  ('eggs',        'Яйця', 3),
  ('fish',        'Риба', 4),
  ('peanuts',     'Арахіс', 5),
  ('soy',         'Соя', 6),
  ('milk',        'Молоко та молочні продукти (включно з лактозою)', 7),
  ('nuts',        'Горіхи', 8),
  ('celery',      'Селера', 9),
  ('mustard',     'Гірчиця', 10),
  ('sesame',      'Кунжут', 11),
  ('sulphites',   'Діоксид сірки та сульфіти (понад 10 мг/кг)', 12),
  ('lupin',       'Люпин', 13),
  ('molluscs',    'Молюски', 14)
on conflict (code) do nothing;

create table if not exists item_allergens (
  item_id      uuid not null references items(id) on delete cascade,
  allergen_code text not null references allergens(code),
  -- «Містить» іде у склад виділенням, «сліди» — окремим рядком нижче.
  -- Плутати їх не можна: перше є складом, друге — попередженням.
  kind         text not null default 'contains' check (kind in ('contains','traces')),
  note         text,
  primary key (item_id, allergen_code)
);

-- ─── Специфікація продукту ──────────────────────────────────────────────────
-- Затверджена специфікація заморожує розрахунок. Це не бюрократія: етикетку
-- друкують тиражем, і треба знати, за якою саме версією рецептури надрукована
-- та пачка, що зараз у мережі. Змінили рецептуру — специфікація застаріла,
-- і система це показує, а не мовчки перераховує колишні цифри.
create table if not exists product_specs (
  id                uuid primary key default gen_random_uuid(),
  item_id           uuid not null references items(id),
  recipe_id         uuid not null references recipes(id),
  recipe_version    int  not null,
  version           int  not null,
  status            text not null default 'approved'
                      check (status in ('approved','revoked')),
  net_weight_g      numeric(10,3),
  shelf_life_days   int,
  storage_text      text,
  composition_text  text not null,
  allergen_text     text,
  traces_text       text,
  -- Заморожені показники на 100 г і на порцію.
  nutrition         jsonb not null,
  producer_text     text,
  country           text,
  note              text,
  approved_on       date not null default current_date,
  approved_by       uuid references app_users(id),
  created_at        timestamptz not null default now(),
  unique (item_id, version)
);
create index if not exists product_specs_item_idx on product_specs (item_id, version desc);

-- Чинна специфікація по кожному продукту й ознака того, що рецептуру після
-- затвердження змінювали.
create or replace view v_current_spec as
select s.*,
       r.version as current_recipe_version,
       (r.version <> s.recipe_version) as recipe_changed
from product_specs s
join lateral (
  select max(version) as version from recipes
   where product_item_id = s.item_id and is_active
) r on true
where s.status = 'approved'
  and s.version = (
    select max(v.version) from product_specs v
     where v.item_id = s.item_id and v.status = 'approved'
  );
