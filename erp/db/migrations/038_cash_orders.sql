-- 038_cash_orders.sql — каса: прибуткові й видаткові касові ордери.
--
-- Ордер — первинний документ каси (ПКО/ВКО з друкованою формою), а гроші
-- він проводить через ті самі таблиці, що й банк: оплата покупця → payments,
-- оплата постачальнику → supplier_payments, господарська витрата → expenses.
-- Тож дебіторка, кредиторка і P&L бачать готівку без жодних нових формул,
-- а касова книга складається з ордерів плюс готівкових оплат без ордера
-- (записаних кнопкою «Записати оплату» до появи каси).

create table if not exists cash_orders (
  id                  uuid primary key default gen_random_uuid(),
  number              text not null unique,
  legal_entity_id     uuid not null references legal_entities(id),
  direction           text not null check (direction in ('in','out')),
  kind                text not null check (kind in ('customer_payment','supplier_payment','expense','other')),
  occurred_on         date not null default current_date,
  amount              numeric(14,2) not null check (amount > 0),
  customer_id         uuid references customers(id),
  supplier_id         uuid references suppliers(id),
  so_id               uuid references sales_orders(id),
  po_id               uuid references purchase_orders(id),
  payment_id          uuid references payments(id) on delete set null,
  supplier_payment_id uuid references supplier_payments(id) on delete set null,
  expense_id          uuid references expenses(id) on delete set null,
  category            text,
  -- Від кого прийнято / кому видано — обов'язковий реквізит друкованої форми.
  person              text,
  purpose             text,
  note                text,
  created_by          uuid references app_users(id),
  created_at          timestamptz not null default now()
);
create index if not exists cash_orders_entity_idx on cash_orders (legal_entity_id, occurred_on desc);

-- Готівкова витрата платиться з каси, а не через кредиторку: проводка їй
-- потрібна Дт стаття Кт 301, і постинги впізнають це за посиланням.
alter table expenses add column if not exists cash_order_id uuid references cash_orders(id) on delete set null;

-- «Інші» касові ордери без контрагента проводяться через розрахунки з
-- іншими кредиторами — цього рахунку в плані ще не було.
insert into chart_of_accounts (code, name, kind)
values ('685', 'Розрахунки з іншими кредиторами', 'liability')
on conflict (code) do nothing;
