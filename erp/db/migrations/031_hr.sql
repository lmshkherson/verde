-- 031_hr.sql — кадровий модуль: картка співробітника, відсутності, майно.
--
-- Досі працівник у системі був рядком розрахунку зарплати: ПІБ, посада,
-- оклад. Кадровий облік вимагає більшого — і не заради паперу: залишок
-- відпустки це грошове зобов'язання підприємства, лікарняний міняє
-- нарахування, а невідданий при звільненні ноутбук шукається саме за
-- журналом виданого майна.

-- ─── Картка співробітника ───────────────────────────────────────────────────
alter table employees add column if not exists tax_id          text;
alter table employees add column if not exists birth_date      date;
-- Паспорт або ID-картка одним полем: серія й номер разом, як у наказах.
alter table employees add column if not exists id_document     text;
alter table employees add column if not exists phone           text;
alter table employees add column if not exists email           text;
alter table employees add column if not exists address         text;
alter table employees add column if not exists dismissed_on    date;
-- Щорічна основна відпустка — 24 календарні дні (ст. 75 КЗпП); у картці,
-- бо буває й більша: неповнолітнім 31, інвалідам 26 тощо.
alter table employees add column if not exists vacation_days_per_year int not null default 24;
-- Страховий стаж у повних роках на дату приймання. Визначає відсоток
-- лікарняних; точні місяці система не відстежує — це поле актуалізують раз
-- на рік разом із кадровим аудитом.
alter table employees add column if not exists insurance_years int not null default 8;

-- РНОКПП унікальний в межах юрособи: одна людина може працювати у ТОВ і у
-- ФОП одночасно, це два різні працівники в обліку.
create unique index if not exists employees_tax_id_key
  on employees (legal_entity_id, tax_id) where tax_id is not null;

-- ─── Відсутності: відпустки, лікарняні, за свій рахунок ─────────────────────
create table if not exists employee_absences (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id) on delete cascade,
  kind          text not null check (kind in ('vacation','sick','unpaid')),
  date_from     date not null,
  date_to       date not null,
  -- Календарні дні зберігаються, а не рахуються на льоту: відпустка на
  -- межі місяців ділиться між двома нарахуваннями, і кожне має знати
  -- свою частину без повторної арифметики з датами.
  calendar_days int not null check (calendar_days > 0),
  -- Середньоденна, зафіксована на момент оформлення. Заднім числом вона
  -- не перераховується — так само, як не перераховують видані відпускні.
  avg_daily     numeric(14,2) not null default 0,
  -- Нарахована сума за відсутність. Для лікарняного це лише частина
  -- роботодавця (перші 5 днів × відсоток стажу).
  amount        numeric(14,2) not null default 0,
  -- Частина ПФУ з 6-го дня — довідково: фонд виплачує її повз підприємство,
  -- у витрати вона не входить, але людині треба бачити повну суму.
  fund_amount   numeric(14,2) not null default 0,
  note          text,
  created_by    uuid references app_users(id),
  created_at    timestamptz not null default now(),
  constraint absence_dates check (date_to >= date_from)
);
create index if not exists employee_absences_emp_idx
  on employee_absences (employee_id, date_from desc);

-- Залишок відпустки за рік: належні дні мінус використані. Належне
-- пропорційне відпрацьованій частині року — прийнятий у липні має за цей
-- рік половину норми.
create or replace view v_vacation_balance as
select e.id as employee_id,
       extract(year from current_date)::int as year,
       round(
         e.vacation_days_per_year *
         least(
           (least(current_date, coalesce(e.dismissed_on, current_date))
            - greatest(e.hired_on, date_trunc('year', current_date)::date) + 1)::numeric
           / ((date_trunc('year', current_date) + interval '1 year')::date
              - date_trunc('year', current_date)::date)::numeric,
           1
         ), 1
       ) as entitled_days,
       coalesce((
         select sum(a.calendar_days) from employee_absences a
          where a.employee_id = e.id and a.kind = 'vacation'
            and extract(year from a.date_from) = extract(year from current_date)
       ), 0)::int as used_days
from employees e
where e.hired_on is not null;

-- ─── Видане майно й документи ───────────────────────────────────────────────
-- Форма, перепустка, техніка, довідки. Невіддане при звільненні шукається
-- саме тут, тож «повернуто» — окрема дата, а не видалення рядка.
create table if not exists employee_property (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  kind        text not null default 'equipment'
                check (kind in ('uniform','equipment','access','document','other')),
  name        text not null,
  issued_on   date not null default current_date,
  returned_on date,
  note        text,
  created_by  uuid references app_users(id),
  constraint property_return check (returned_on is null or returned_on >= issued_on)
);
create index if not exists employee_property_emp_idx on employee_property (employee_id);

-- ─── Зарплата з урахуванням відсутностей ────────────────────────────────────
-- Рядок нарахування розпадається на складові: оклад за відпрацьоване,
-- відпускні, лікарняні. Ідуть одним рядком у відомість, але складові
-- зберігаються — розрахунковий листок має пояснювати кожну гривню.
alter table payroll_lines add column if not exists base_salary   numeric(14,2) not null default 0;
alter table payroll_lines add column if not exists vacation_pay  numeric(14,2) not null default 0;
alter table payroll_lines add column if not exists sick_pay      numeric(14,2) not null default 0;
alter table payroll_lines add column if not exists absence_days  int not null default 0;
