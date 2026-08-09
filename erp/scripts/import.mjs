#!/usr/bin/env node
/**
 * Імпорт даних із CSV — найбільша частина роботи при переході на систему.
 *
 *   node scripts/import.mjs items      номенклатура.csv
 *   node scripts/import.mjs customers  клієнти.csv
 *   node scripts/import.mjs suppliers  постачальники.csv
 *   node scripts/import.mjs employees  працівники.csv --entity "Верде Світ"
 *   node scripts/import.mjs stock      залишки.csv     --entity "Верде Світ"
 *   node scripts/import.mjs balances   сальдо.csv      --entity "Верде Світ"
 *
 * Додайте --dry-run, щоб побачити, що буде зроблено, нічого не змінюючи.
 * Усі імпорти ідемпотентні за ключем: повторний запуск оновлює, а не дублює.
 */
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { num, parseCsv, str, strOrNull } from '../lib/csv.mjs';
import { normalizeEan } from '../lib/barcode.mjs';

const [, , kind, file, ...rest] = process.argv;
const dryRun = rest.includes('--dry-run');
const entityName = (() => {
  const i = rest.indexOf('--entity');
  return i >= 0 ? rest[i + 1] : null;
})();

const KINDS = ['items', 'customers', 'suppliers', 'employees', 'stock', 'balances'];

if (!kind || !file || !KINDS.includes(kind)) {
  console.error(`Використання: node scripts/import.mjs <${KINDS.join('|')}> файл.csv [--entity "Назва"] [--dry-run]`);
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL не заданий');
  process.exit(1);
}

const rows = parseCsv(await readFile(file, 'utf8'));
if (rows.length === 0) {
  console.error('Файл порожній або не розібрався');
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: /supabase|amazonaws|render|neon/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
});
await client.connect();

/** Юрособа потрібна там, де дані належать конкретній компанії. */
async function resolveEntity() {
  if (!entityName) {
    const { rows: def } = await client.query(
      'select id, short_name from legal_entities where is_default limit 1',
    );
    if (!def[0]) throw new Error('Не знайдено юрособи за замовчуванням — вкажіть --entity');
    return def[0];
  }
  const { rows: found } = await client.query(
    'select id, short_name from legal_entities where lower(short_name) = lower($1)',
    [entityName],
  );
  if (!found[0]) throw new Error(`Юрособу «${entityName}» не знайдено`);
  return found[0];
}

/**
 * Штрихкод із файлу приймається лише коректний: помилкова контрольна цифра в
 * імпорті розійдеться по всіх майбутніх накладних, і знайти її буде важко.
 */
function barcode(raw, sku) {
  const value = strOrNull(raw);
  if (!value) return null;
  const result = normalizeEan(value);
  if ('error' in result) throw new Error(`Штрихкод у рядку ${sku}: ${result.error}`);
  return result.ean;
}

const handlers = {
  // sku;назва;тип;одиниця;термін_днів;мін_залишок;вага_г;шт_у_боксі;ціна_дистриб;ціна_мережа;ррц;уктзед;код_одиниці;штрихкод
  async items() {
    let count = 0;
    for (const r of rows) {
      const sku = str(r.sku);
      if (!sku) continue;
      await client.query(
        `insert into items (sku, name, kind, unit, shelf_life_days, min_stock, weight_g, pcs_per_box,
                            price_distributor, price_network, price_rrp, uktzed, uom_code, barcode)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         on conflict (sku) do update set
           name = excluded.name, kind = excluded.kind, unit = excluded.unit,
           shelf_life_days = excluded.shelf_life_days, min_stock = excluded.min_stock,
           weight_g = excluded.weight_g, pcs_per_box = excluded.pcs_per_box,
           price_distributor = excluded.price_distributor, price_network = excluded.price_network,
           price_rrp = excluded.price_rrp, uktzed = excluded.uktzed, uom_code = excluded.uom_code,
           barcode = coalesce(excluded.barcode, items.barcode)`,
        [
          sku,
          str(r['назва']),
          str(r['тип']) || 'raw',
          str(r['одиниця']) || 'kg',
          num(r['термін_днів']) || null,
          num(r['мін_залишок']),
          num(r['вага_г']) || null,
          num(r['шт_у_боксі']) || null,
          num(r['ціна_дистриб']) || null,
          num(r['ціна_мережа']) || null,
          num(r['ррц']) || null,
          strOrNull(r['уктзед']),
          strOrNull(r['код_одиниці']),
          barcode(r['штрихкод'], sku),
        ],
      );
      count += 1;
    }
    return count;
  },

  // назва;тип;єдрпоу;іпн;платник_пдв;контакт;телефон;прайс;відтермінування;кредитний_ліміт;адреса
  async customers() {
    let count = 0;
    for (const r of rows) {
      const name = str(r['назва']);
      if (!name) continue;
      const { rows: exists } = await client.query('select id from customers where name = $1', [name]);
      const params = [
        name,
        str(r['тип']) || 'network',
        strOrNull(r['єдрпоу']),
        strOrNull(r['іпн']),
        str(r['платник_пдв']).toLowerCase() !== 'ні',
        strOrNull(r['контакт']),
        strOrNull(r['телефон']),
        str(r['прайс']) || 'distributor',
        num(r['відтермінування']),
        num(r['кредитний_ліміт']),
        strOrNull(r['адреса']),
        strOrNull(r['адреса_доставки']),
        strOrNull(r['iban']),
        strOrNull(r['банк']),
      ];
      if (exists[0]) {
        await client.query(
          `update customers set name=$1, kind=$2, edrpou=$3, ipn=$4, is_vat_payer=$5, contact=$6,
                                phone=$7, price_level=$8, payment_terms_days=$9, credit_limit=$10,
                                address=coalesce($11, address),
                                delivery_address=coalesce($12, delivery_address),
                                iban=coalesce($13, iban), bank_name=coalesce($14, bank_name)
            where id = $15`,
          [...params, exists[0].id],
        );
      } else {
        await client.query(
          `insert into customers (name, kind, edrpou, ipn, is_vat_payer, contact, phone,
                                  price_level, payment_terms_days, credit_limit, address,
                                  delivery_address, iban, bank_name)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          params,
        );
      }
      count += 1;
    }
    return count;
  },

  // назва;єдрпоу;платник_пдв;контакт;телефон;відтермінування
  async suppliers() {
    let count = 0;
    for (const r of rows) {
      const name = str(r['назва']);
      if (!name) continue;
      const { rows: exists } = await client.query('select id from suppliers where name = $1', [name]);
      const params = [
        name,
        strOrNull(r['єдрпоу']),
        str(r['платник_пдв']).toLowerCase() !== 'ні',
        strOrNull(r['контакт']),
        strOrNull(r['телефон']),
        num(r['відтермінування']),
        strOrNull(r['адреса']),
        strOrNull(r['адреса_складу']),
        strOrNull(r['iban']),
        strOrNull(r['банк']),
      ];
      if (exists[0]) {
        await client.query(
          `update suppliers set name=$1, edrpou=$2, is_vat_payer=$3, contact=$4, phone=$5,
                                payment_terms_days=$6,
                                address=coalesce($7, address),
                                warehouse_address=coalesce($8, warehouse_address),
                                iban=coalesce($9, iban), bank_name=coalesce($10, bank_name)
            where id=$11`,
          [...params, exists[0].id],
        );
      } else {
        await client.query(
          `insert into suppliers (name, edrpou, is_vat_payer, contact, phone, payment_terms_days,
                                  address, warehouse_address, iban, bank_name)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          params,
        );
      }
      count += 1;
    }
    return count;
  },

  // піб;посада;підрозділ;оклад;поведінка;прийнятий
  async employees() {
    const entity = await resolveEntity();
    let count = 0;
    for (const r of rows) {
      const name = str(r['піб']);
      if (!name) continue;
      const { rows: exists } = await client.query(
        'select id from employees where legal_entity_id = $1 and full_name = $2',
        [entity.id, name],
      );
      const params = [
        entity.id,
        name,
        strOrNull(r['посада']),
        str(r['підрозділ']) || 'production',
        num(r['оклад']),
        str(r['поведінка']) || 'variable',
        strOrNull(r['прийнятий']),
      ];
      if (exists[0]) {
        await client.query(
          `update employees set legal_entity_id=$1, full_name=$2, position=$3, department=$4,
                                monthly_salary=$5, cost_behavior=$6, hired_on=$7
            where id = $8`,
          [...params, exists[0].id],
        );
      } else {
        await client.query(
          `insert into employees (legal_entity_id, full_name, position, department, monthly_salary,
                                  cost_behavior, hired_on)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          params,
        );
      }
      count += 1;
    }
    return count;
  },

  /**
   * Складські залишки на дату переходу.
   * sku;склад;партія;придатна_до;кількість;собівартість;дата
   *
   * Заводиться як рух типу «Початковий залишок» — тобто входить у систему тим
   * самим шляхом, що й усе інше, і його видно в журналі.
   */
  async stock() {
    const entity = await resolveEntity();
    let count = 0;

    for (const r of rows) {
      const sku = str(r.sku);
      const qty = num(r['кількість']);
      if (!sku || qty === 0) continue;

      const { rows: item } = await client.query('select id, shelf_life_days from items where sku = $1', [sku]);
      if (!item[0]) throw new Error(`Номенклатуру ${sku} не знайдено — спершу імпортуйте items`);

      const warehouseCode = str(r['склад']) || 'SIR';
      const { rows: wh } = await client.query('select id from warehouses where code = $1', [warehouseCode]);
      if (!wh[0]) throw new Error(`Склад ${warehouseCode} не знайдено`);

      const asOf = str(r['дата']) || new Date().toISOString().slice(0, 10);
      const batchCode = str(r['партія']) || `ВХІД/${sku}`;

      const { rows: batch } = await client.query(
        `insert into batches (item_id, code, produced_on, expires_on, source)
         values ($1, $2, $3, $4, 'opening')
         on conflict (item_id, code) do update set expires_on = excluded.expires_on
         returning id`,
        [item[0].id, batchCode, asOf, strOrNull(r['придатна_до'])],
      );

      // Повторний імпорт не має подвоювати залишок: спершу знімаємо попередній вхідний рух.
      await client.query(
        `delete from stock_moves
          where legal_entity_id = $1 and item_id = $2 and batch_id = $3 and move_type = 'opening'`,
        [entity.id, item[0].id, batch[0].id],
      );

      await client.query(
        `insert into stock_moves (item_id, legal_entity_id, batch_id, warehouse_id, qty, unit_cost,
                                  move_type, doc_type, note, moved_at)
         values ($1,$2,$3,$4,$5,$6,'opening','opening','Початковий залишок при переході',$7)`,
        [item[0].id, entity.id, batch[0].id, wh[0].id, qty, num(r['собівартість']), asOf],
      );
      count += 1;
    }
    return count;
  },

  // рахунок;дебет;кредит;дата
  async balances() {
    const entity = await resolveEntity();
    let count = 0;
    for (const r of rows) {
      const code = str(r['рахунок']);
      if (!code) continue;
      const { rows: acc } = await client.query('select code from chart_of_accounts where code = $1', [code]);
      if (!acc[0]) throw new Error(`Рахунку ${code} немає в плані рахунків`);

      await client.query(
        `insert into opening_balances (legal_entity_id, code, as_of, debit, credit)
         values ($1,$2,$3,$4,$5)
         on conflict (legal_entity_id, code, as_of) do update
           set debit = excluded.debit, credit = excluded.credit`,
        [entity.id, code, str(r['дата']) || new Date().toISOString().slice(0, 10), num(r['дебет']), num(r['кредит'])],
      );
      count += 1;
    }
    return count;
  },
};

try {
  await client.query('begin');
  const count = await handlers[kind]();

  if (dryRun) {
    await client.query('rollback');
    console.log(`Пробний запуск: опрацьовано б ${count} рядків. Змін не збережено.`);
  } else {
    await client.query('commit');
    console.log(`Імпортовано рядків: ${count}`);
  }

  // Для сальдо одразу показуємо, чи сходиться дебет із кредитом.
  if (kind === 'balances' && !dryRun) {
    const { rows: check } = await client.query(
      `select sum(debit) as debit, sum(credit) as credit from opening_balances
        where legal_entity_id = (select id from legal_entities where lower(short_name) = lower($1) or ($1 is null and is_default) limit 1)`,
      [entityName],
    );
    const diff = Number(check[0].debit) - Number(check[0].credit);
    console.log(
      Math.abs(diff) < 0.01
        ? 'Вхідне сальдо збалансоване: дебет дорівнює кредиту.'
        : `УВАГА: дебет і кредит не сходяться на ${diff.toFixed(2)} грн — баланс не зійдеться.`,
    );
  }
} catch (err) {
  await client.query('rollback');
  console.error(`Помилка: ${err.message}`);
  process.exit(1);
} finally {
  await client.end();
}
