-- Обмін документами з M.E.Doc і «Вчасно».
--
-- Найважче в такій інтеграції не HTTP-виклик, а стан: що вже пішло, що
-- зареєстровано, що відхилено і як не відправити двічі. Тому основа тут —
-- черга (outbox), а самі канали є змінними адаптерами над нею.

create table if not exists integration_settings (
  legal_entity_id uuid primary key references legal_entities(id) on delete cascade,
  -- 'none' — обмін вимкнено, документи просто не потрапляють у чергу;
  -- 'file' — тека обміну, штатний спосіб роботи з M.E.Doc;
  -- 'vchasno' — REST API «Вчасно» з токеном.
  provider        text not null default 'none'
                    check (provider in ('none','file','vchasno')),
  export_dir      text,
  api_base_url    text,
  -- Ім'я змінної середовища з токеном, а не сам токен: секрет у базі — це
  -- секрет у бекапі, у дампі й у чужих руках.
  api_token_env   text,
  auto_enqueue    boolean not null default true,
  updated_at      timestamptz not null default now()
);

create table if not exists outbox_documents (
  id              uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references legal_entities(id),
  doc_type        text not null check (doc_type in ('tax_invoice','shipment','supplier_return','customer_return')),
  doc_id          uuid not null,
  doc_number      text not null,
  doc_date        date not null,
  counterparty    text,
  counterparty_id text,
  -- Ім'я файла за конвенцією «Вчасно»: за ним сервіс сам заповнює контрагента
  -- й реквізити документа, тож воно однакове для обох каналів.
  file_name       text not null,
  payload         text not null,
  status          text not null default 'queued'
                    check (status in ('queued','sent','delivered','rejected','failed')),
  attempts        int not null default 0,
  external_id     text,
  error           text,
  queued_at       timestamptz not null default now(),
  sent_at         timestamptz,
  settled_at      timestamptz,
  created_by      uuid references app_users(id)
);

-- Один документ — один запис у черзі. Це і є захист від подвійної відправки:
-- повторний запуск черги нічого не дублює, бо база не дасть.
create unique index if not exists outbox_documents_doc_key
  on outbox_documents (legal_entity_id, doc_type, doc_id);
create index if not exists outbox_documents_status_idx
  on outbox_documents (legal_entity_id, status, queued_at);

create or replace view v_outbox_summary as
select legal_entity_id,
       count(*) filter (where status = 'queued')::int    as queued,
       count(*) filter (where status = 'sent')::int      as sent,
       count(*) filter (where status = 'delivered')::int as delivered,
       count(*) filter (where status = 'rejected')::int  as rejected,
       count(*) filter (where status = 'failed')::int    as failed
from outbox_documents
group by legal_entity_id;
