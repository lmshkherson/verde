-- Інвентаризація як документ.
--
-- Коригувати залишок рухом система вміла з першого дня, але від інвентаризації
-- вимагається інше: опис із зафіксованим обліковим зрізом, факт по кожній
-- позиції, порівняльна відомість і підписи комісії. Перевіряючий питає саме
-- опис, а не рух у журналі.

-- Надлишок при інвентаризації — це дохід, а не зменшення витрат.
insert into chart_of_accounts (code, name, kind) values
  ('719', 'Інші доходи від операційної діяльності', 'income')
on conflict (code) do nothing;

create table if not exists stocktakes (
  id              uuid primary key default gen_random_uuid(),
  number          text not null unique,
  legal_entity_id uuid not null references legal_entities(id),
  warehouse_id    uuid not null references warehouses(id),
  counted_on      date not null default current_date,
  status          text not null default 'draft'
                    check (status in ('draft','counting','completed','cancelled')),
  chairman        text,
  commission      text,
  responsible     text,   -- матеріально відповідальна особа
  note            text,
  created_by      uuid references app_users(id),
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);
create index if not exists stocktakes_entity_idx on stocktakes (legal_entity_id, counted_on desc);

create table if not exists stocktake_lines (
  id           uuid primary key default gen_random_uuid(),
  stocktake_id uuid not null references stocktakes(id) on delete cascade,
  item_id      uuid not null references items(id),
  batch_id     uuid references batches(id),
  -- Обліковий залишок на момент відкриття опису. Саме зріз, а не поточне
  -- значення: опис — це фотографія складу на дату, і вона не має пливти від
  -- рухів, що пройшли поки комісія рахує.
  book_qty     numeric(14,3) not null default 0,
  -- Порожньо означає «ще не рахували» — це не нуль. Нуль у описі є
  -- твердженням «на полиці порожньо», і плутати їх не можна.
  counted_qty  numeric(14,3),
  unit_cost    numeric(14,4) not null default 0,
  note         text
);
create unique index if not exists stocktake_lines_key
  on stocktake_lines (stocktake_id, item_id, coalesce(batch_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Розбіжності: те, заради чого складається порівняльна відомість.
create or replace view v_stocktake_lines as
select l.*,
       coalesce(l.counted_qty, 0) - l.book_qty                        as diff_qty,
       (coalesce(l.counted_qty, 0) - l.book_qty) * l.unit_cost        as diff_value,
       l.counted_qty is null                                          as not_counted
from stocktake_lines l;

create or replace view v_stocktake_summary as
select s.id as stocktake_id,
       count(l.id)::int                                                     as lines,
       count(l.id) filter (where l.counted_qty is not null)::int            as counted,
       count(l.id) filter (where l.counted_qty is not null
                             and abs(coalesce(l.counted_qty, 0) - l.book_qty) > 0.0005)::int as with_diff,
       coalesce(sum((coalesce(l.counted_qty, 0) - l.book_qty) * l.unit_cost)
                  filter (where l.counted_qty is not null
                            and coalesce(l.counted_qty, 0) > l.book_qty), 0) as surplus_value,
       coalesce(sum((l.book_qty - coalesce(l.counted_qty, 0)) * l.unit_cost)
                  filter (where l.counted_qty is not null
                            and coalesce(l.counted_qty, 0) < l.book_qty), 0) as shortage_value
from stocktakes s
left join stocktake_lines l on l.stocktake_id = s.id
group by s.id;
