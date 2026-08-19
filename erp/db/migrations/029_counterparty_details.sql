-- 029_counterparty_details.sql — банківські реквізити й адреси контрагентів.
--
-- IBAN тут не просто довідкове поле: у виписці він стоїть у кожному рядку, і
-- коли ЄДРПОУ в ній немає (а його часто немає), саме рахунок однозначно
-- вказує на контрагента. Тому він же стає другим ключем автоматичного
-- рознесення платежів.
--
-- Адрес у контрагента дві, і плутати їх дорого: юридична йде в реквізити
-- документів, а адреса доставки — в пункт розвантаження ТТН. Мережі майже
-- завжди возять на розподільчий центр, а не на юридичну адресу.

alter table customers add column if not exists iban             text;
alter table customers add column if not exists bank_name        text;
alter table customers add column if not exists delivery_address text;

alter table suppliers add column if not exists iban             text;
alter table suppliers add column if not exists bank_name        text;
-- Для постачальника юридичної адреси досі не було взагалі.
alter table suppliers add column if not exists address          text;
-- Звідки забираємо товар і куди повертаємо брак — це не завжди юридична адреса.
alter table suppliers add column if not exists warehouse_address text;

-- Пошук контрагента за рахунком із виписки має бути миттєвим.
create index if not exists customers_iban_idx on customers (iban) where iban is not null;
create index if not exists suppliers_iban_idx on suppliers (iban) where iban is not null;
