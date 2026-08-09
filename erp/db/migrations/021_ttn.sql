-- Реквізити товарно-транспортної накладної (форма № 1-ТН, додаток 7 до Правил
-- перевезень вантажів автомобільним транспортом, наказ Мінтрансу № 363).
--
-- Поля живуть на відвантаженні, а не окремим документом: ТТН супроводжує саме
-- ту поїздку, якою поїхав товар, і одне відвантаження — це одна поїздка.

alter table warehouses add column if not exists address text;

-- Перевізник. Назва вже є текстом у shipments.carrier — додаємо код і адресу.
alter table shipments add column if not exists carrier_edrpou text;

-- Новий обов'язковий реквізит, що з'явився у формі з 26.07.2026 (зміни до
-- Правил № 363, наказ Мінрозвитку від 12.12.2025 № 1727). Це адреса
-- місцезнаходження перевізника або його підрозділу, де стоїть автомобіль.
-- Реквізит стосується не вантажу, а режиму праці й відпочинку водіїв: за ним
-- перевіряють право користуватися винятками для коротких рейсів.
alter table shipments add column if not exists carrier_storage_place text;

alter table shipments add column if not exists transport_kind  text;
alter table shipments add column if not exists vehicle_model   text;
alter table shipments add column if not exists vehicle_plate   text;
alter table shipments add column if not exists trailer_model   text;
alter table shipments add column if not exists trailer_plate   text;
alter table shipments add column if not exists driver_name     text;
alter table shipments add column if not exists freight_payer   text;
alter table shipments add column if not exists loading_point   text;
alter table shipments add column if not exists unloading_point text;

-- Маса й місця: система рахує їх із ваги одиниці та вкладення в шоубокс, але
-- фактичні цифри з ваг важливіші за розрахункові, тож їх можна перебити.
alter table shipments add column if not exists gross_weight_kg numeric(12,3);
alter table shipments add column if not exists places          int;

-- Розрахункові маса й кількість місць за номенклатурою відвантаження.
-- Маса нетто: вага одиниці × кількість. Місця: скільки вийшло шоубоксів.
create or replace view v_shipment_cargo as
select sl.shipment_id,
       sum(sl.qty * coalesce(i.weight_g, 0)) / 1000.0        as net_weight_kg,
       sum(case when coalesce(i.pcs_per_box, 0) > 0
                then ceil(sl.qty / i.pcs_per_box)
                else sl.qty end)                             as places,
       count(*)                                              as line_count
from shipment_lines sl
join items i on i.id = sl.item_id
group by sl.shipment_id;
