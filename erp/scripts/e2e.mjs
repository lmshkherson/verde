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

const current = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

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

  await owner.selectOption('select[name="category"]', 'production_energy');
  await owner.fill('input[name="amount_net"]', '6000');
  await owner.fill('input[name="vat_amount"]', '1200');
  await owner.selectOption('select[name="cost_behavior"]', 'variable');
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
    'енергія цеху зменшила результат на 6 000 без ПДВ',
    near(afterShop, beforeShop - 6000, 1),
    `${afterShop} грн`,
  );

  const plText = await owner
    .locator('text=Виробничі витрати періоду')
    .first()
    .locator('../..')
    .innerText();
  check(
    'у звіті вони стоять окремим рядком',
    plText.includes('не входять у вартість партії'),
    plText.replace(/\s+/g, ' ').slice(0, 110),
  );

  // ─── 10b. Зарплата з податками ─────────────────────────────────────────────
  console.log('\nЗарплата: ПДФО, військовий збір, ЄСВ');
  await owner.goto(`${BASE}/payroll`);

  for (const [name, dept, salary] of [
    ['Оператор лінії Ткаченко І.', 'production', '20000'],
    ['Пакувальниця Литвин О.', 'production', '20000'],
    ['Бухгалтер Радченко Н.', 'admin', '30000'],
  ]) {
    await owner.fill('input[name="full_name"]', name);
    await owner.selectOption('select[name="department"]', dept);
    await owner.fill('input[name="monthly_salary"]', salary);
    await owner.click('button:has-text("Додати")');
    await owner.waitForTimeout(900);
  }

  await owner.click('button:has-text("Сформувати за місяць")');
  await owner.waitForTimeout(1500);
  await owner.reload();

  const gross = await stat(owner, 'Нараховано');
  const net = await stat(owner, 'До виплати');
  const taxes = await stat(owner, 'Податки');
  const payrollCost = await stat(owner, 'Загальна вартість');

  check('нараховано 70 000 (40 000 цех + 30 000 адмін)', near(gross, 70000, 1), `${gross} грн`);
  check(
    'утримання й ЄСВ: 12 600 + 3 500 + 15 400',
    near(taxes, 70000 * 0.18 + 70000 * 0.05 + 70000 * 0.22, 1),
    `${taxes} грн`,
  );
  check('на руки 53 900', near(net, 70000 - 12600 - 3500, 1), `${net} грн`);
  check('вартість для роботодавця 85 400', near(payrollCost, 85400, 1), `${payrollCost} грн`);

  await owner.click('button:has-text("Провести")');
  await owner.waitForTimeout(1200);
  await owner.reload();
  await owner.click('button:has-text("Виплатити")');
  await owner.waitForTimeout(1200);
  await owner.reload();
  check('зарплату виплачено', (await owner.locator('text=Виплачено').count()) > 0);

  // ─── 10c. Основні засоби з різними строками ────────────────────────────────
  console.log('\nОсновні засоби: різні строки у двох книгах');
  await owner.goto(`${BASE}/assets`);
  await owner.fill('input[name="name"]', 'Сервер і облікова система');
  await owner.selectOption('select[name="department"]', 'admin');
  await owner.fill('input[name="cost"]', '240000');
  await owner.fill('input[name="useful_life_months"]', '60');
  await owner.fill('input[name="useful_life_mgmt"]', '120');
  await owner.click('button:has-text("Додати")');
  await owner.waitForTimeout(1200);

  await owner.click('button:has-text("Нарахувати за місяць")');
  await owner.waitForTimeout(1500);
  await owner.reload();

  const depreciation = await stat(owner, 'Амортизація місяця');
  check(
    'амортизація в бухобліку 4 000 при строку 60 міс.',
    near(depreciation, 4000, 1),
    `${depreciation} грн`,
  );
  const depHint = (await owner.locator('[data-stat="Амортизація місяця"]').innerText())
    .replace(/[\s\u00a0]+/g, ' ');
  check(
    'в управлінському обліку вона інша — строк 120 міс.',
    depHint.includes('в управлінському 2 000,00'),
    depHint,
  );

  // Виробнича лінія — постійна витрата цеху, саме її розподіл залежить від завантаження.
  await owner.goto(`${BASE}/assets`);
  await owner.fill('input[name="name"]', 'Лінія формування батончиків');
  await owner.selectOption('select[name="department"]', 'production');
  await owner.fill('input[name="cost"]', '240000');
  await owner.fill('input[name="useful_life_months"]', '60');
  await owner.selectOption('select[name="cost_behavior"]', 'fixed');
  await owner.click('button:has-text("Додати")');
  await owner.waitForTimeout(1200);
  await owner.click('button:has-text("Нарахувати за місяць")');
  await owner.waitForTimeout(1600);

  // Нормальна потужність — 50 кг на місяць, тобто 2 000 батончиків по 25 г.
  // Фактично випустили 980 шт = 24,5 кг, тобто завантаження 49%.
  await owner.goto(`${BASE}/entities`);
  await owner.selectOption('select[name="allocation_base"]', 'weight');
  await owner.fill('input[name="capacity"]', '50');
  await owner.click('button:has-text("Зберегти норматив")');
  await owner.waitForTimeout(1300);

  // Повна вартість одиниці: сировина + цех, рознесений на випуск.
  await owner.goto(`${BASE}/pl`);
  const shopTotal = 6000 + 48800 + 4000; // енергія + зарплата цеху з ЄСВ + амортизація лінії
  const fullCostRow = await rowCells(owner, 'Повна вартість одиниці');
  const fullCost = money(fullCostRow[1]);
  check(
    'управлінська повна вартість = сировина + цех/випуск',
    near(fullCost, factoryCost + shopTotal / 980, 0.05),
    `${fullCost} грн/шт проти ${factoryCost} в обліку`,
  );

  // ─── 11. Бухгалтерський контур: проводки у двох книгах ─────────────────────
  console.log('\nБухоблік: проводки, оборотка, розбіжності');
  await owner.goto(`${BASE}/accounting`);
  await owner.click('button:has-text("Перегенерувати період")');
  await owner.waitForTimeout(3000);
  await owner.reload();

  const debitTurnover = await stat(owner, 'Оберти за дебетом');
  const creditTurnover = await stat(owner, 'Оберти за кредитом');
  check(
    'оборотка балансує: дебет дорівнює кредиту',
    near(debitTurnover, creditTurnover, 0.02) && debitTurnover > 0,
    `Дт ${debitTurnover} = Кт ${creditTurnover}`,
  );

  // Управлінська книга має дати рівно той результат, що й звіт P&L.
  await owner.goto(`${BASE}/pl`);
  const plResult = await stat(owner, 'Фінансовий результат');

  await owner.goto(`${BASE}/accounting?book=management`);
  const bookResult = await stat(owner, 'Результат на 791');
  check(
    'результат на 791 в управлінській книзі збігається з P&L',
    near(bookResult, plResult, 1),
    `${bookResult} грн проти ${plResult} у звіті`,
  );

  await owner.goto(`${BASE}/accounting/difference`);
  const accResult = await stat(owner, 'Бухгалтерський результат');
  const mgmtResult = await stat(owner, 'Управлінський результат');
  const gap = await stat(owner, 'Розбіжність');

  check(
    'бухгалтерський прибуток вищий: цех осів у залишках ГП',
    accResult > mgmtResult,
    `${accResult} проти ${mgmtResult} грн`,
  );
  // Тепер джерел розбіжності три: змінний цех і розподілена частина постійного
  // осіли в непроданих 40 одиницях, нерозподілені постійні пішли в 901 одразу,
  // а амортизація адмінтехніки різна через різні строки.
  const utilization = 24.5 / 50;
  const fixedShop = 4000;
  const fixedAllocated = fixedShop * utilization;
  const capitalized = 54800 + fixedAllocated;
  const shopInStock = (capitalized * 40) / 980;
  const depreciationGap = 4000 - 2000;

  check(
    'розбіжність = цех у залишках мінус різниця амортизації',
    near(gap, shopInStock - depreciationGap, 1),
    `${gap} грн = ${Math.round(shopInStock)} − ${depreciationGap}`,
  );

  // Головне у Варіанті 4: недозавантаження стає збитком періоду, а не вартістю запасу.
  await owner.goto(`${BASE}/accounting/postings?period=${current}`);
  const postingsText = (await owner.locator('table').first().innerText()).replace(/[\s\u00a0]+/g, ' ');
  check(
    'нерозподілені постійні ЗВВ пішли прямо в собівартість реалізації',
    postingsText.includes('Нерозподілені постійні ЗВВ'),
    'проводка Дт 901 Кт 23 присутня',
  );
  const unallocated = fixedShop - fixedAllocated;
  const compact = postingsText.replace(/[\s\u00a0]/g, '');
  check(
    `при завантаженні ${Math.round(utilization * 100)}% нерозподілено ${unallocated} грн`,
    compact.includes(`${unallocated.toFixed(2).replace('.', ',')}`),
    `${unallocated} грн`,
  );

  // ─── 11a. Рухи документа: аналог ДтКт ──────────────────────────────────────
  console.log('\nРухи документа');
  await owner.goto(`${BASE}/accounting/postings?period=${current}`);
  // Беремо саме випуск продукції: у нього є і проводки, і рухи по складу.
  await owner.locator('a:has-text("Випуск продукції")').first().click();
  await owner.waitForURL(/\/movements\//);

  const docPostings = await stat(owner, 'Проводок');
  const docMoves = await stat(owner, 'Складських рухів');
  const bookAcc = await stat(owner, 'Сума в бухобліку');

  check('екран рухів показує проводки документа', docPostings > 0, `${docPostings} шт`);
  check('і його складські рухи', docMoves > 0, `${docMoves} шт`);
  check('із сумою по книзі', bookAcc > 0, `${bookAcc} грн`);

  // Зворотний перехід: з рухів на сам документ, і звідти знову на рухи.
  await owner.click('a:has-text("До документа")');
  await owner.waitForURL(/\/production\/[0-9a-f-]{36}/);
  check(
    'з картки варки можна відкрити її рухи',
    (await owner.locator('a:has-text("Рухи документа")').count()) > 0,
  );

  // ─── 11b. Баланс і звіт про фінансові результати ───────────────────────────
  console.log('\nФінансова звітність');
  for (const bookKey of ['accounting', 'management']) {
    await owner.goto(`${BASE}/accounting/statements?book=${bookKey}`);
    const assetTotal = await stat(owner, 'Актив');
    const liabilityTotal = await stat(owner, 'Пасив');
    check(
      `баланс сходиться (${bookKey === 'accounting' ? 'бухгалтерський' : 'управлінський'})`,
      near(assetTotal, liabilityTotal, 0.05),
      `актив ${assetTotal} = пасив ${liabilityTotal}`,
    );
  }

  await owner.goto(`${BASE}/accounting/statements?book=management`);
  const statementResult = await stat(owner, 'Результат періоду');
  check(
    'прибуток у Ф2 збігається з результатом на 791',
    near(statementResult, bookResult, 1),
    `${statementResult} грн`,
  );

  const divergentRows = await owner.locator('table').last().locator('tbody tr').count();
  check('видно проводки, що є лише в одній книзі', divergentRows >= 2, `${divergentRows} рядків`);

  // ─── 12. Податкові накладні й декларація з ПДВ ─────────────────────────────
  console.log('\nПодаткові накладні й декларація');
  await owner.goto(`${BASE}/vat`);
  await owner.click('button:has-text("Виписати накладні")');
  await owner.waitForTimeout(2000);
  await owner.reload();

  const invoiceCount = await stat(owner, 'Накладних за період');
  const invoiceVat = await stat(owner, 'ПДВ у накладних');
  check(
    'накладні виписано на обидва відвантаження',
    near(invoiceCount, 2, 0.1),
    `${invoiceCount} шт`,
  );
  check(
    'ПДВ у накладних дорівнює податковому зобов’язанню',
    near(invoiceVat, 640 * 29.75 * 0.2 + 300 * 21.5 * 0.2, 1),
    `${invoiceVat} грн`,
  );

  const invoiceTable = await owner.locator('table').first().innerText();
  check(
    'покупцю-неплатнику проставлено умовний ІПН',
    invoiceTable.includes('100000000000'),
    'ФОП «Верде Роздріб» не платник ПДВ',
  );

  // Повторний запуск не має створити дублів — на відвантаження вже є накладна.
  await owner.click('button:has-text("Виписати накладні")');
  await owner.waitForTimeout(1600);
  await owner.reload();
  check(
    'повторний запуск не дублює накладні',
    near(await stat(owner, 'Накладних за період'), 2, 0.1),
  );

  await owner.click('button:has-text("Підготувати за місяць")');
  await owner.waitForTimeout(1800);
  await owner.reload();

  const declaration = (await owner.locator('text=Податкові зобов’язання').first().locator('../..').innerText())
    .replace(/[\s\u00a0]+/g, ' ');
  const declLiability = money(declaration.split('Податкові зобов’язання')[1]);
  const declCredit = money(declaration.split('Податковий кредит')[1]);
  const declCarried = money(declaration.split('наступний період')[1]);

  check(
    'кредит перевищує зобов’язання, тож сплачувати нічого',
    declCredit > declLiability,
    `кредит ${declCredit} проти зобов’язання ${declLiability}`,
  );
  check(
    'від’ємне значення перенесено повністю',
    near(declCarried, declCredit - declLiability, 1),
    `${declCarried} грн = ${declCredit} − ${declLiability}`,
  );

  // ─── 13. Редагування довідників ────────────────────────────────────────────
  console.log('\nДовідники: редагування й деактивація');

  await owner.goto(`${BASE}/catalog`);
  await owner.click('a:has-text("Батончик «Зарядись» Фісташка 25 г")');
  await owner.waitForURL(/\/catalog\/[0-9a-f-]{36}/);
  check('картка номенклатури відкривається', owner.url().includes('/catalog/'));

  check(
    'одиниця виміру заблокована, бо по позиції є рухи',
    await owner.locator('select[name="unit"]').isDisabled(),
  );

  await owner.fill('input[name="min_stock"]', '950');
  await owner.fill('input[name="note"]', 'Хіт продажів');
  await owner.click('button:has-text("Зберегти")');
  await owner.waitForTimeout(1200);
  await owner.reload();
  check(
    'зміни в картці збереглися',
    (await owner.locator('input[name="min_stock"]').inputValue()).startsWith('950') &&
      (await owner.locator('input[name="note"]').inputValue()) === 'Хіт продажів',
  );

  await owner.click('button:has-text("Деактивувати")');
  await owner.waitForTimeout(1200);
  check(
    'позицію із залишком деактивувати не дають',
    (await owner.locator('text=Не можна деактивувати').count()) > 0,
  );

  // Нова позиція без жодного руху деактивується вільно.
  await owner.goto(`${BASE}/catalog`);
  await owner.fill('input[name="sku"]', 'VRD-TEST-OLD');
  await owner.fill('input[name="name"]', 'Тестова позиція до архіву');
  await selectByText(owner, 'select[name="kind"]', 'Сировина');
  await selectByText(owner, 'select[name="unit"]', 'кг');
  await owner.click('button:has-text("Додати")');
  await owner.waitForTimeout(1200);

  await owner.goto(`${BASE}/catalog`);
  await owner.click('a:has-text("Тестова позиція до архіву")');
  await owner.waitForURL(/\/catalog\/[0-9a-f-]{36}/);
  check(
    'у позиції без рухів тип змінюваний',
    !(await owner.locator('select[name="kind"]').isDisabled()),
  );
  await owner.click('button:has-text("Деактивувати")');
  await owner.waitForTimeout(1200);

  await owner.goto(`${BASE}/catalog`);
  check(
    'деактивована позиція зникла зі списку',
    (await owner.locator('a:has-text("Тестова позиція до архіву")').count()) === 0,
  );
  await owner.goto(`${BASE}/catalog?inactive=1`);
  check(
    'деактивована позиція видима під перемикачем',
    (await owner.locator('a:has-text("Тестова позиція до архіву")').count()) > 0,
  );

  await owner.goto(`${BASE}/sales/customers`);
  await owner.click('a:has-text("ТОВ «АТБ-Маркет»")');
  await owner.waitForURL(/\/sales\/customers\/[0-9a-f-]{36}/);
  await owner.fill('input[name="payment_terms_days"]', '60');
  await owner.click('button:has-text("Зберегти")');
  await owner.waitForTimeout(1200);
  await owner.reload();
  check(
    'умови оплати клієнта збережено',
    (await owner.locator('input[name="payment_terms_days"]').inputValue()) === '60',
  );

  await owner.click('button:has-text("Деактивувати")');
  await owner.waitForTimeout(1200);
  check(
    'клієнта з боргом деактивувати не дають',
    (await owner.locator('text=Не можна деактивувати').count()) > 0,
  );

  await owner.goto(`${BASE}/purchasing/suppliers`);
  await owner.click('a:has-text("ТОВ «ПакЛайн Україна»")');
  await owner.waitForURL(/\/purchasing\/suppliers\/[0-9a-f-]{36}/);
  await owner.fill('input[name="contact"]', 'Марина Дудник (нова)');
  await owner.click('button:has-text("Зберегти")');
  await owner.waitForTimeout(1200);
  await owner.reload();
  check(
    'контакт постачальника збережено',
    (await owner.locator('input[name="contact"]').inputValue()) === 'Марина Дудник (нова)',
  );

  // ─── 14. Права доступу ─────────────────────────────────────────────────────
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
