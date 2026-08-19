-- 010_overhead_policy.sql — виробничі накладні як витрати періоду.
--
-- У VERDE електроенергія цеху й зарплата працівників на тимчасовій оплаті не
-- включаються у вартість партії, а визнаються окремою статтею того місяця, коли
-- виникли. Це свідомий вибір облікової політики, тож він і оформлений як
-- налаштування юрособи, а не зашитий у код:
--
--   'period'     — накладні йдуть у витрати періоду, собівартість партії = сировина
--   'capitalize' — накладні входять у вартість партії й списуються при продажу
--
-- Різниця не косметична: за 'period' прибуток місяця залежить від того, скільки
-- витрачено, а за 'capitalize' — від того, скільки продано.

alter table legal_entities add column if not exists overhead_policy text not null default 'period'
  check (overhead_policy in ('period', 'capitalize'));

-- Окремі категорії для цеху, щоб їх було видно в P&L не впереміш із орендою.
alter table expenses drop constraint if exists expenses_category_check;
alter table expenses add constraint expenses_category_check check (category in (
  'rent', 'salary', 'utilities', 'logistics', 'marketing', 'bank', 'services', 'other',
  'production_salary', 'production_energy'
));

-- Випуск за місяць — потрібен, щоб рознести витрати цеху на одиницю продукції
-- для управлінської оцінки повної собівартості.
create or replace view v_production_output_monthly as
select legal_entity_id,
       date_trunc('month', finished_at)::date as period,
       sum(produced_qty)                      as produced_qty,
       count(*)::int                          as batches
from production_orders
where status = 'done' and finished_at is not null
group by legal_entity_id, date_trunc('month', finished_at);
