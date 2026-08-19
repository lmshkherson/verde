-- 042_bank_api.sql — синхронізація виписки через API банку.
--
-- Токен зберігається на банківському рахунку; синхронізація тягне рухи за
-- останній місяць і кладе їх у той самий конвеєр, що CSV-імпорт: дедуплікація
-- по ext_id, автозіставлення, рознесення — все як зі звичайною випискою.

alter table bank_accounts add column if not exists api_provider text
  check (api_provider in ('monobank','privat24'));
alter table bank_accounts add column if not exists api_token text;
