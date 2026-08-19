-- Штрихкод позиції (GTIN). Зберігається вже з контрольною цифрою — EAN-13 або
-- EAN-8. Дорахунок і перевірка робляться в застосунку: у базі лежить готовий код.
alter table items add column if not exists barcode text;

-- Один код — одна позиція. Дубль означав би, що сканер на складі не зможе
-- сказати, який саме товар перед ним.
create unique index if not exists items_barcode_key on items (barcode) where barcode is not null;
