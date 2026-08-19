-- 033_service_items.sql — послуги як номенклатура.
--
-- Досі послуга в надходженні була вільним текстом: опис руками, стаття
-- витрат щоразу заново. Для разових витрат це нормально, але оренда, доставка
-- чи бухгалтерський супровід повторюються щомісяця — і кожен раз їх вводили
-- наново, а в аналітиці вони зливалися в одну статтю без розрізу «скільки
-- саме на цю послугу».
--
-- Тепер послугу можна завести карткою в номенклатурі: стаття витрат,
-- поведінка (постійна/змінна) і ставка ПДВ задаються один раз, а документ
-- надходження бере їх звідти. На склад послуга, як і раніше, не потрапляє —
-- тип 'service' існує лише для довідника й аналітики витрат.

alter table items drop constraint if exists items_kind_check;
alter table items add constraint items_kind_check
  check (kind in ('raw', 'packaging', 'semi', 'finished', 'service'));

-- Стаття витрат — куди ляже сума при проведенні надходження. Для складських
-- типів вона не має сенсу й лишається порожньою.
alter table items add column if not exists expense_category text;
alter table items add column if not exists cost_behavior text not null default 'fixed'
  check (cost_behavior in ('fixed', 'variable'));

-- Послуга без статті витрат при проведенні не знала б, куди лягати.
alter table items add constraint items_service_category_check
  check (kind <> 'service' or expense_category is not null);

-- Зв'язок витрати з карткою послуги. Саме він дає звіт «скільки за період
-- витрачено на кожну конкретну послугу» — стаття витрат для цього занадто
-- груба: в «Логістиці» живуть і Нова Пошта, і фрахт, і кур'єр.
alter table expenses add column if not exists item_id uuid references items(id);
create index if not exists expenses_item_idx on expenses (item_id) where item_id is not null;
