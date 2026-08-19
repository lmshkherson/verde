#!/usr/bin/env node
// Застосовує db/migrations/*.sql по порядку імені, по одному разу кожну.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'db', 'migrations');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL не заданий. Скопіюйте .env.example у .env.local і вкажіть рядок підключення.');
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: /supabase|amazonaws|render|neon/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
});
await client.connect();

await client.query(`
  create table if not exists schema_migrations (
    name       text primary key,
    applied_at timestamptz not null default now()
  )
`);

const { rows } = await client.query('select name from schema_migrations');
const applied = new Set(rows.map((r) => r.name));
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

let count = 0;
for (const file of files) {
  if (applied.has(file)) continue;

  const sql = await readFile(join(dir, file), 'utf8');
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('insert into schema_migrations (name) values ($1)', [file]);
    await client.query('commit');
    console.log(`  ✓ ${file}`);
    count += 1;
  } catch (err) {
    await client.query('rollback');
    console.error(`  ✗ ${file}\n${err.message}`);
    await client.end();
    process.exit(1);
  }
}

console.log(count ? `Застосовано міграцій: ${count}` : 'Нових міграцій немає.');
await client.end();
