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

/** Перше число з тексту. Поруч часто стоять дати й інші суми, тож беремо саме перше. */
const money = (text) => {
  const match = String(text).match(/-?\d[\d\s\u00a0]*(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(/[\s\u00a0]/g, '').replace(',', '.')) : NaN;
};

const near = (a, b, eps = 0.05) => Math.abs(a - b) < eps;

async function selectByText(page, selector, substring) {
  const value = await page
    .locator(`${selector} option`, { hasText: substring })
    .first()
    .getAttribute('value');
  if (!value) throw new Error(`У списку ${selector} немає пункту «${substring}»`);
  await page.selectOption(selector, value);
}

/** Значення з плитки-показника за її підписом. */
async function stat(page, label) {
  return money(await page.locator(`[data-stat="${label}"] [data-stat-value]`).first().innerText());
}

/** Комірки рядка таблиці за підрядком у ньому. */
async function rowCells(page, substring) {
  return page.locator('tr', { hasText: substring }).first().locator('td').allInnerTexts();
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
  await production.waitForTimeout(300);

  // За політикою «витрати періоду» поля накладних у закритті варки бути не повинно.
  check(
    'накладні не запитуються при закритті варки',
    (await production.locator('input[name="overhead_cost"]').count()) === 0,
  );

  await production.click('button:has-text("Закрити варку")');
  await production.waitForTimeout(1600);
  await production.reload();
  check('варку закрито', (await production.locator('text=Завершено').count()) > 0);

  const factoryCost = await stat(production, 'Собівартість одиниці');
  check(
    'собівартість партії — лише сировина, без цеху',
    factoryCost > 0 && factoryCost < 10,
    `${factoryCost} грн/шт`,
  );

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

  // ─── 8. Кредиторка: борг постачальнику з ПДВ ───────────────────────────────
  console.log('\nКредиторка перед постачальниками');
  await warehouse.goto(`${BASE}/purchasing/suppliers`);

  const suhoCells = await rowCells(warehouse, 'Сухофрукт');
  const billed = money(suhoCells[3]);
  const debt = money(suhoCells[5]);
  check(
    'борг постачальнику — повна сума з ПДВ, а не собівартість',
    near(billed, 126500, 1) && near(debt, 126500, 1),
    `нараховано ${billed}, борг ${debt} грн`,
  );

  // Платимо половину — борг має зменшитись рівно на суму платежу.
  await selectByText(warehouse, 'form:has(input[name="amount"]) select[name="supplier_id"]', 'Сухофрукт');
  await warehouse.fill('input[name="amount"]', '60000');
  await warehouse.click('button:has-text("Записати оплату")');
  await warehouse.waitForTimeout(1200);
  await warehouse.reload();

  const afterPay = await rowCells(warehouse, 'Сухофрукт');
  check('оплата зменшила кредиторку', near(money(afterPay[5]), 66500, 1), `${money(afterPay[5])} грн`);

  // ─── 9. Фінансовий результат ───────────────────────────────────────────────
  console.log('\nЗвіт про фінансовий результат');
  await owner.goto(`${BASE}/pl`);

  const revenue = await stat(owner, 'Дохід без ПДВ');
  const grossProfit = await stat(owner, 'Валовий прибуток');
  const result = await stat(owner, 'Фінансовий результат');

  // Мережа 640 × 29,75 + власний ФОП 300 × 21,50
  check(
    'у дохід потрапила сума БЕЗ ПДВ',
    near(revenue, 640 * 29.75 + 300 * 21.5, 1),
    `${revenue} грн`,
  );
  check('до оплати праці валовий = дохід − собівартість', grossProfit > 0, `${grossProfit} грн`);
  check('без операційних витрат результат = валовому', near(result, grossProfit, 1), `${result} грн`);

  // Вносимо оренду й перевіряємо, що в P&L лягла база, а ПДВ пішов у кредит.
  await owner.selectOption('select[name="category"]', 'rent');
  await owner.fill('input[name="amount_net"]', '25000');
  await owner.fill('input[name="vat_amount"]', '5000');
  await owner.fill('input[name="description"]', 'Оренда цеху');
  await owner.click('button:has-text("Записати витрату")');
  await owner.waitForTimeout(1300);
  await owner.reload();

  const resultAfter = await stat(owner, 'Фінансовий результат');
  check(
    'у витрати пішла база 25 000, а не 30 000 з ПДВ',
    near(resultAfter, result - 25000, 1),
    `${resultAfter} грн`,
  );

  const vatBlock = await owner
    .locator('text=Довідково — поза фінансовим результатом')
    .locator('..')
    .innerText();
  check(
    'ПДВ, дебіторка й кредиторка показані поза фінрезультатом',
    vatBlock.includes('Дебіторка') && vatBlock.includes('Кредиторка'),
    vatBlock.replace(/\s+/g, ' ').slice(0, 140),
  );

  const receivable = money(vatBlock.split('Дебіторка (з ПДВ)')[1]);
  check(
    'дебіторка — з ПДВ (22 848 + 7 740)',
    near(receivable, 22848 + 7740, 1),
    `${receivable} грн`,
  );

  // ─── 10. Витрати цеху — окремою статтею, а не в собівартості ───────────────
  console.log('\nВиробничі витрати періоду');
  const beforeShop = await stat(owner, 'Фінансовий результат');
  const grossBefore = await stat(owner, 'Валовий прибуток');

  await owner.selectOption('select[name="category"]', 'production_salary');
  await owner.fill('input[name="amount_net"]', '18000');
  await owner.fill('input[name="vat_amount"]', '0');
  await owner.fill('input[name="description"]', 'Зарплата цеху за місяць');
  await owner.click('button:has-text("Записати витрату")');
  await owner.waitForTimeout(1300);

  await owner.selectOption('select[name="category"]', 'production_energy');
  await owner.fill('input[name="amount_net"]', '6000');
  await owner.fill('input[name="vat_amount"]', '1200');
  await owner.fill('input[name="description"]', 'Електроенергія цеху');
  await owner.click('button:has-text("Записати витрату")');
  await owner.waitForTimeout(1300);
  await owner.reload();

  const grossAfter = await stat(owner, 'Валовий прибуток');
  const afterShop = await stat(owner, 'Фінансовий результат');

  check(
    'витрати цеху не чіпають валовий прибуток',
    near(grossAfter, grossBefore, 1),
    `${grossAfter} грн`,
  );
  check(
    'витрати цеху зменшили результат на 24 000 без ПДВ',
    near(afterShop, beforeShop - 24000, 1),
    `${afterShop} грн`,
  );

  const plText = await owner
    .locator('text=Виробничі витрати періоду')
    .first()
    .locator('../..')
    .innerText();
  check(
    'у звіті вони стоять окремим рядком',
    plText.includes('24') && plText.includes('не входять у вартість партії'),
    plText.replace(/\s+/g, ' ').slice(0, 110),
  );

  // Повна вартість одиниці: сировина + цех, рознесений на випуск.
  const fullCostRow = await rowCells(owner, 'Повна вартість одиниці');
  const fullCost = money(fullCostRow[1]);
  check(
    'управлінська повна вартість = сировина + цех/випуск',
    near(fullCost, factoryCost + 24000 / 980, 0.05),
    `${fullCost} грн/шт проти ${factoryCost} в обліку`,
  );

  // ─── 11. Права доступу ─────────────────────────────────────────────────────
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
