#!/usr/bin/env node
/**
 * Запуск на робочому комп'ютері одним файлом.
 *
 * Уся логіка тут, а не в .bat і .sh, бо Node потрібен програмі в будь-якому
 * разі — тож нехай буде одна перевірена реалізація замість двох крихких на
 * різних діалектах командного рядка.
 *
 * Скрипт робить усе, що потрібно, і рівно один раз: питає реквізити бази,
 * створює її, ставить залежності, застосовує міграції, наповнює демо-даними,
 * збирає застосунок і відкриває браузер. Повторний запуск пропускає готове.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { userInfo } from 'node:os';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

const PORT = process.env.PORT ?? '3000';
const DB_NAME = 'verde_erp';
const isWindows = process.platform === 'win32';

const say = (text = '') => console.log(text);
const step = (text) => console.log(`\n▸ ${text}`);
const ok = (text) => console.log(`  ✓ ${text}`);

function fail(title, lines) {
  say(`\n✗ ${title}\n`);
  for (const line of lines) say(`  ${line}`);
  say('\nПісля цього запустіть файл ще раз.');
  process.exitCode = 1;
}

/** Запускає команду й показує її вивід. Повертає код завершення. */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: isWindows,
    ...options,
  });
  return result.status ?? 1;
}

async function ask(rl, question, fallback) {
  const answer = (await rl.question(`  ${question}${fallback ? ` [${fallback}]` : ''}: `)).trim();
  return answer || fallback || '';
}

/** Рядок підключення з частин, з екрануванням пароля. */
function buildUrl({ host, port, user, password, database }) {
  const auth = password
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
    : encodeURIComponent(user);
  return `postgres://${auth}@${host}:${port}/${database}`;
}

/**
 * Той самий сервер, але службова база postgres. Перевіряти підключення нашою
 * базою не можна: на першому запуску її ще немає, і робоча перевірка
 * провалилася б рівно там, де все насправді гаразд.
 */
const serviceUrlOf = (url) => url.replace(/\/[^/?]+(\?.*)?$/, '/postgres$1');

async function canConnect(url) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch (err) {
    return err;
  }
}

// ─── 1. Node ────────────────────────────────────────────────────────────────
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  fail(`Node ${process.versions.node} застарий — потрібен 20 або новіший`, [
    'Завантажте LTS-версію: https://nodejs.org',
  ]);
  process.exit(1);
}

say('VERDE ERP — запуск на цьому комп’ютері');
ok(`Node ${process.versions.node}`);

// ─── 2. Реквізити бази ──────────────────────────────────────────────────────
const ENV_FILE = join(ROOT, '.env.local');
// Готовий рядок у змінній середовища перекриває все: так запускають ті, у кого
// база вже є, і так само працює автоматична перевірка.
let databaseUrl = process.env.DATABASE_URL?.trim() || null;

if (!databaseUrl && existsSync(ENV_FILE)) {
  const match = readFileSync(ENV_FILE, 'utf8').match(/^DATABASE_URL=(.+)$/m);
  if (match) databaseUrl = match[1].trim();
}

if (databaseUrl) {
  const check = await canConnect(serviceUrlOf(databaseUrl));
  if (check !== true) {
    say('\n  Збережені реквізити бази не підходять — запитаю заново.');
    say(`  (${check.message})`);
    databaseUrl = null;
  }
}

if (!databaseUrl) {
  step('Підключення до PostgreSQL');
  say('  Потрібен встановлений PostgreSQL. Якщо його ще немає:');
  say(
    isWindows
      ? '    https://www.postgresql.org/download/windows/ — інсталятор EDB, тисніть «Далі» скрізь'
      : '    https://postgresapp.com — завантажте, перетягніть у Програми, натисніть Initialize',
  );
  say('  Пароль, який ви задали під час установки, знадобиться тут.\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const defaults = {
    host: '127.0.0.1',
    port: '5432',
    // На Windows інсталятор створює користувача postgres із паролем.
    // На Mac Postgres.app пускає під вашим системним іменем без пароля.
    user: isWindows ? 'postgres' : userInfo().username,
  };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const host = await ask(rl, 'Адреса сервера', defaults.host);
    const port = await ask(rl, 'Порт', defaults.port);
    const user = await ask(rl, 'Користувач', defaults.user);
    const password = await ask(rl, 'Пароль (порожньо, якщо без пароля)', '');

    // Спершу перевіряємо підключення до службової бази postgres: наша ще не
    // існує, і перевіряти нею було б нічим.
    const check = await canConnect(buildUrl({ host, port, user, password, database: 'postgres' }));

    if (check === true) {
      databaseUrl = buildUrl({ host, port, user, password, database: DB_NAME });
      ok('Підключення до PostgreSQL є');
      break;
    }

    say(`\n  ✗ Не вдалося підключитися: ${check.message}`);
    if (attempt < 3) say('  Спробуймо ще раз.\n');
  }
  rl.close();

  if (!databaseUrl) {
    fail('Підключитися до бази не вдалося', [
      'Перевірте, чи запущений PostgreSQL:',
      isWindows
        ? '  Пуск → «Служби» → знайдіть postgresql-x64-16 → стан має бути «Виконується»'
        : '  Відкрийте Postgres.app — слон у рядку меню має бути активний',
    ]);
    process.exit(1);
  }

}

// Файл .env.local потрібен і самому Next.js під час запуску, тож тримаємо його
// в актуальному стані незалежно від того, звідки взявся рядок підключення.
if (!existsSync(ENV_FILE)) {
  const secret = randomBytes(32).toString('base64');
  writeFileSync(ENV_FILE, `DATABASE_URL=${databaseUrl}\nSESSION_SECRET=${secret}\n`, 'utf8');
  ok('Реквізити збережено у файл .env.local');
}

process.env.DATABASE_URL = databaseUrl;
if (!process.env.SESSION_SECRET && existsSync(ENV_FILE)) {
  const match = readFileSync(ENV_FILE, 'utf8').match(/^SESSION_SECRET=(.+)$/m);
  if (match) process.env.SESSION_SECRET = match[1].trim();
}

// ─── 3. База даних ──────────────────────────────────────────────────────────
step('База даних');
const admin = new pg.Client({ connectionString: serviceUrlOf(databaseUrl) });
await admin.connect();
const { rows: existing } = await admin.query('select 1 from pg_database where datname = $1', [DB_NAME]);
if (existing.length === 0) {
  await admin.query(`create database ${DB_NAME}`);
  ok(`Базу ${DB_NAME} створено`);
} else {
  ok(`База ${DB_NAME} вже є`);
}
await admin.end();

// ─── 4. Залежності ──────────────────────────────────────────────────────────
if (!existsSync(join(ROOT, 'node_modules', 'next'))) {
  step('Встановлення бібліотек — це разова операція, кілька хвилин');
  if (run('npm', ['install']) !== 0) {
    fail('Не вдалося встановити бібліотеки', ['Перевірте підключення до інтернету.']);
    process.exit(1);
  }
  ok('Бібліотеки встановлено');
}

// ─── 5. Схема й дані ────────────────────────────────────────────────────────
step('Схема бази');
if (run('node', ['scripts/migrate.mjs']) !== 0) {
  fail('Міграції не застосувалися', ['Текст помилки вище — надішліть його, розберемося.']);
  process.exit(1);
}

const db = new pg.Client({ connectionString: databaseUrl });
await db.connect();
const { rows: items } = await db.query('select count(*)::int as n from items');
await db.end();

if (items[0].n === 0) {
  step('Демонстраційні дані');
  say('  Заповнюю довідники VERDE: номенклатуру, рецептури, контрагентів, план HACCP.');
  say('  Для справжньої роботи натомість використовується npm run db:init — він');
  say('  створює порожню базу з вашою юрособою й без відомих паролів.\n');
  run('node', ['scripts/seed.mjs']);
}

// ─── 6. Складання ───────────────────────────────────────────────────────────
if (!existsSync(join(ROOT, '.next', 'BUILD_ID'))) {
  step('Складання застосунку — теж разово, хвилина-дві');
  if (run('npm', ['run', 'build']) !== 0) {
    fail('Складання не вдалося', ['Текст помилки вище — надішліть його, розберемося.']);
    process.exit(1);
  }
  ok('Застосунок зібрано');
}

// ─── 7. Запуск ──────────────────────────────────────────────────────────────
const url = `http://localhost:${PORT}`;
step('Запуск');
say(`  Адреса: ${url}`);
say('  Демо-акаунти, пароль verde2026:');
say('    olena@v-verde.ua  — власник, бачить усе');
say('    taras@v-verde.ua  — менеджер із продажу');
say('    iryna@v-verde.ua  — технолог');
say('    petro@v-verde.ua  — комірник');
say('\n  Щоб зупинити програму, просто закрийте це вікно.\n');

const server = spawn('npx', ['next', 'start', '--port', PORT], {
  stdio: 'inherit',
  shell: isWindows,
  env: process.env,
});

// Браузер відкриваємо із затримкою: інакше він устигає постукати раніше,
// ніж сервер почне відповідати, і показує помилку на порожньому місці.
setTimeout(() => {
  const opener = isWindows ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(opener, [url], { shell: true, stdio: 'ignore', detached: true }).unref();
}, 3500);

server.on('exit', (code) => process.exit(code ?? 0));
