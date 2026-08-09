-- 015_demo_flag.sql — явна ознака демонстраційного акаунта.
--
-- Раніше перевірка стану вважала демо-акаунтами всіх із поштою на домені
-- компанії. Але бойові акаунти будуть саме там, тож ознака має бути явною,
-- а не вгаданою з адреси.

alter table app_users add column if not exists is_demo boolean not null default false;

-- Наявні акаунти зі стандартного сиду позначаємо демонстраційними.
update app_users
   set is_demo = true
 where lower(email) in (
   'olena@v-verde.ua', 'taras@v-verde.ua', 'iryna@v-verde.ua', 'petro@v-verde.ua'
 );
