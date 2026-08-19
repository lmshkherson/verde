-- 008_doc_prefix.sql — власний префікс нумерації для кожної юрособи.
--
-- Автоматичний префікс із перших літер назви виявився пасткою: «Верде Фудс» і
-- «Верде Роздріб» обидва давали «ВЕР», номери двох юросіб збігалися й падали на
-- унікальному індексі. Префікс має задавати людина — бухгалтерії все одно
-- потрібен свій, упізнаваний.

alter table legal_entities add column if not exists doc_prefix text;

with numbered as (
  select id,
         upper(left(regexp_replace(short_name, '[^[:alnum:]]', '', 'g'), 3)) as base,
         row_number() over (
           partition by upper(left(regexp_replace(short_name, '[^[:alnum:]]', '', 'g'), 3))
           order by created_at
         ) as rn
  from legal_entities
)
update legal_entities e
   set doc_prefix = case when n.rn = 1 then n.base else n.base || n.rn end
  from numbered n
 where n.id = e.id and e.doc_prefix is null;

alter table legal_entities alter column doc_prefix set not null;
create unique index if not exists legal_entities_doc_prefix_key on legal_entities (upper(doc_prefix));

create or replace function next_doc_number(p_entity uuid, p_prefix text) returns text as $$
declare
  y int := extract(year from now())::int;
  c int;
  p text;
begin
  insert into doc_counters (legal_entity_id, prefix, year, counter)
  values (p_entity, p_prefix, y, 1)
  on conflict (legal_entity_id, prefix) do update
    set counter = case when doc_counters.year = y then doc_counters.counter + 1 else 1 end,
        year    = y
  returning doc_counters.counter into c;

  select doc_prefix into p from legal_entities where id = p_entity;

  return p || '-' || p_prefix || '-' || y || '-' || lpad(c::text, 4, '0');
end;
$$ language plpgsql;
