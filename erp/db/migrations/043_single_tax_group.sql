-- 043_single_tax_group.sql — група єдиного податку в картці юрособи.
--
-- Група визначає, як рахується податок: 2-га платить фіксовану ставку
-- щомісяця незалежно від доходу, 3-тя — відсоток від доходу. ФОП VERDE —
-- на 2-й групі, тож вона і типова.

alter table legal_entities add column if not exists single_tax_group smallint not null default 2
  check (single_tax_group in (2, 3));
