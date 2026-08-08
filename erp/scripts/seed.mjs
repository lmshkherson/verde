#!/usr/bin/env node
// Довідники VERDE: користувачі, склади, номенклатура, рецептури, контрагенти.
// Скрипт ідемпотентний — повторний запуск нічого не дублює.
import pg from 'pg';
import { hashPassword } from '../lib/password.mjs';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL не заданий');
  process.exit(1);
}

const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'verde2026';

const USERS = [
  ['olena@v-verde.ua', 'Олена Ковальчук', 'owner'],
  ['taras@v-verde.ua', 'Тарас Мельник', 'sales'],
  ['iryna@v-verde.ua', 'Ірина Бондаренко', 'production'],
  ['petro@v-verde.ua', 'Петро Савченко', 'warehouse'],
];

const WAREHOUSES = [
  ['SIR', 'Склад сировини', 'raw'],
  ['GP', 'Склад готової продукції', 'finished'],
  ['CEH', 'Цех (незавершене)', 'wip'],
];

// [sku, назва, тип, од., термін днів, мін. залишок, вага г, шт/бокс, ціни...]
const ITEMS = [
  // Готова продукція — лінійка «Зарядись», 25 г, шоубокс 16 шт, термін 9 місяців.
  ['VRD-Z-PIST', 'Батончик «Зарядись» Фісташка 25 г', 'finished', 'pcs', 270, 800, 25, 16, 25.8, 35.7, 49.99],
  ['VRD-Z-ARAH', 'Батончик «Зарядись» Арахіс 25 г', 'finished', 'pcs', 270, 800, 25, 16, 25.8, 35.7, 49.99],
  ['VRD-Z-MIGD', 'Батончик «Зарядись» Мигдаль 25 г', 'finished', 'pcs', 270, 800, 25, 16, 25.8, 35.7, 49.99],
  ['VRD-Z-KOKO', 'Батончик «Зарядись» Кокос 25 г', 'finished', 'pcs', 270, 800, 25, 16, 25.8, 35.7, 49.99],
  ['VRD-Z-FUND', 'Батончик «Зарядись» Фундук 25 г', 'finished', 'pcs', 270, 800, 25, 16, 25.8, 35.7, 49.99],
  ['VRD-COLLAGEN', 'Батончик Collagen 40 г', 'finished', 'pcs', 270, 500, 40, 12, 36.6, 56.4, 78.99],

  // Сировина
  ['RAW-FINIK', 'Фініки Деглет Нур паста', 'raw', 'kg', 365, 60, null, null, null, null, null],
  ['RAW-PIST', 'Ядро фісташки', 'raw', 'kg', 300, 25, null, null, null, null, null],
  ['RAW-ARAH', 'Арахіс смажений', 'raw', 'kg', 240, 30, null, null, null, null, null],
  ['RAW-MIGD', 'Мигдаль ядро', 'raw', 'kg', 300, 25, null, null, null, null, null],
  ['RAW-KOKO', 'Кокосова стружка', 'raw', 'kg', 300, 20, null, null, null, null, null],
  ['RAW-FUND', 'Фундук ядро', 'raw', 'kg', 300, 20, null, null, null, null, null],
  ['RAW-KAKAO', 'Какао терте', 'raw', 'kg', 365, 15, null, null, null, null, null],
  ['RAW-OLIA', 'Олія кокосова', 'raw', 'kg', 365, 15, null, null, null, null, null],
  ['RAW-CYKOR', 'Сироп цикорію', 'raw', 'kg', 365, 25, null, null, null, null, null],
  ['RAW-PROTEIN', 'Ізолят горохового білка', 'raw', 'kg', 365, 20, null, null, null, null, null],
  ['RAW-COLLAG', 'Колаген пептиди', 'raw', 'kg', 545, 8, null, null, null, null, null],
  ['RAW-VITC', 'Премікс вітамін C', 'raw', 'kg', 545, 3, null, null, null, null, null],
  ['RAW-VITD3', 'Премікс вітамін D3', 'raw', 'kg', 545, 2, null, null, null, null, null],
  ['RAW-VITB12', 'Премікс вітамін B12', 'raw', 'kg', 545, 2, null, null, null, null, null],
  ['RAW-GUARANA', 'Екстракт гуарани', 'raw', 'kg', 545, 2, null, null, null, null, null],
  ['RAW-MAGNIY', 'Магній цитрат', 'raw', 'kg', 545, 3, null, null, null, null, null],
  ['RAW-OMEGA', 'Омега-3 порошок', 'raw', 'kg', 365, 3, null, null, null, null, null],

  // Пакування
  ['PAK-FLOW', 'Плівка флоу-пак', 'packaging', 'pcs', null, 20000, null, null, null, null, null],
  ['PAK-BOX', 'Шоубокс картонний', 'packaging', 'pcs', null, 1200, null, null, null, null, null],
  ['PAK-ETIK', 'Етикетка самоклейна', 'packaging', 'pcs', null, 20000, null, null, null, null, null],
];

// Рецептури на 1000 батончиків по 25 г: [sku сировини, кг на варку, % втрат]
const BASE_25 = [
  ['RAW-FINIK', 11, 2],
  ['RAW-PROTEIN', 3, 1],
  ['RAW-OLIA', 2, 1],
  ['RAW-CYKOR', 3.5, 1],
  ['RAW-VITC', 0.15, 0],
  ['PAK-FLOW', 1000, 1],
  ['PAK-ETIK', 1000, 1],
  ['PAK-BOX', 63, 0],
];

const RECIPES = [
  {
    product: 'VRD-Z-PIST',
    output: 1000,
    notes: 'Фісташка + омега-3. Темперування маси 26–28 °C, витримка 40 хв.',
    lines: [...BASE_25, ['RAW-PIST', 5, 2], ['RAW-OMEGA', 0.35, 0]],
  },
  {
    product: 'VRD-Z-ARAH',
    output: 1000,
    notes: 'Арахіс + гуарана 30 мг на батончик.',
    lines: [...BASE_25, ['RAW-ARAH', 5, 2], ['RAW-GUARANA', 0.03, 0]],
  },
  {
    product: 'VRD-Z-MIGD',
    output: 1000,
    notes: 'Мигдаль + вітамін D3.',
    lines: [...BASE_25, ['RAW-MIGD', 5, 2], ['RAW-VITD3', 0.02, 0]],
  },
  {
    product: 'VRD-Z-KOKO',
    output: 1000,
    notes: 'Кокос + магній цитрат.',
    lines: [...BASE_25, ['RAW-KOKO', 5, 3], ['RAW-MAGNIY', 0.25, 0]],
  },
  {
    product: 'VRD-Z-FUND',
    output: 1000,
    notes: 'Фундук + вітамін B12, глазур какао.',
    lines: [...BASE_25, ['RAW-FUND', 4.5, 2], ['RAW-KAKAO', 0.5, 1], ['RAW-VITB12', 0.02, 0]],
  },
  {
    product: 'VRD-COLLAGEN',
    output: 500,
    notes: 'Колагенова лінійка, 40 г. Вихід — 500 шт із варки.',
    lines: [
      ['RAW-FINIK', 8, 2],
      ['RAW-MIGD', 4, 2],
      ['RAW-COLLAG', 3, 1],
      ['RAW-KAKAO', 2, 1],
      ['RAW-OLIA', 1.5, 1],
      ['RAW-CYKOR', 1.5, 1],
      ['RAW-VITC', 0.1, 0],
      ['PAK-FLOW', 500, 1],
      ['PAK-ETIK', 500, 1],
      ['PAK-BOX', 42, 0],
    ],
  },
];

const SUPPLIERS = [
  ['ТОВ «Сухофрукт Трейд»', '38271940', 'Андрій Кравець', '+380671112233', 14],
  ['ФОП Гриценко О.П. (горіхи)', '3012345678', 'Оксана Гриценко', '+380502223344', 7],
  ['ТОВ «Нутрі Інгредієнтс»', '41902847', 'Сергій Лисенко', '+380443334455', 30],
  ['ТОВ «ПакЛайн Україна»', '39284710', 'Марина Дудник', '+380445556677', 21],
];

const CUSTOMERS = [
  ['ТОВ «АТБ-Маркет»', 'network', '30487219', 'Ігор Панченко', '+380563334455', 'network', 45, 500000],
  ['ТОВ «Фора»', 'network', '31859472', 'Наталія Гунько', '+380442223311', 'network', 30, 300000],
  ['ТОВ «Здоров’я Дистрибʼюшн»', 'distributor', '40218374', 'Дмитро Сич', '+380671234567', 'distributor', 14, 200000],
  ['Аптека «Бажаємо здоровʼя»', 'pharmacy', '39471028', 'Леся Ткач', '+380509876543', 'distributor', 7, 50000],
  ['Мережа кав’ярень «Ранок»', 'horeca', '42917583', 'Богдан Мороз', '+380931112244', 'rrp', 0, 20000],
];

const client = new pg.Client({
  connectionString,
  ssl: /supabase|amazonaws|render|neon/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
});
await client.connect();

try {
  await client.query('begin');

  for (const [email, name, role] of USERS) {
    await client.query(
      `insert into app_users (email, full_name, role, password_hash)
       values ($1, $2, $3, $4)
       on conflict (lower(email)) do update set full_name = excluded.full_name, role = excluded.role`,
      [email, name, role, await hashPassword(DEMO_PASSWORD)],
    );
  }

  for (const [code, name, kind] of WAREHOUSES) {
    await client.query(
      `insert into warehouses (code, name, kind) values ($1, $2, $3)
       on conflict (code) do update set name = excluded.name`,
      [code, name, kind],
    );
  }

  for (const [sku, name, kind, unit, shelf, min, weight, box, pd, pn, prrp] of ITEMS) {
    await client.query(
      `insert into items (sku, name, kind, unit, shelf_life_days, min_stock, weight_g, pcs_per_box,
                          price_distributor, price_network, price_rrp)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (sku) do update set
         name = excluded.name, min_stock = excluded.min_stock,
         price_distributor = excluded.price_distributor,
         price_network = excluded.price_network,
         price_rrp = excluded.price_rrp`,
      [sku, name, kind, unit, shelf, min, weight, box, pd, pn, prrp],
    );
  }

  for (const recipe of RECIPES) {
    const { rows: exists } = await client.query(
      `select r.id from recipes r join items i on i.id = r.product_item_id where i.sku = $1`,
      [recipe.product],
    );

    let recipeId = exists[0]?.id;
    if (!recipeId) {
      const { rows } = await client.query(
        `insert into recipes (product_item_id, version, output_qty, notes)
         values ((select id from items where sku = $1), 1, $2, $3) returning id`,
        [recipe.product, recipe.output, recipe.notes],
      );
      recipeId = rows[0].id;
    }

    for (const [sku, qty, loss] of recipe.lines) {
      await client.query(
        `insert into recipe_lines (recipe_id, item_id, qty_per_batch, loss_pct)
         values ($1, (select id from items where sku = $2), $3, $4)
         on conflict (recipe_id, item_id) do update
           set qty_per_batch = excluded.qty_per_batch, loss_pct = excluded.loss_pct`,
        [recipeId, sku, qty, loss],
      );
    }
  }

  for (const [name, edrpou, contact, phone, terms] of SUPPLIERS) {
    const { rows } = await client.query('select id from suppliers where name = $1', [name]);
    if (rows.length === 0) {
      await client.query(
        `insert into suppliers (name, edrpou, contact, phone, payment_terms_days)
         values ($1, $2, $3, $4, $5)`,
        [name, edrpou, contact, phone, terms],
      );
    }
  }

  for (const [name, kind, edrpou, contact, phone, level, terms, limit] of CUSTOMERS) {
    const { rows } = await client.query('select id from customers where name = $1', [name]);
    if (rows.length === 0) {
      await client.query(
        `insert into customers (name, kind, edrpou, contact, phone, price_level, payment_terms_days, credit_limit)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [name, kind, edrpou, contact, phone, level, terms, limit],
      );
    }
  }

  await client.query('commit');
  console.log(
    `Довідники заповнено: ${USERS.length} користувачів, ${ITEMS.length} позицій, ` +
      `${RECIPES.length} рецептур, ${SUPPLIERS.length} постачальників, ${CUSTOMERS.length} клієнтів.`,
  );
  console.log(`Пароль для всіх демо-акаунтів: ${DEMO_PASSWORD}`);
} catch (err) {
  await client.query('rollback');
  console.error(err.message);
  process.exit(1);
} finally {
  await client.end();
}
