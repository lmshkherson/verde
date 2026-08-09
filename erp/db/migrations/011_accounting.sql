-- 011_accounting.sql — бухгалтерський контур: план рахунків і проводки у двох книгах.
--
-- Ключове рішення моделі: ознака на проводці каже не «тут є розбіжність», а
-- ДО ЯКОЇ КНИГИ вона належить. Бо відмінність між обліками — це майже завжди
-- різні рахунки й різні суми, а не та сама проводка з позначкою:
--
--   both        — однакова в обох (переважна більшість операцій)
--   accounting  — тільки бухгалтерська
--   management  — тільки управлінська
--
-- Бухгалтерський результат = both + accounting, управлінський = both + management.
-- Різниця між ними завжди розкладається на конкретні проводки й документи.

create table if not exists chart_of_accounts (
  code        text primary key,
  name        text not null,
  kind        text not null check (kind in ('asset','liability','equity','income','expense')),
  parent_code text references chart_of_accounts(code),
  is_active   boolean not null default true
);

create table if not exists posting_batches (
  id              uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references legal_entities(id),
  doc_type        text not null,
  doc_id          uuid,
  posted_on       date not null,
  description     text,
  created_at      timestamptz not null default now()
);
create index if not exists posting_batches_doc_idx on posting_batches (doc_type, doc_id);

create table if not exists postings (
  id              bigserial primary key,
  batch_id        uuid not null references posting_batches(id) on delete cascade,
  legal_entity_id uuid not null references legal_entities(id),
  book            text not null check (book in ('both','accounting','management')),
  debit_code      text not null references chart_of_accounts(code),
  credit_code     text not null references chart_of_accounts(code),
  amount          numeric(14,2) not null check (amount > 0),
  posted_on       date not null,
  note            text
);
create index if not exists postings_period_idx on postings (legal_entity_id, posted_on);
create index if not exists postings_book_idx on postings (book);

-- Початкові залишки: без них оборотка не збалансується, бо гроші й капітал
-- у систему нізвідки не беруться.
create table if not exists opening_balances (
  id              uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references legal_entities(id),
  code            text not null references chart_of_accounts(code),
  as_of           date not null,
  debit           numeric(14,2) not null default 0 check (debit >= 0),
  credit          numeric(14,2) not null default 0 check (credit >= 0),
  unique (legal_entity_id, code, as_of)
);

-- Коли востаннє перегенеровано проводки за період: вони похідні від документів,
-- тож користувач має бачити, наскільки вони свіжі.
create table if not exists posting_runs (
  legal_entity_id uuid not null references legal_entities(id),
  period          date not null,
  generated_at    timestamptz not null default now(),
  generated_by    uuid references app_users(id),
  postings_count  int not null default 0,
  primary key (legal_entity_id, period)
);

-- Проводка з ознакою both належить обом книгам, тож розгортаємо її у два рядки.
create or replace view v_postings_by_book as
select p.id,
       p.batch_id,
       p.legal_entity_id,
       b.book,
       p.debit_code,
       p.credit_code,
       p.amount,
       p.posted_on,
       p.note
from postings p
cross join lateral unnest(
  case when p.book = 'both' then array['accounting','management'] else array[p.book] end
) as b(book);

-- Оберти по рахунку: одна проводка дає рядок у дебет і рядок у кредит.
create or replace view v_account_turnover as
select legal_entity_id, book, posted_on, debit_code as code, amount as debit, 0::numeric as credit
from v_postings_by_book
union all
select legal_entity_id, book, posted_on, credit_code, 0::numeric, amount
from v_postings_by_book;

create or replace view v_trial_balance as
select t.legal_entity_id,
       t.book,
       t.code,
       a.name,
       a.kind,
       sum(t.debit)                as debit,
       sum(t.credit)               as credit,
       sum(t.debit) - sum(t.credit) as balance
from v_account_turnover t
join chart_of_accounts a on a.code = t.code
group by t.legal_entity_id, t.book, t.code, a.name, a.kind;

-- Розбіжність між книгами в розрізі рахунку: звідки саме взялася різниця
-- між бухгалтерським і управлінським результатом.
create or replace view v_book_difference as
with by_book as (
  select legal_entity_id,
         date_trunc('month', posted_on)::date as period,
         book,
         code,
         sum(debit) - sum(credit) as balance
  from v_account_turnover
  group by legal_entity_id, date_trunc('month', posted_on), book, code
)
select coalesce(a.legal_entity_id, m.legal_entity_id) as legal_entity_id,
       coalesce(a.period, m.period)                   as period,
       coalesce(a.code, m.code)                       as code,
       coalesce(a.balance, 0)                         as accounting_balance,
       coalesce(m.balance, 0)                         as management_balance,
       coalesce(a.balance, 0) - coalesce(m.balance, 0) as difference
from (select * from by_book where book = 'accounting') a
full join (select * from by_book where book = 'management') m
  on m.legal_entity_id = a.legal_entity_id and m.period = a.period and m.code = a.code;

-- ─── План рахунків ──────────────────────────────────────────────────────────
-- Скорочений під потреби виробництва: без ділянок, яких система поки не веде.

insert into chart_of_accounts (code, name, kind) values
  ('104',  'Машини та обладнання',                     'asset'),
  ('131',  'Знос основних засобів',                    'asset'),
  ('201',  'Сировина й матеріали',                     'asset'),
  ('204',  'Тара й тарні матеріали',                   'asset'),
  ('23',   'Виробництво',                              'asset'),
  ('26',   'Готова продукція',                         'asset'),
  ('301',  'Готівка в національній валюті',            'asset'),
  ('311',  'Поточні рахунки в національній валюті',    'asset'),
  ('361',  'Розрахунки з вітчизняними покупцями',      'asset'),
  ('40',   'Зареєстрований капітал',                   'equity'),
  ('441',  'Прибуток нерозподілений',                  'equity'),
  ('631',  'Розрахунки з вітчизняними постачальниками','liability'),
  ('6411', 'Розрахунки за ПДВ',                        'liability'),
  ('6412', 'Податок на доходи фізичних осіб',          'liability'),
  ('6414', 'Військовий збір',                          'liability'),
  ('6441', 'Податковий кредит з ПДВ',                  'asset'),
  ('651',  'Розрахунки за ЄСВ',                        'liability'),
  ('661',  'Розрахунки за заробітною платою',          'liability'),
  ('701',  'Дохід від реалізації готової продукції',   'income'),
  ('791',  'Результат операційної діяльності',         'equity'),
  ('901',  'Собівартість реалізованої продукції',      'expense'),
  ('91',   'Загальновиробничі витрати',                'expense'),
  ('92',   'Адміністративні витрати',                  'expense'),
  ('93',   'Витрати на збут',                          'expense'),
  ('947',  'Нестачі і втрати від псування цінностей',  'expense')
on conflict (code) do update set name = excluded.name, kind = excluded.kind;
