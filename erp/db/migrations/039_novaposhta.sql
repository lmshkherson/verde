-- 039_novaposhta.sql — інтеграція з Новою Поштою: створення ТТН через API.
--
-- Ключ і реквізити відправника — в налаштуваннях (відправник у НП один на
-- компанію), а місто й відділення одержувача — в картці клієнта. Без ключа
-- все працює як раніше: номер ТТН вводиться руками у відвантаженні.

alter table settings add column if not exists np_api_key        text;
alter table settings add column if not exists np_sender_city    text;
alter table settings add column if not exists np_sender_branch  text;
alter table settings add column if not exists np_sender_phone   text;
alter table settings add column if not exists np_sender_contact text;

alter table customers add column if not exists np_city   text;
alter table customers add column if not exists np_branch text;
