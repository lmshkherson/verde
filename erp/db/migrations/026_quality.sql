-- 026_quality.sql — вхідний контроль сировини і журнали HACCP.
--
-- Простежуваність відповідає на питання «куди поділася партія». Вхідний
-- контроль відповідає на попереднє: «чи мала вона взагалі право потрапити
-- у цех». Для оператора ринку харчових продуктів це вимога ст. 20 ЗУ
-- № 771/97-ВР — постійно діючі процедури, засновані на принципах НАССР,
-- і документальне підтвердження їх дотримання.
--
-- Механіка одна на все: партія, яку не перевірили, лежить у карантині й
-- фізично не підбирається при списанні. Не попередження, а блокування.

-- ─── Довідники ──────────────────────────────────────────────────────────────

-- Позиції, які без документа якості у виробництво не йдуть. Прапорець свій у
-- кожної позиції: плівці, що контактує з продуктом, декларація потрібна так
-- само, як фініковій пасті, а картонному шоубоксу — ні.
alter table items add column if not exists quality_control boolean not null default false;
-- Вимоги приймання: те, що комірник звіряє з поставкою, а не згадує з голови.
alter table items add column if not exists acceptance_spec text;

-- Затверджений постачальник — базова передумова НАССР: сировину приймають
-- лише від тих, кого оцінили й внесли до переліку. Дата закінчення потрібна,
-- бо затвердження переглядають, а не видають назавжди.
alter table suppliers add column if not exists is_approved    boolean not null default false;
alter table suppliers add column if not exists approved_on    date;
alter table suppliers add column if not exists approved_until date;
alter table suppliers add column if not exists approval_note  text;

-- ─── Стан партії ────────────────────────────────────────────────────────────

-- Партії, створені до цієї міграції, лишаються дозволеними: заднім числом
-- зупиняти вже спожиту сировину немає сенсу.
alter table batches add column if not exists quality_status text not null default 'released'
  check (quality_status in ('quarantine','released','rejected'));
alter table batches add column if not exists quality_note text;
create index if not exists batches_quality_idx
  on batches (quality_status) where quality_status <> 'released';

-- Документи постачальника на партію: посвідчення про якість, декларація
-- виробника, ветеринарний документ, протокол досліджень.
create table if not exists batch_documents (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references batches(id) on delete cascade,
  kind        text not null check (kind in ('quality','declaration','vet','lab','safety','other')),
  number      text not null,
  issuer      text,
  issued_on   date,
  -- Порожнє означає «без обмеження строку», а не «прострочений».
  valid_until date,
  file_url    text,
  note        text,
  added_by    uuid references app_users(id),
  created_at  timestamptz not null default now()
);
create index if not exists batch_documents_batch_idx on batch_documents (batch_id);
create unique index if not exists batch_documents_key on batch_documents (batch_id, kind, number);

-- ─── Акт вхідного контролю ──────────────────────────────────────────────────
-- Один акт на поставку: постачальник виписує документи на партію поставки,
-- а комірник приймає машину цілком, а не позицію за позицією.

create table if not exists incoming_inspections (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique,
  legal_entity_id  uuid not null references legal_entities(id),
  po_id            uuid references purchase_orders(id),
  supplier_id      uuid references suppliers(id),
  received_on      date not null default current_date,
  -- Температура в кузові на момент приймання і стан транспорту: для харчової
  -- сировини це така сама умова приймання, як і кількість.
  transport_temp_c numeric(5,1),
  transport_ok     boolean not null default true,
  vehicle          text,
  status           text not null default 'draft'
                     check (status in ('draft','completed','cancelled')),
  note             text,
  created_by       uuid references app_users(id),
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);
create index if not exists incoming_inspections_entity_idx
  on incoming_inspections (legal_entity_id, received_on desc);

create table if not exists incoming_inspection_lines (
  id                uuid primary key default gen_random_uuid(),
  inspection_id     uuid not null references incoming_inspections(id) on delete cascade,
  batch_id          uuid not null references batches(id),
  item_id           uuid not null references items(id),
  qty               numeric(14,3) not null default 0,
  temp_c            numeric(5,1),
  package_ok        boolean,
  marking_ok        boolean,
  organoleptic_ok   boolean,
  verdict           text not null default 'pending'
                      check (verdict in ('pending','accepted','rejected')),
  -- Відхилення без записаного рішення — це не контроль, а спостереження.
  corrective_action text,
  note              text,
  checked_at        timestamptz,
  checked_by        uuid references app_users(id)
);
create unique index if not exists incoming_inspection_lines_key
  on incoming_inspection_lines (inspection_id, batch_id);

-- Чим підтверджена партія: рахуємо окремо всі документи й окремо ті, що
-- дійсні на сьогодні. Прострочений сертифікат — це відсутній сертифікат.
create or replace view v_batch_docs as
select b.id as batch_id,
       count(d.id)::int                                                          as docs,
       count(d.id) filter (
         where d.valid_until is null or d.valid_until >= current_date
       )::int                                                                    as valid_docs,
       min(d.valid_until) filter (where d.valid_until is not null)               as nearest_expiry
from batches b
left join batch_documents d on d.batch_id = b.id
group by b.id;

-- Партії, які лежать на складі й не допущені: карантин і брак. Саме цей
-- список щоранку розбирає комірник.
create or replace view v_blocked_batches as
select b.id                as batch_id,
       b.code,
       b.quality_status,
       b.quality_note,
       b.expires_on,
       i.id                as item_id,
       i.sku,
       i.name              as item_name,
       i.unit,
       sb.legal_entity_id,
       sb.warehouse_id,
       sb.qty,
       sb.value,
       d.valid_docs,
       o.supplier_name,
       o.purchase_number
from batches b
join items i on i.id = b.item_id
join v_stock_batches sb on sb.batch_id = b.id
left join v_batch_docs d on d.batch_id = b.id
left join v_batch_origin o on o.batch_id = b.id
where b.quality_status <> 'released' and sb.qty > 0;

create or replace view v_inspection_summary as
select s.id as inspection_id,
       count(l.id)::int                                              as lines,
       count(l.id) filter (where l.verdict = 'accepted')::int         as accepted,
       count(l.id) filter (where l.verdict = 'rejected')::int         as rejected,
       count(l.id) filter (where l.verdict = 'pending')::int          as pending,
       count(l.id) filter (where coalesce(d.valid_docs, 0) = 0)::int  as without_docs
from incoming_inspections s
left join incoming_inspection_lines l on l.inspection_id = s.id
left join v_batch_docs d on d.batch_id = l.batch_id
group by s.id;

-- ─── HACCP: точки контролю і журнал ─────────────────────────────────────────

create table if not exists haccp_points (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  name              text not null,
  -- ККТ — критична контрольна точка, ПРП — програма-передумова,
  -- оПРП — операційна програма-передумова.
  kind              text not null default 'ccp' check (kind in ('ccp','prp','oprp')),
  stage             text not null
                      check (stage in ('receiving','storage','production','packaging','shipping')),
  parameter         text not null,
  unit              text,
  -- Обидві межі порожні означають якісний контроль: «відповідає / ні».
  limit_min         numeric(10,2),
  limit_max         numeric(10,2),
  frequency         text,
  -- Скільки годин допустимо без запису. Дає відповідь на питання, яке ставить
  -- перевірка: чи вівся журнал, чи заповнений напередодні за місяць.
  max_gap_hours     int,
  monitoring        text,
  corrective_action text,
  verification      text,
  -- Точки, які заповнюються з документів автоматично: приймання й відвантаження.
  auto_source       text check (auto_source in ('incoming','shipping')),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

create table if not exists haccp_logs (
  id                bigserial primary key,
  point_id          uuid not null references haccp_points(id),
  legal_entity_id   uuid not null references legal_entities(id),
  logged_at         timestamptz not null default now(),
  value             numeric(12,3),
  is_ok             boolean not null,
  batch_id          uuid references batches(id),
  doc_type          text,
  doc_id            uuid,
  corrective_action text,
  note              text,
  user_id           uuid references app_users(id),
  source            text not null default 'manual'
                      check (source in ('manual','incoming','shipping')),
  -- Головне правило системи: відхилення без коригувальної дії не існує.
  -- Тримаємо його в базі, а не лише у формі, бо записи сюди йдуть і з коду.
  constraint haccp_logs_correction
    check (is_ok or coalesce(btrim(corrective_action), '') <> '')
);
create index if not exists haccp_logs_point_idx on haccp_logs (point_id, logged_at desc);
create index if not exists haccp_logs_entity_idx on haccp_logs (legal_entity_id, logged_at desc);

-- Стан точки: коли востаннє писали, скільки відхилень за місяць. Точки спільні
-- для всіх юросіб — виробництво фізично одне, і холодильник у нього теж один.
create or replace view v_haccp_status as
select p.id                                             as point_id,
       max(l.logged_at)                                 as last_at,
       count(l.id)::int                                 as logs_30,
       count(l.id) filter (where not l.is_ok)::int      as deviations_30
from haccp_points p
left join haccp_logs l on l.point_id = p.id and l.logged_at > now() - interval '30 days'
group by p.id;

-- Потреба у сировині тепер рахує лише допущені партії. Інакше технолог бачив
-- би «сировини вистачає», а варка падала б при закритті — гірше за чесне
-- «є, але в карантині», показане заздалегідь.
drop view if exists v_production_requirements;
create view v_production_requirements as
select po.id as production_order_id,
       rl.item_id,
       i.sku,
       i.name,
       i.unit,
       round(rl.qty_per_batch * (1 + rl.loss_pct / 100) * po.planned_qty / r.output_qty, 3) as required_qty,
       coalesce(a.released_qty, 0) as available_qty,
       coalesce(a.blocked_qty, 0)  as blocked_qty,
       coalesce(st.avg_cost, 0)    as avg_cost
from production_orders po
join recipes r        on r.id = po.recipe_id
join recipe_lines rl  on rl.recipe_id = r.id
join items i          on i.id = rl.item_id
left join v_item_stock st
       on st.item_id = rl.item_id and st.legal_entity_id = po.legal_entity_id
left join lateral (
  select sum(sb.qty) filter (where b.quality_status = 'released')  as released_qty,
         sum(sb.qty) filter (where b.quality_status <> 'released') as blocked_qty
    from v_stock_batches sb
    join batches b on b.id = sb.batch_id
   where sb.item_id = rl.item_id and sb.legal_entity_id = po.legal_entity_id
) a on true
where po.status in ('planned','in_progress');
