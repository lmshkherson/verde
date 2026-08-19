-- Температурні режими. Для харчового виробництва це не примітка, а умова
-- перевезення: порушений режим означає зіпсований товар і претензію, а довести
-- дотримання можна лише документом.

-- Режим позиції: діапазон і словесне уточнення з етикетки.
alter table items add column if not exists temp_min_c numeric(5,1);
alter table items add column if not exists temp_max_c numeric(5,1);
alter table items add column if not exists temp_note  text;

-- Режим рейсу. Заповнюється при завантаженні: система підказує найвужчий
-- діапазон із позицій, але записує те, що реально погоджено з перевізником.
alter table shipments add column if not exists temp_mode         text;
alter table shipments add column if not exists body_type         text;
alter table shipments add column if not exists temp_at_loading   numeric(5,1);
alter table shipments add column if not exists temp_at_unloading numeric(5,1);

-- Найвужчий діапазон, який має витримати рейс: максимум із мінімумів і мінімум
-- із максимумів. Якщо вони перетнулись — у машині лежать позиції, які не можна
-- везти разом, і це видно ще до виїзду.
create or replace view v_shipment_temp as
select sl.shipment_id,
       max(i.temp_min_c)                                          as need_min_c,
       min(i.temp_max_c)                                          as need_max_c,
       count(*) filter (where i.temp_min_c is null
                          and i.temp_max_c is null)::int           as without_mode,
       count(*)::int                                              as line_count
from shipment_lines sl
join items i on i.id = sl.item_id
group by sl.shipment_id;
