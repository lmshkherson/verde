-- 035_sales_channels.sql — єдине поле «канал продажу» і ціни по каналах.
--
-- «Тип клієнта» і «рівень цін» злиті в одне поняття: канал продажу.
-- VERDE продає шістьма каналами, і саме по них діляться ціни:
--
--   site            Сайт
--   small_wholesale Дрібний гурт
--   offices         Офіси
--   supermarkets    Супермаркети
--   distributors    Дистриб'ютори
--   private_label   Private Label
--
-- Ціна позиції тепер зберігається на канал (item_prices) — стільки цін,
-- скільки каналів, а не жорсткі три колонки. Старі колонки в items і
-- kind/price_level у customers лишаються як історія, але код їх більше
-- не читає й не пише.

alter table customers add column if not exists channel text;

-- Бекфіл із рівня цін — він і був фактичною комерційною умовою.
update customers set channel = case price_level
  when 'rrp'     then 'site'
  when 'network' then 'supermarkets'
  else 'distributors'
end
where channel is null;

alter table customers alter column channel set not null;
alter table customers add constraint customers_channel_check
  check (channel in ('site','small_wholesale','offices','supermarkets','distributors','private_label'));

-- Старі колонки більше не заповнюються — дефолти, щоб insert без них проходив.
alter table customers alter column kind set default 'retail';
alter table customers alter column price_level set default 'distributor';

-- Ціни по каналах. Немає рядка — каналу не задано ціну, і замовлення чесно
-- попросить її вказати, а не мовчки підставить нуль.
create table if not exists item_prices (
  item_id uuid not null references items(id) on delete cascade,
  channel text not null
    check (channel in ('site','small_wholesale','offices','supermarkets','distributors','private_label')),
  price   numeric(14,2) not null check (price >= 0),
  primary key (item_id, channel)
);

-- Бекфіл зі старих трьох колонок: РРЦ — ціна сайту, мережа — супермаркети,
-- дистриб'ютор — дистриб'ютори.
insert into item_prices (item_id, channel, price)
select id, 'site', price_rrp from items where price_rrp is not null and price_rrp > 0
on conflict do nothing;
insert into item_prices (item_id, channel, price)
select id, 'supermarkets', price_network from items where price_network is not null and price_network > 0
on conflict do nothing;
insert into item_prices (item_id, channel, price)
select id, 'distributors', price_distributor from items where price_distributor is not null and price_distributor > 0
on conflict do nothing;
