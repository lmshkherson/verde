-- 027_bank.sql — банківські виписки: імпорт, рознесення, ідемпотентність.
--
-- Досі гроші були єдиним місцем, куди людина щодня переносила руками те, що
-- машина зробить точніше. Виписка — це первинний документ (ч. 2 ст. 9 ЗУ
-- № 996-XIV), тож зберігаємо її як є, а вже з неї породжуємо оплати.
--
-- Два принципи, як і всюди в системі:
--   • рядок виписки не змінюється ніколи — змінюється лише його рознесення;
--   • проводки не пишуться руками: оплата клієнта чи постачальника створює
--     звичайний документ, який уже вміє проводитися.

create table if not exists bank_accounts (
  id              uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references legal_entities(id),
  name            text not null,
  iban            text,
  bank_name       text,
  currency        text not null default 'UAH',
  is_default      boolean not null default false,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);
-- IBAN унікальний глобально: один рахунок не може належати двом юрособам,
-- а помилково заведений дубль ламає ідемпотентність імпорту.
create unique index if not exists bank_accounts_iban_key
  on bank_accounts (iban) where iban is not null;
create index if not exists bank_accounts_entity_idx on bank_accounts (legal_entity_id);

create table if not exists bank_statements (
  id              uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references legal_entities(id),
  account_id      uuid not null references bank_accounts(id),
  file_name       text,
  period_from     date,
  period_to       date,
  rows_total      int not null default 0,
  rows_new        int not null default 0,
  rows_duplicate  int not null default 0,
  imported_at     timestamptz not null default now(),
  imported_by     uuid references app_users(id)
);
create index if not exists bank_statements_entity_idx
  on bank_statements (legal_entity_id, imported_at desc);

create table if not exists bank_transactions (
  id                  uuid primary key default gen_random_uuid(),
  statement_id        uuid references bank_statements(id) on delete set null,
  legal_entity_id     uuid not null references legal_entities(id),
  account_id          uuid not null references bank_accounts(id),
  op_date             date not null,
  -- Знак несе зміст: + надходження, − списання. Окрема колонка «напрямок»
  -- дала б два джерела правди, які рано чи пізно розійдуться.
  amount              numeric(14,2) not null check (amount <> 0),
  currency            text not null default 'UAH',
  counterparty_name   text,
  counterparty_edrpou text,
  counterparty_iban   text,
  purpose             text,
  doc_number          text,
  -- Ключ ідемпотентності: власний ідентифікатор банку, а якщо його немає —
  -- відбиток рядка разом із порядковим номером серед однакових. Два
  -- справді однакові платежі за день існують, і склеювати їх не можна.
  ext_id              text not null,
  status              text not null default 'new'
                        check (status in ('new','matched','ignored')),
  match_kind          text check (match_kind in
                        ('customer_payment','supplier_payment','other')),
  -- Рахунок для операцій, у яких документа-посередника немає взагалі:
  -- комісія банку, сплата податку. Для них виписка і є первинним документом.
  other_account       text references chart_of_accounts(code),
  customer_id         uuid references customers(id),
  supplier_id         uuid references suppliers(id),
  payment_id          uuid references payments(id) on delete set null,
  supplier_payment_id uuid references supplier_payments(id) on delete set null,
  note                text,
  matched_at          timestamptz,
  matched_by          uuid references app_users(id),
  created_at          timestamptz not null default now()
);
create unique index if not exists bank_transactions_ext_key
  on bank_transactions (account_id, ext_id);
create index if not exists bank_transactions_queue_idx
  on bank_transactions (legal_entity_id, status, op_date desc);

-- Рахунки, потрібні для операцій без документа-посередника.
insert into chart_of_accounts (code, name, kind) values
  ('651', 'Розрахунки за загальнообов''язковим державним соціальним страхуванням', 'liability'),
  ('92',  'Адміністративні витрати', 'expense')
on conflict (code) do nothing;

-- Стан рознесення по виписці.
create or replace view v_statement_progress as
select s.id as statement_id,
       count(t.id)::int                                        as lines,
       count(t.id) filter (where t.status = 'new')::int         as unmatched,
       count(t.id) filter (where t.status = 'matched')::int     as matched,
       count(t.id) filter (where t.status = 'ignored')::int     as ignored,
       coalesce(sum(t.amount) filter (where t.amount > 0), 0)   as inflow,
       coalesce(-sum(t.amount) filter (where t.amount < 0), 0)  as outflow
from bank_statements s
left join bank_transactions t on t.statement_id = s.id
group by s.id;

-- Рух і залишок по рахунку за даними виписок. Це не сальдо 311 з проводок:
-- розбіжність між ними якраз і показує, що щось не рознесено.
create or replace view v_bank_account_totals as
select a.id as account_id,
       a.legal_entity_id,
       count(t.id)::int                                        as lines,
       count(t.id) filter (where t.status = 'new')::int         as unmatched,
       coalesce(sum(t.amount), 0)                              as net_flow,
       max(t.op_date)                                          as last_op
from bank_accounts a
left join bank_transactions t on t.account_id = a.id
group by a.id, a.legal_entity_id;
