-- Реквізити, потрібні саме для друкованих форм. В обліку вони не беруть участі:
-- жодна сума від них не залежить, тому вони й з'явилися лише зараз.

-- Підписанти й контакти продавця. Адреса, банк і IBAN уже є з міграції 007.
alter table legal_entities add column if not exists director_name      text;
alter table legal_entities add column if not exists director_position  text not null default 'Директор';
alter table legal_entities add column if not exists accountant_name    text;
alter table legal_entities add column if not exists phone              text;
alter table legal_entities add column if not exists email              text;

-- Адреса покупця: у бланку накладної вона обов'язкова, а в довіднику її не було.
alter table customers add column if not exists address text;

-- Довіреність, за якою представник покупця забирає товар. Реквізит рядка
-- «Отримав(ла)» у видатковій накладній; за нею ж потім знаходять, хто саме
-- отримав вантаж, якщо виникне спір.
alter table shipments add column if not exists proxy_number text;
alter table shipments add column if not exists proxy_date   date;
alter table shipments add column if not exists proxy_person text;
