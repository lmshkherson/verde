#!/usr/bin/env node
/**
 * Бойова ініціалізація — на відміну від scripts/seed.mjs не створює жодних
 * демо-даних і жодних відомих паролів.
 *
 *   ADMIN_EMAIL=olena@v-verde.ua \
 *   ADMIN_NAME="Олена Ковальчук" \
 *   ADMIN_PASSWORD='...' \
 *   ENTITY_NAME='ТОВ «Верде Світ»' ENTITY_SHORT='Верде Світ' ENTITY_PREFIX=ВФ \
 *   ENTITY_EDRPOU=44821037 ENTITY_IPN=448210326574 ENTITY_VAT=true \
 *   node scripts/init-production.mjs
 *
 * Запускається один раз. Повторний запуск нічого не ламає: юрособа й користувач
 * оновляться, дані документів не чіпаються.
 */
import pg from 'pg';
import { hashPassword } from '../lib/password.mjs';

const env = process.env;
const required = ['DATABASE_URL', 'ADMIN_EMAIL', 'ADMIN_NAME', 'ADMIN_PASSWORD', 'ENTITY_NAME', 'ENTITY_SHORT', 'ENTITY_PREFIX'];
const missing = required.filter((key) => !env[key]);

if (missing.length > 0) {
  console.error(`Не задано: ${missing.join(', ')}`);
  process.exit(1);
}

// Пароль власника відкриває доступ до всіх грошей компанії — коротким він бути не може.
if (env.ADMIN_PASSWORD.length < 12) {
  console.error('ADMIN_PASSWORD має бути не коротшим за 12 символів');
  process.exit(1);
}

const isVatPayer = String(env.ENTITY_VAT ?? 'true').toLowerCase() !== 'false';
if (isVatPayer && !env.ENTITY_IPN) {
  console.error('Для платника ПДВ потрібен ENTITY_IPN');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: /supabase|amazonaws|render|neon/.test(env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
});
await client.connect();

try {
  await client.query('begin');

  const { rows: migrated } = await client.query('select count(*)::int as n from schema_migrations');
  if (migrated[0].n === 0) throw new Error('Спершу застосуйте міграції: npm run db:migrate');

  for (const [code, name, kind] of [
    ['SIR', 'Склад сировини', 'raw'],
    ['GP', 'Склад готової продукції', 'finished'],
    ['CEH', 'Цех (незавершене)', 'wip'],
  ]) {
    await client.query(
      `insert into warehouses (code, name, kind) values ($1, $2, $3)
       on conflict (code) do nothing`,
      [code, name, kind],
    );
  }

  // Міграція створює юрособу-заготовку з назвою 'VERDE'. Перетворюємо саме її,
  // інакше в системі назавжди лишиться порожня друга компанія.
  if (env.ENTITY_SHORT !== 'VERDE') {
    await client.query(
      `update legal_entities set short_name = $1 where short_name = 'VERDE'
        and not exists (select 1 from legal_entities where lower(short_name) = lower($1))`,
      [env.ENTITY_SHORT],
    );
  }

  const { rows: entity } = await client.query(
    `insert into legal_entities
       (name, short_name, doc_prefix, edrpou, ipn, tax_system, is_vat_payer, is_default)
     values ($1, $2, $3, $4, $5, $6, $7, true)
     on conflict (lower(short_name)) do update
       set name = excluded.name, doc_prefix = excluded.doc_prefix, edrpou = excluded.edrpou,
           ipn = excluded.ipn, tax_system = excluded.tax_system, is_vat_payer = excluded.is_vat_payer
     returning id, short_name`,
    [
      env.ENTITY_NAME,
      env.ENTITY_SHORT,
      env.ENTITY_PREFIX.toUpperCase(),
      env.ENTITY_EDRPOU ?? null,
      env.ENTITY_IPN ?? null,
      isVatPayer ? 'general' : 'single_tax',
      isVatPayer,
    ],
  );

  await client.query(
    `insert into app_users (email, full_name, role, password_hash, default_entity_id)
     values ($1, $2, 'owner', $3, $4)
     on conflict (lower(email)) do update
       set full_name = excluded.full_name, password_hash = excluded.password_hash,
           role = 'owner', is_active = true, default_entity_id = excluded.default_entity_id`,
    [env.ADMIN_EMAIL, env.ADMIN_NAME, await hashPassword(env.ADMIN_PASSWORD), entity[0].id],
  );

  await client.query('update app_users set is_demo = false where lower(email) = lower($1)', [
    env.ADMIN_EMAIL,
  ]);

  const { rows: demo } = await client.query(
    'select count(*)::int as n from app_users where is_demo and is_active',
  );

  await client.query('commit');

  console.log(`Юрособу «${entity[0].short_name}» налаштовано, власника створено.`);
  console.log('Склади: SIR, GP, CEH.');
  if (demo[0].n > 0) {
    console.log(
      `\nУВАГА: у базі ще ${demo[0].n} демо-акаунтів із відомим паролем.\n` +
        'Перед бойовим запуском видаліть або деактивуйте їх:\n' +
        '  update app_users set is_active = false where is_demo;',
    );
  }
  console.log('\nДалі: імпорт довідників і залишків — scripts/import.mjs');
} catch (err) {
  await client.query('rollback');
  console.error(`Помилка: ${err.message}`);
  process.exit(1);
} finally {
  await client.end();
}
