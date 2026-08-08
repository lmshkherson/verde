#!/usr/bin/env node
/**
 * Наскрізна перевірка через справжній інтерфейс, дві юрособи з різним податковим
 * статусом:
 *
 *   ТОВ «Верде Фудс» (платник ПДВ) — закуповує сировину, виробляє, продає мережі
 *   ФОП «Верде Роздріб» (єдиний податок) — купує в ТОВ і продає в роздріб
 *
 * Головне, що доводить сценарій: вхідний ПДВ по-різному лягає в собівартість,
 * тож одна фізична партія коштує різне залежно від власника.
 *
 * Запуск: BASE_URL=http://127.0.0.1:3100 node scripts/e2e.mjs
 */
import { globSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_PASSWORD ?? 'verde2026';

let failures = 0;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
};

const money = (text) =>
  Number(String(text).replace(/[^\d,.-]/g, '').replace(/\s/g, '').replace(',', '.'));

const near = (a, b, eps = 0.05) => Math.abs(a - b) < eps;

async function selectByText(page, selector, substring) {
  const value = await page
    .locator(`${selector} option`, { hasText: substring })
    .first()
    .getAttribute('value');
  if (!value) throw new Error(`У списку ${selector} немає пункту «${substring}»`);
  await page.selectOption(selector, value);
}

/** Значення з плитки-показника: підпис, під ним число. */
async function stat(page, label) {
  return money(await page.locator(`text=${label}`).first().locator('..').locator('div').nth(1).innerText());
}

/** Собівартість позиції на складі поточної юрособи. */
async function stockCost(page, kind, itemName) {
  await page.goto(`${BASE}/stock?kind=${kind}`);
  const row = page.locator('tr', { hasText: itemName }).first();
  const cells = await row.locator('td').allInnerTexts();
  return { cost: money(cells[4]), qty: money(cells[1]), raw: cells.join(' | ') };
}

const preinstalled = globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome')[0];
const browser = await chromium.launch(preinstalled ? { executablePath: preinstalled } : {});

async function session(email) {
  const context = await browser.newContext({ locale: 'uk-UA', viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/`);
  return page;
}

async function switchEntity(page, name) {
  await selectByText(page, 'aside select[name="entity_id"]', name);
  await page.waitForTimeout(900);
}

async function createPurchase(page, supplier, lines, pricesIncludeVat = true) {
  await page.goto(`${BASE}/purchasing`);
  await selectByText(page, 'select[name="supplier_id"]', supplier);
  if (!pricesIncludeVat) await page.uncheck('input[name="prices_include_vat"]');
  await page.click('form:has(select[name="supplier_id"]) button[type="submit"]');
  await page.waitForURL(/\/purchasing\/[0-9a-f-]{36}/);

  for (const [name, qty, price] of lines) {
    await selectByText(page, 'select[name="item_id"]', name);
    await page.fill('input[name="qty"]', String(qty));
    await page.fill('input[name="unit_price"]', String(price));
    await page.click('form:has(select[name="item_id"]) button[type="submit"]');
    await page.waitForTimeout(320);
  }

  await page.click('form:has(input[name="po_id"]) button:has-text("Замовлено")');
  await page.waitForTimeout(400);
  await page.reload();
  await page.click('button:has-text("Оприбуткувати на склад")');
  await page.waitForTimeout(1400);
  await page.reload();
  return page.url();
}

try {
  // ─── 1. ТОВ на ПДВ: закупівля у платника і в неплатника ────────────────────
  console.log('\nТОВ «Верде Фудс» — закупівля сировини');
  const warehouse = await session('petro@v-verde.ua');

  await createPurchase(warehouse, 'Сухофрукт Трейд', [
    ['Фініки Деглет Нур паста', 200, 182.5],
    ['Ізолят горохового білка', 50, 340],
    ['Олія кокосова', 40, 220],
    ['Сироп цикорію', 60, 165],
    ['Премікс вітамін C', 5, 1200],
    ['Омега-3 порошок', 5, 1800],
    ['Плівка флоу-пак', 25000, 0.85],
    ['Етикетка самоклейна', 25000, 0.35],
    ['Шоубокс картонний', 1500, 6.2],
  ]);
  check('прихід від платника ПДВ проведено', (await warehouse.locator('text=Отримано').count()) > 0);

  // Горіхи беремо у ФОП без ПДВ — кредиту з цієї ціни бути не може.
  await createPurchase(warehouse, 'Гриценко', [['Ядро фісташки', 60, 615]]);
  check('прихід від неплатника ПДВ проведено', (await warehouse.locator('text=Отримано').count()) > 0);

  const owner = await session('olena@v-verde.ua');

  const finiky = await stockCost(owner, 'raw', 'Фініки');
  check(
    'ПДВ не потрапив у собівартість: фініки 182,50 з ПДВ → 152,08 на складі',
    near(finiky.cost, 182.5 / 1.2, 0.02),
    `${finiky.cost} грн/кг`,
  );

  const pistachio = await stockCost(owner, 'raw', 'фісташки');
  check(
    'від неплатника ПДВ у собівартість пішла вся ціна',
    near(pistachio.cost, 615, 0.02),
    `${pistachio.cost} грн/кг`,
  );

  // ─── 2. Виробництво в ТОВ ──────────────────────────────────────────────────
  console.log('\nТОВ «Верде Фудс» — виробництво');
  const production = await session('iryna@v-verde.ua');

  await production.goto(`${BASE}/production`);
  await selectByText(production, 'select[name="recipe_id"]', 'Фісташка');
  await production.fill('input[name="planned_qty"]', '1000');
  await production.click('form:has(select[name="recipe_id"]) button[type="submit"]');
  await production.waitForURL(/\/production\/[0-9a-f-]{36}/);

  check('сировини вистачає', (await production.locator('text=бракує').count()) === 0);

  await production.click('button:has-text("Почати")');
  await production.waitForTimeout(500);
  await production.reload();

  await production.fill('input[name="produced_qty"]', '980');
  await production.fill('input[name="overhead_cost"]', '4200');
  await production.waitForTimeout(300);
  await production.click('button:has-text("Закрити варку")');
  await production.waitForTimeout(1600);
  await production.reload();
  check('варку закрито', (await production.locator('text=Завершено').count()) > 0);

  const factoryCost = await stat(production, 'Собівартість одиниці');
  check('собівартість випуску порахована', factoryCost > 0, `${factoryCost} грн/шт`);

  // ─── 3. Продаж мережі з ПДВ ────────────────────────────────────────────────
  console.log('\nТОВ «Верде Фудс» — продаж мережі');
  const sales = await session('taras@v-verde.ua');

  await sales.goto(`${BASE}/sales`);
  await selectByText(sales, 'select[name="customer_id"]', 'АТБ-Маркет');
  await sales.click('form:has(select[name="customer_id"]) button[type="submit"]');
  await sales.waitForURL(/\/sales\/[0-9a-f-]{36}/);

  await selectByText(sales, 'select[name="item_id"]', 'Фісташка');
  await sales.fill('input[name="qty"]', '640');
  await sales.click('form:has(select[name="item_id"]) button[type="submit"]');
  await sales.waitForTimeout(700);
  await sales.reload();

  const grossTotal = await stat(sales, 'Сума з ПДВ');
  check(
    'ціна без ПДВ 29,75 × 640 + 20% = 22 848 грн',
    near(grossTotal, 640 * 29.75 * 1.2, 1),
    `${grossTotal} грн`,
  );

  await sales.click('button:has-text("Підтвердити")');
  await sales.waitForTimeout(600);
  await sales.reload();
  await sales.fill('input[name="ttn_number"]', '59000123456789');
  await sales.click('button:has-text("Провести відвантаження")');
  await sales.waitForTimeout(1600);
  await sales.reload();
  check('замовлення відвантажено', (await sales.locator('text=Відвантажено').count()) > 0);

  const marginText = await sales.locator('text=Маржа').first().locator('..').innerText();
  check(
    'маржа рахується від бази без ПДВ',
    marginText.includes('без ПДВ'),
    marginText.replace(/\s+/g, ' ').trim(),
  );

  // ─── 4. Реалізація власній юрособі ─────────────────────────────────────────
  console.log('\nРеалізація між своїми: ТОВ → ФОП');
  await sales.goto(`${BASE}/sales`);
  await selectByText(sales, 'select[name="customer_id"]', 'наша роздрібна');
  await sales.click('form:has(select[name="customer_id"]) button[type="submit"]');
  await sales.waitForURL(/\/sales\/[0-9a-f-]{36}/);

  await selectByText(sales, 'select[name="item_id"]', 'Фісташка');
  await sales.fill('input[name="qty"]', '300');
  await sales.click('form:has(select[name="item_id"]) button[type="submit"]');
  await sales.waitForTimeout(700);
  await sales.reload();
  await sales.click('button:has-text("Підтвердити")');
  await sales.waitForTimeout(600);
  await sales.reload();
  await sales.click('button:has-text("Провести відвантаження")');
  await sales.waitForTimeout(1600);
  await sales.reload();
  check('внутрішня реалізація проведена', (await sales.locator('text=Відвантажено').count()) > 0);

  // ─── 5. Та сама партія — різна собівартість ────────────────────────────────
  console.log('\nСобівартість однієї партії у двох юросіб');
  const tovStock = await stockCost(owner, 'finished', 'Фісташка');
  check(
    'у ТОВ лишилось 40 шт за виробничою собівартістю',
    near(tovStock.qty, 40, 0.5) && near(tovStock.cost, factoryCost, 0.05),
    `${tovStock.qty} шт по ${tovStock.cost} грн`,
  );

  await switchEntity(owner, 'Верде Роздріб');
  const fopStock = await stockCost(owner, 'finished', 'Фісташка');
  check(
    'у ФОП з’явилось 300 шт тієї самої партії',
    near(fopStock.qty, 300, 0.5),
    `${fopStock.qty} шт по ${fopStock.cost} грн`,
  );
  check(
    'ФОП не відшкодовує ПДВ, тож його собівартість = 21,50 × 1,2 = 25,80',
    near(fopStock.cost, 21.5 * 1.2, 0.05),
    `${fopStock.cost} грн/шт`,
  );
  check(
    'собівартість однієї партії різна у двох юросіб',
    !near(fopStock.cost, tovStock.cost, 0.5),
    `ТОВ ${tovStock.cost} проти ФОП ${fopStock.cost} грн`,
  );

  // ─── 6. ФОП продає в роздріб без ПДВ ───────────────────────────────────────
  console.log('\nФОП «Верде Роздріб» — продаж без ПДВ');
  await switchEntity(sales, 'Верде Роздріб');
  await sales.goto(`${BASE}/sales`);
  await selectByText(sales, 'select[name="customer_id"]', 'Ранок');
  await sales.click('form:has(select[name="customer_id"]) button[type="submit"]');
  await sales.waitForURL(/\/sales\/[0-9a-f-]{36}/);

  await selectByText(sales, 'select[name="item_id"]', 'Фісташка');
  await sales.fill('input[name="qty"]', '100');
  await sales.click('form:has(select[name="item_id"]) button[type="submit"]');
  await sales.waitForTimeout(700);
  await sales.reload();

  const fopTotal = await stat(sales, 'Сума з ПДВ');
  check(
    'єдинник не нараховує ПДВ: 41,66 × 100 без податку зверху',
    near(fopTotal, 100 * 41.66, 1),
    `${fopTotal} грн`,
  );

  // ─── 7. Реєстр ПДВ у власника ──────────────────────────────────────────────
  console.log('\nВласник — реєстр ПДВ');
  await switchEntity(owner, 'Верде Фудс');
  await owner.goto(`${BASE}/reports`);

  const vatRow = await owner.locator('table:below(:text("ПДВ за періодами")) tr').nth(1).innerText();
  const [liability, credit, payable] = vatRow
    .split('\t')
    .slice(1)
    .map(money);

  check('податкове зобов’язання з продажу мережі', near(liability, 640 * 29.75 * 0.2 + 300 * 21.5 * 0.2, 1), `${liability} грн`);
  check('податковий кредит із закупівель', credit > 0, `${credit} грн`);
  check('ПДВ до сплати = зобов’язання − кредит', near(payable, liability - credit, 1), `${payable} грн`);

  await owner.goto(`${BASE}/entities`);
  check(
    'обидві юрособи видно у власника',
    (await owner.locator('text=Верде Роздріб').count()) > 0 &&
      (await owner.locator('text=Верде Фудс').count()) > 0,
  );

  // ─── 8. Права доступу ──────────────────────────────────────────────────────
  console.log('\nПрава доступу');
  const denied = await warehouse.goto(`${BASE}/reports`);
  check('комірника не пускає у звіти', denied.url().includes('denied=1'));
  const denied2 = await sales.goto(`${BASE}/entities`);
  check('менеджера не пускає до юросіб', denied2.url().includes('denied=1'));
} catch (err) {
  console.error(`\nПомилка сценарію: ${err.message}`);
  failures += 1;
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nУсі перевірки пройдено.' : `\nПровалено перевірок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
