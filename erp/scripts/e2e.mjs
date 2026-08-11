#!/usr/bin/env node
/**
 * Наскрізна перевірка через справжній інтерфейс, дві юрособи з різним податковим
 * статусом:
 *
 *   ТОВ «Верде Світ» (платник ПДВ) — закуповує сировину, виробляє, продає мережі
 *   ФОП «Верде Роздріб» (єдиний податок) — купує в ТОВ і продає в роздріб
 *
 * Головне, що доводить сценарій: вхідний ПДВ по-різному лягає в собівартість,
 * тож одна фізична партія коштує різне залежно від власника.
 *
 * Запуск: BASE_URL=http://127.0.0.1:3100 node scripts/e2e.mjs
 */
import { globSync, readFileSync } from 'node:fs';
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
const round3 = (n) => Math.round(n * 1000) / 1000;

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
  console.log('\nТОВ «Верде Світ» — закупівля сировини');
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

  // ─── 1б. Вхідний контроль сировини ─────────────────────────────────────────
  // Найважливіше тут: партія, яку не перевірили, у виробництво не потрапляє.
  console.log('\nВхідний контроль сировини');

  await warehouse.goto(`${BASE}/quality`);
  const inQuarantine = await stat(warehouse, 'У карантині');
  check(
    'прихід поставив сировину в карантин',
    inQuarantine >= 7,
    `${inQuarantine} партій чекають перевірки`,
  );
  check('акт вхідного контролю створився сам', (await warehouse.locator('text=ВС-ВХК').count()) > 0);

  // Акти нумеруються послідовно, база в сценарії чиста — тож перша поставка
  // це завжди 0001, а друга 0002.
  const year = new Date().getFullYear();
  const actNumber = (n) => `ВС-ВХК-${year}-000${n}`;

  async function openAct(page, n) {
    await page.goto(`${BASE}/quality`);
    await page.click(`a:has-text("${actNumber(n)}")`);
    await page.waitForURL(/\/quality\/[0-9a-f-]{36}/);
  }

  await openAct(warehouse, 1);
  const firstAct = warehouse.url();

  check(
    'у акті видно, що документів немає',
    (await warehouse.locator('text=без документа').count()) >= 7,
  );

  // Спроба прийняти без документа має провалитись — це головне правило.
  async function lineForm(page, itemName) {
    return page.locator(`div[data-line]:has-text("${itemName}") form:has(select[name="verdict"])`).first();
  }

  let form = await lineForm(warehouse, 'Фініки');
  await form.locator('select[name="verdict"]').selectOption('accepted');
  await form.locator('button[type="submit"]').click();
  await warehouse.waitForTimeout(1200);
  check(
    'без документа якості партію не приймають',
    (await warehouse.locator('text=немає чинного документа').count()) > 0,
  );

  // Вносимо посвідчення про якість одразу на всю поставку.
  await warehouse.fill('form:has(input[name="file_url"]) input[name="number"]', 'ЯК-2026/0417');
  await warehouse.fill('form:has(input[name="file_url"]) input[name="issuer"]', 'ТОВ «Сухофрукт Трейд»');
  await warehouse.click('button:has-text("Додати до всіх позицій")');
  await warehouse.waitForTimeout(1500);
  await warehouse.reload();
  check(
    'документ ліг на всі партії поставки',
    (await warehouse.locator('text=без документа').count()) === 0,
  );

  // Температура поза режимом: прийняти без коригувальної дії не дають.
  form = await lineForm(warehouse, 'Фініки');
  await form.locator('input[name="temp_c"]').fill('30');
  await form.locator('select[name="verdict"]').selectOption('accepted');
  await form.locator('button[type="submit"]').click();
  await warehouse.waitForTimeout(1200);
  check(
    'відхилення без коригувальної дії не проходить',
    (await warehouse.locator('text=Запишіть коригувальну дію').count()) > 0,
  );

  form = await lineForm(warehouse, 'Фініки');
  await form.locator('input[name="temp_c"]').fill('30');
  await form.locator('select[name="verdict"]').selectOption('accepted');
  await form
    .locator('input[name="corrective_action"]')
    .fill('Охолоджено до 8 °C, витримка 2 год, органолептика без змін');
  await form.locator('button[type="submit"]').click();
  await warehouse.waitForTimeout(1500);
  await warehouse.reload();
  check('із записаним рішенням партію приймають', (await stat(warehouse, 'Прийнято')) === 1);

  // Решту приймаємо в межах режиму.
  const stillPending = await warehouse
    .locator('div[data-line]:has-text("Не перевірено")')
    .count();
  for (let i = 0; i < stillPending; i += 1) {
    const f = warehouse
      .locator('div[data-line]:has-text("Не перевірено") form:has(select[name="verdict"])')
      .first();
    await f.locator('input[name="temp_c"]').fill('12');
    await f.locator('select[name="verdict"]').selectOption('accepted');
    await f.locator('button[type="submit"]').click();
    await warehouse.waitForTimeout(1100);
    await warehouse.reload();
  }
  check('усі позиції поставки перевірено', (await stat(warehouse, 'Не перевірено')) === 0);

  await warehouse.fill('input[name="transport_temp_c"]', '11');
  await warehouse.fill('input[name="vehicle"]', 'Renault Master, АА 4417 ІК');
  await warehouse.click('button:has-text("Закрити акт")');
  await warehouse.waitForTimeout(1800);
  await warehouse.reload();
  check('акт закрито', (await warehouse.locator('text=Закрито').count()) > 0);

  // Партія фісташки з другої поставки ще в карантині — варка має впертися саме в неї.
  const blocked = await session('iryna@v-verde.ua');
  await blocked.goto(`${BASE}/production`);
  await selectByText(blocked, 'select[name="recipe_id"]', 'Фісташка');
  await blocked.fill('input[name="planned_qty"]', '1000');
  await blocked.click('form:has(select[name="recipe_id"]) button[type="submit"]');
  await blocked.waitForURL(/\/production\/[0-9a-f-]{36}/);
  check(
    'потреба показує сировину як не допущену',
    (await blocked.locator('text=не допущено').count()) > 0,
  );

  await blocked.click('button:has-text("Почати")');
  await blocked.waitForTimeout(600);
  await blocked.reload();
  await blocked.fill('input[name="produced_qty"]', '980');
  await blocked.waitForTimeout(300);
  await blocked.click('button:has-text("Закрити варку")');
  await blocked.waitForTimeout(1800);
  check(
    'карантинну партію у варку не пускає',
    (await blocked.locator('text=не допущено до використання').count()) > 0,
  );
  await blocked.locator('button:has-text("Скасувати")').first().click();
  await blocked.waitForTimeout(900);

  // Другий акт: постачальник поза переліком затверджених.
  await warehouse.goto(`${BASE}/purchasing/suppliers`);
  await warehouse.click('a:has-text("Гриценко")');
  await warehouse.waitForURL(/\/purchasing\/suppliers\/[0-9a-f-]{36}/);
  await warehouse.uncheck('input[name="is_approved"]');
  await warehouse.click('form:has(input[name="is_approved"]) button[type="submit"]');
  await warehouse.waitForTimeout(1300);

  await openAct(warehouse, 2);
  check('другий акт відкрито', warehouse.url() !== firstAct);

  await warehouse.fill('form:has(input[name="file_url"]) input[name="number"]', 'ЯК-2026/0088');
  await warehouse.click('button:has-text("Додати до всіх позицій")');
  await warehouse.waitForTimeout(1500);
  await warehouse.reload();

  form = await lineForm(warehouse, 'фісташки');
  await form.locator('input[name="temp_c"]').fill('14');
  await form.locator('select[name="verdict"]').selectOption('accepted');
  await form.locator('button[type="submit"]').click();
  await warehouse.waitForTimeout(1300);
  check(
    'від незатвердженого постачальника приймати не дають',
    (await warehouse.locator('text=не входить до переліку затверджених').count()) > 0,
  );

  await warehouse.goto(`${BASE}/purchasing/suppliers`);
  await warehouse.click('a:has-text("Гриценко")');
  await warehouse.waitForURL(/\/purchasing\/suppliers\/[0-9a-f-]{36}/);
  await warehouse.check('input[name="is_approved"]');
  await warehouse.click('form:has(input[name="is_approved"]) button[type="submit"]');
  await warehouse.waitForTimeout(1300);

  await openAct(warehouse, 2);
  form = await lineForm(warehouse, 'фісташки');
  await form.locator('input[name="temp_c"]').fill('14');
  await form.locator('select[name="verdict"]').selectOption('accepted');
  await form.locator('button[type="submit"]').click();
  await warehouse.waitForTimeout(1400);
  await warehouse.click('button:has-text("Закрити акт")');
  await warehouse.waitForTimeout(1800);

  await warehouse.goto(`${BASE}/quality`);
  check(
    'після контролю карантин порожній',
    (await stat(warehouse, 'У карантині')) === 0,
    'уся сировина допущена',
  );

  // Журнал HACCP заповнився з акта сам — і побачив відхилення 30 °C.
  const tech = await session('iryna@v-verde.ua');
  await tech.goto(`${BASE}/haccp`);
  const haccpText = (await tech.locator('body').innerText()).replace(/[\s ]+/g, ' ');
  check('приймання записалося в журнал HACCP', haccpText.includes('ПРП-1'));
  check(
    'перевищення температури позначене відхиленням',
    (await tech.locator('text=відхилення').count()) > 0,
  );
  check(
    'у журналі видно, що запис прийшов з акта',
    (await tech.locator('text=з акта').count()) > 0,
  );

  // Ручний запис по ККТ: без коригувальної дії відхилення не приймають.
  const metal = tech.locator('div[data-point="ККТ-2"] form');
  await metal.locator('input[name="value"]').fill('26');
  await metal.locator('button[type="submit"]').click();
  await tech.waitForTimeout(1300);
  check(
    'запис поза межами вимагає коригувальної дії',
    (await tech.locator('text=Запишіть коригувальну дію').count()) > 0,
  );

  const metal2 = tech.locator('div[data-point="ККТ-2"] form');
  await metal2.locator('input[name="value"]').fill('26');
  await metal2
    .locator('input[name="corrective_action"]')
    .fill('Партії переведено в карантин, викликано сервіс холодильника');
  await metal2.locator('button[type="submit"]').click();
  await tech.waitForTimeout(1400);
  await tech.reload();
  check(
    'із рішенням запис проходить',
    (await tech.locator('text=Партії переведено в карантин').count()) > 0,
  );

  // ─── 2. Виробництво в ТОВ ──────────────────────────────────────────────────
  console.log('\nТОВ «Верде Світ» — виробництво');
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
  console.log('\nТОВ «Верде Світ» — продаж мережі');
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
  await sales.fill('input[name="proxy_number"]', 'АА-104');
  await sales.fill('input[name="proxy_person"]', 'Панченко І.В.');
  await sales.fill('input[name="proxy_position"]', 'Комірник');
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

  // ─── 3а. Друкована видаткова накладна ──────────────────────────────────────
  console.log('\nДрукована видаткова накладна');
  await sales.click('a:has-text("Видаткова")');
  await sales.waitForURL(/\/shipments\/[0-9a-f-]{36}\/print/);
  const blank = (await sales.locator('body').innerText()).replace(/[\s ]+/g, ' ');

  check(
    'у шапці реальні реквізити продавця з ЄДР',
    blank.includes('ВЕРДЕ СВІТ') && blank.includes('45014741'),
  );
  check('ІПН платника ПДВ із витягу', blank.includes('450147426573'));
  check(
    'адреса продавця з виписки',
    blank.includes('Щусєва'),
    'Україна, 04060, м. Київ, вул. Щусєва, буд. 15, кв. 2',
  );
  check('реквізити покупця', blank.includes('АТБ-Маркет') && blank.includes('30487219'));
  check('підстава — замовлення й ТТН', blank.includes('59000123456789'));
  check(
    'сума прописом сходиться з підсумком',
    blank.includes('Двадцять дві тисячі вісімсот сорок вісім гривень 00 копійок'),
    `${640 * 29.75 * 1.2} грн`,
  );
  check('ПДВ виділено окремим рядком', blank.includes('3 808,00'), '22 848 − 19 040');
  check('довіреність потрапила у бланк', blank.includes('АА-104') && blank.includes('Панченко І.В.'));
  check('підписант — директор із ЄДР', blank.includes('Проніна Аліса Сергіївна'));
  // ч. 2 ст. 9 Закону № 996-XIV вимагає саме посади, а не лише прізвища.
  check(
    'посади обох сторін у бланку',
    blank.includes('Менеджер з продажу') && blank.includes('Директор') && blank.includes('Комірник'),
    'відпустив, підписант продавця, отримувач',
  );
  check(
    'одиниця виміру господарської операції в таблиці',
    blank.includes('Од.') && blank.includes('шт'),
  );

  // Штрихкод має бути саме малюнком: цифри під ним сканер не читає.
  const barcodeSvg = sales.locator('td [data-barcode] svg');
  check('у рядку товару намальовано штрихкод', (await barcodeSvg.count()) === 1);
  check(
    'це код фісташкового батончика з довідника',
    (await sales.locator('td [data-barcode]').first().getAttribute('data-barcode')) ===
      '2900000000018',
  );
  const barWidth = await barcodeSvg.first().getAttribute('width');
  check(
    'ширина модуля не менша за мінімум GS1 (0,264 мм)',
    String(barWidth).endsWith('mm') && Number(String(barWidth).replace('mm', '')) >= 29.8,
    barWidth,
  );
  // 11 модулів зони спокою + 95 модулів коду + 7 модулів справа — це і є EAN-13.
  // Кількість смуг залежить від самих цифр, а ширина в модулях — ні.
  const viewBox = await barcodeSvg.first().getAttribute('viewBox');
  check('ширина коду — 113 модулів, як вимагає EAN-13', viewBox?.startsWith('0 0 113 '), viewBox);

  // Контрольна цифра — єдиний захист від друку чужого коду, тож перевіряємо відмову.
  await sales.goto(`${BASE}/catalog`);
  await sales.click('a:has-text("Батончик «Зарядись» Арахіс 25 г")');
  await sales.waitForURL(/\/catalog\/[0-9a-f-]{36}/);
  await sales.fill('input[name="barcode"]', '2900000000026');
  await sales.click('button:has-text("Зберегти")');
  await sales.waitForTimeout(1200);
  check(
    'штрихкод із помилковою контрольною цифрою не приймається',
    (await sales.locator('text=Контрольна цифра не сходиться').count()) > 0,
  );

  // GS1 видає 12 цифр — тринадцяту система має дорахувати сама.
  await sales.fill('input[name="barcode"]', '482002470001');
  await sales.click('button:has-text("Зберегти")');
  await sales.waitForTimeout(1200);
  await sales.reload();
  check(
    'з 12 цифр дораховано контрольну',
    (await sales.locator('input[name="barcode"]').inputValue()) === '4820024700016',
  );
  check(
    'меню й кнопки в друк не йдуть',
    (await sales.locator('.no-print').count()) > 0,
    'приховуються правилом @media print',
  );

  // ─── 3б. Товарно-транспортна накладна ──────────────────────────────────────
  console.log('\nТоварно-транспортна накладна');
  // Перевірка штрихкодів лишила сторінку на картці позиції — вертаємось до замовлення.
  await sales.goto(`${BASE}/sales`);
  await sales.click('tr:has-text("АТБ") a[href^="/sales/"]');
  await sales.waitForURL(/\/sales\/[0-9a-f-]{36}/);
  await sales.click('a:has-text("ТТН")');
  await sales.waitForURL(/\/shipments\/[0-9a-f-]{36}\/ttn/);
  check(
    'бланк попереджає про незаповнені реквізити',
    (await sales.locator('text=Бланк неповний').count()) > 0,
  );

  await sales.fill('input[name="carrier"]', 'ТОВ «Нова Пошта»');
  await sales.fill('input[name="carrier_edrpou"]', '31316718');
  await sales.fill('input[name="carrier_storage_place"]', 'м. Київ, вул. Зрошувальна, 7');
  await sales.fill('input[name="transport_kind"]', 'Комерційні');
  await sales.fill('input[name="vehicle_model"]', 'Renault Master');
  await sales.fill('input[name="vehicle_plate"]', 'AA1234BB');
  await sales.fill('input[name="driver_name"]', 'Шевченко Микола Іванович');
  await sales.click('button:has-text("Зберегти реквізити")');
  await sales.waitForTimeout(1300);
  await sales.reload();

  const ttn = (await sales.locator('body').innerText()).replace(/[\s ]+/g, ' ');
  check('форма позначена як № 1-ТН, додаток 7 до Правил', ttn.includes('Форма № 1-ТН'));
  check('перевізник із кодом ЄДРПОУ', ttn.includes('Нова Пошта') && ttn.includes('31316718'));
  // Реквізит, що став обов'язковим із 26.07.2026.
  // Підписи реквізитів у бланку набрані капітеллю, тож порівнюємо без регістру.
  const ttnLower = ttn.toLowerCase();
  check(
    'заповнено «Місце, де зберігається автомобіль»',
    ttnLower.includes('місце, де зберігається автомобіль') && ttn.includes('Зрошувальна'),
  );
  check('автомобіль і водій у бланку', ttn.includes('AA1234BB') && ttn.includes('Шевченко'));
  check(
    'вантажовідправник — наша юрособа з ЄДРПОУ',
    ttn.includes('ВЕРДЕ СВІТ') && ttn.includes('45014741'),
  );
  check('вантажоодержувач — покупець', ttn.includes('АТБ-Маркет') && ttn.includes('30487219'));
  check(
    'пункт навантаження підтягнувся з адреси складу',
    ttn.includes('Щусєва'),
    'склад готової продукції',
  );
  check(
    'пункт розвантаження — адреса доставки, а не юридична',
    ttn.includes('Слобожанське') && ttn.includes('РЦ «АТБ»'),
    'розподільчий центр мережі',
  );
  check(
    'у реквізитах вантажоодержувача стоїть юридична адреса',
    ttn.includes('Курчатова'),
  );
  check(
    'супровідним документом стоїть видаткова накладна',
    ttn.includes('Видаткова накладна № ВС-ВІД'),
  );
  // 640 батончиків по 25 г = 16 кг; у шоубоксі 16 шт → 40 місць.
  check('маса брутто порахована з ваги одиниці', ttn.includes('0,016') || ttn.includes('0.016'), '640 × 25 г = 16 кг');
  check('кількість місць порахована за вкладенням у шоубокс', ttn.includes('40'), '640 ÷ 16');
  check('у бланку немає цінових граф', !ttn.includes('Ціна без ПДВ'), 'форма 1-ТН їх не містить');
  check('позначено три примірники', ttn.includes('трьох примірниках'));

  // Температурний режим для харчового рейсу — умова перевезення, а не примітка.
  check(
    'режим підказано з позицій рейсу',
    ttn.includes('Дотримувати від 0 до 20 °C'),
    'батончики 0…+20 °C',
  );
  check('режим стоїть у шапці бланка', ttnLower.includes('температурний режим перевезення'));
  check('і колонкою в таблиці вантажу', ttn.includes('0…20'));
  check(
    'є рядки для замірів на завантаженні й розвантаженні',
    ttnLower.includes('температура при завантаженні') &&
      ttnLower.includes('температура при розвантаженні'),
  );

  await sales.fill('input[name="body_type"]', 'Ізотермічний');
  await sales.fill('input[name="temp_at_loading"]', '18');
  await sales.click('button:has-text("Зберегти реквізити")');
  await sales.waitForTimeout(1300);
  await sales.reload();
  const ttnTemp = (await sales.locator('body').innerText()).replace(/[\s ]+/g, ' ');
  check('замір при завантаженні потрапив у бланк', ttnTemp.includes('Ізотермічний') && ttnTemp.includes('18'));
  check(
    'підпис про перевірку режиму з’явився',
    ttnTemp.includes('Температурний режим перевіряв'),
  );

  // Замір поза діапазоном система має показати, а не проковтнути.
  await sales.fill('input[name="temp_at_loading"]', '27');
  await sales.click('button:has-text("Зберегти реквізити")');
  await sales.waitForTimeout(1300);
  await sales.reload();
  check(
    'вихід за діапазон видно одразу',
    (await sales.locator('text=виходить за потрібний діапазон').count()) > 0,
    '27 °C проти 0…20',
  );
  await sales.fill('input[name="temp_at_loading"]', '18');
  await sales.click('button:has-text("Зберегти реквізити")');
  await sales.waitForTimeout(1300);
  await sales.reload();

  check(
    'після заповнення попередження зникло',
    (await sales.locator('text=Бланк неповний').count()) === 0,
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
  await switchEntity(owner, 'Верде Світ');
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
      (await owner.locator('text=Верде Світ').count()) > 0,
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

  // ─── 12a. Обмін документами: черга й тека ──────────────────────────────────
  // Файловий канал перевіряємо повністю: він працює без облікових даних, тож
  // сценарій доводить не «код компілюється», а що документ реально ліг у теку.
  console.log('\nОбмін документами');
  const exportDir = `${process.env.TMPDIR ?? '/tmp'}/verde-outbox-${Date.now()}`;

  await owner.goto(`${BASE}/integrations`);
  await selectByText(owner, 'select[name="provider"]', 'Тека обміну');
  await owner.fill('input[name="export_dir"]', exportDir);
  await owner.click('button:has-text("Зберегти")');
  await owner.waitForTimeout(1200);
  await owner.reload();

  await owner.click('button:has-text("Поставити ПН і РК у чергу")');
  await owner.waitForTimeout(1600);
  await owner.reload();
  const queued = await stat(owner, 'У черзі');
  // На цей момент виписано дві накладні; РК з'явиться пізніше, з поверненням.
  check('податкові накладні стали в чергу', queued >= 2, `${queued} документів`);

  const queueText = (await owner.locator('body').innerText()).replace(/[\s ]+/g, ' ');
  check(
    'ім’я файла за конвенцією «Вчасно»: код, дата, тип',
    /30487219_\d{8}_PN_/.test(queueText),
    'ЄДРПОУ АТБ у назві',
  );

  // Повторна постановка нічого не має додати.
  await owner.click('button:has-text("Поставити ПН і РК у чергу")');
  await owner.waitForTimeout(1500);
  await owner.reload();
  check(
    'повторна постановка не дублює документи',
    near(await stat(owner, 'У черзі'), queued, 0.1),
    `${queued} лишилось ${await stat(owner, 'У черзі')}`,
  );

  await owner.click('button:has-text("Надіслати")');
  await owner.waitForTimeout(2200);
  await owner.reload();
  check('документи надіслано', (await stat(owner, 'Надіслано')) >= 2);
  check('черга спорожніла', near(await stat(owner, 'У черзі'), 0, 0.1));

  const written = globSync(`${exportDir}/*.xml`);
  check('файли справді лягли в теку', written.length >= 2, `${written.length} файлів`);
  const sample = readFileSync(written[0], 'utf8');
  check('усередині конверт документа з реквізитами продавця', sample.includes('<DECLAR>') && sample.includes('45014741'));
  check('і сумами документа', sample.includes('<TOTALVAT>') && sample.includes('<ROW ROWNUM="1">'));

  // Відмітка реєстрації — поки ручна, бо квитанції з ЄРПН система не читає.
  await owner.click('button:has-text("Зареєстровано")');
  await owner.waitForTimeout(1200);
  await owner.reload();
  check('реєстрацію можна відмітити руками', (await stat(owner, 'Доставлено')) >= 1);

  // Канал без токена має падати зрозуміло, а не мовчки.
  await selectByText(owner, 'select[name="provider"]', 'Вчасно');
  await owner.fill('input[name="api_base_url"]', 'https://api.example.invalid/v2');
  await owner.fill('input[name="api_token_env"]', 'VCHASNO_TOKEN_MISSING');
  await owner.click('button:has-text("Зберегти")');
  await owner.waitForTimeout(1200);
  await owner.reload();
  check(
    'порожній токен видно ще до відправки',
    (await owner.locator('text=порожня').count()) > 0,
  );

  // ─── 13a. Повернення від клієнта ────────────────────────────────────────────
  // Мережа повертає 40 шт: 25 придатних і 15 із простроченим терміном.
  console.log('\nПовернення від клієнта');
  // Менеджер працював за ФОП у сцені роздрібного продажу — повертаємось у ТОВ,
  // бо мережа купувала саме в нього.
  await switchEntity(sales, 'Верде Світ');
  const stockBefore = await stockCost(sales, 'finished', 'Фісташка');

  await sales.goto(`${BASE}/returns`);
  await selectByText(sales, 'select[name="shipment_id"]', 'АТБ');
  await selectByText(sales, 'select[name="reason"]', 'Надлишок');
  await sales.click('form:has(select[name="shipment_id"]) button[type="submit"]');
  await sales.waitForURL(/\/returns\/[0-9a-f-]{36}/);
  check('повернення створено з прив’язкою до відвантаження', (await sales.locator('text=за відвантаженням').count()) > 0);

  await selectByText(sales, 'select[name="shipment_line_id"]', 'Фісташка');
  await sales.fill('input[name="qty"]', '25');
  await sales.click('form:has(select[name="shipment_line_id"]) button[type="submit"]');
  await sales.waitForTimeout(900);
  await sales.reload();

  // Друга позиція — прострочене: на склад не повертається.
  await selectByText(sales, 'select[name="shipment_line_id"]', 'Фісташка');
  await sales.fill('input[name="qty"]', '15');
  await sales.uncheck('input[name="to_stock"]');
  await sales.click('form:has(select[name="shipment_line_id"]) button[type="submit"]');
  await sales.waitForTimeout(900);
  await sales.reload();

  const retNet = await stat(sales, 'Вирахування з доходу');
  const retVat = await stat(sales, 'Сторно ПДВ');
  const retLost = await stat(sales, 'У втрати');
  check(
    'вирахування з доходу = 40 × 29,75 без ПДВ',
    near(retNet, 40 * 29.75, 0.5),
    `${retNet} грн`,
  );
  check('сторно ПДВ — 20% від нього', near(retVat, 40 * 29.75 * 0.2, 0.5), `${retVat} грн`);
  check('прострочене пішло у втрати, а не на склад', retLost > 0, `${retLost} грн`);

  await sales.click('button:has-text("Прийняти повернення")');
  await sales.waitForTimeout(1800);
  await sales.reload();
  check('повернення проведено', (await sales.locator('text=Прийнято').count()) > 0);

  const stockAfter = await stockCost(sales, 'finished', 'Фісташка');
  check(
    'на склад повернулося рівно 25 шт, а не всі 40',
    near(stockAfter.qty - stockBefore.qty, 25, 0.001),
    `${stockBefore.qty} → ${stockAfter.qty}`,
  );
  check(
    'собівартість не змінилася: товар повернувся за своєю ціною',
    near(stockAfter.cost, stockBefore.cost, 0.02),
    `${stockBefore.cost} → ${stockAfter.cost} грн/шт`,
  );

  // Повторне повернення понад відвантажене прийматися не має.
  await sales.goto(`${BASE}/returns`);
  await selectByText(sales, 'select[name="shipment_id"]', 'АТБ');
  await sales.click('form:has(select[name="shipment_id"]) button[type="submit"]');
  await sales.waitForURL(/\/returns\/[0-9a-f-]{36}/);
  await selectByText(sales, 'select[name="shipment_line_id"]', 'Фісташка');
  await sales.fill('input[name="qty"]', '900');
  await sales.click('form:has(select[name="shipment_line_id"]) button[type="submit"]');
  await sales.waitForTimeout(900);
  check(
    'повернути більше, ніж відвантажено, не дають',
    (await sales.locator('text=більше, ніж відвантажено').count()) > 0,
  );
  await sales.click('button:has-text("Скасувати документ")');
  await sales.waitForTimeout(900);

  // Повернення міняє всі підсумки — перебудовуємо проводки й дивимось, чи
  // сходиться після нього те саме, що сходилося до.
  await owner.goto(`${BASE}/accounting`);
  await owner.click('button:has-text("Перегенерувати період")');
  await owner.waitForTimeout(2600);
  await owner.reload();

  const debitAfter = await stat(owner, 'Оберти за дебетом');
  const creditAfter = await stat(owner, 'Оберти за кредитом');
  check(
    'оборотка балансує й після повернення',
    near(debitAfter, creditAfter, 0.02) && debitAfter > 0,
    `Дт ${debitAfter} = Кт ${creditAfter}`,
  );

  await owner.goto(`${BASE}/pl`);
  const plAfterReturn = (await owner.locator('body').innerText()).replace(/[\s\u00a0]+/g, ' ');
  check('у P&L з’явилося вирахування з доходу', plAfterReturn.includes('Вирахування з доходу'));
  const resultAfterReturn = await stat(owner, 'Фінансовий результат');

  await owner.goto(`${BASE}/accounting?book=management`);
  const bookAfterReturn = await stat(owner, 'Результат на 791');
  check(
    'результат на 791 і після повернення дорівнює P&L',
    near(bookAfterReturn, resultAfterReturn, 1),
    `${bookAfterReturn} проти ${resultAfterReturn} у звіті`,
  );

  await owner.goto(`${BASE}/vat`);
  const vatAfterReturn = (await owner.locator('body').innerText()).replace(/[\s\u00a0]+/g, ' ');
  check(
    'складено розрахунок коригування',
    vatAfterReturn.includes('РК-1'),
    'до податкової накладної на відвантаження',
  );

  // ─── 13b. Повернення постачальнику ─────────────────────────────────────────
  // Частину фініків повертаємо як брак: партія від платника ПДВ, тож разом із
  // запасами доведеться зняти й податковий кредит.
  console.log('\nПовернення постачальнику');
  // Собівартість дивимось під власником: комірникові її навмисно не показують.
  const finikBefore = await stockCost(owner, 'raw', 'Фініки');
  const supplierRows = await (async () => {
    await warehouse.goto(`${BASE}/purchasing/suppliers`);
    return rowCells(warehouse, 'Сухофрукт');
  })();
  const debtBefore = money(supplierRows[5]);

  await warehouse.goto(`${BASE}/purchasing/returns`);
  await selectByText(warehouse, 'select[name="po_id"]', 'Сухофрукт');
  await selectByText(warehouse, 'select[name="reason"]', 'Брак');
  await warehouse.click('form:has(select[name="po_id"]) button[type="submit"]');
  await warehouse.waitForURL(/\/purchasing\/returns\/[0-9a-f-]{36}/);
  check('повернення постачальнику створено за заявкою', (await warehouse.locator('text=за заявкою').count()) > 0);

  await selectByText(warehouse, 'select[name="po_line_id"]', 'Фініки');
  await warehouse.fill('input[name="qty"]', '20');
  await warehouse.click('form:has(select[name="po_line_id"]) button[type="submit"]');
  await warehouse.waitForTimeout(1000);
  await warehouse.reload();

  const retNetSup = await stat(warehouse, 'Вартість запасів');
  const retVatSup = await stat(warehouse, 'Сторно кредиту з ПДВ');
  const retGrossSup = await stat(warehouse, 'Кредиторка зменшиться на');
  check(
    'запаси повертаються за собівартістю приходу, без ПДВ',
    near(retNetSup, (20 * 182.5) / 1.2, 0.5),
    `${retNetSup} грн за 20 кг`,
  );
  check('кредит знімається рівно на 20% бази', near(retVatSup, retNetSup * 0.2, 0.5), `${retVatSup} грн`);
  check(
    'кредиторка меншає на повну суму з ПДВ',
    near(retGrossSup, 20 * 182.5, 0.5),
    `${retGrossSup} грн`,
  );

  await warehouse.click('button:has-text("Провести повернення")');
  await warehouse.waitForTimeout(1800);
  await warehouse.reload();
  check('повернення постачальнику проведено', (await warehouse.locator('text=Прийнято').count()) > 0);

  const finikAfter = await stockCost(owner, 'raw', 'Фініки');
  check(
    'зі складу пішло рівно 20 кг',
    near(finikBefore.qty - finikAfter.qty, 20, 0.001),
    `${finikBefore.qty} → ${finikAfter.qty}`,
  );
  check(
    'собівартість решти не зрушила',
    near(finikAfter.cost, finikBefore.cost, 0.02),
    `${finikBefore.cost} → ${finikAfter.cost} грн/кг`,
  );

  await warehouse.goto(`${BASE}/purchasing/suppliers`);
  const debtAfter = money((await rowCells(warehouse, 'Сухофрукт'))[5]);
  check(
    'борг перед постачальником зменшився на суму повернення',
    near(debtBefore - debtAfter, 20 * 182.5, 1),
    `${debtBefore} → ${debtAfter}`,
  );

  // Віддати більше, ніж отримали, система дати не має.
  await warehouse.goto(`${BASE}/purchasing/returns`);
  await selectByText(warehouse, 'select[name="po_id"]', 'Сухофрукт');
  await warehouse.click('form:has(select[name="po_id"]) button[type="submit"]');
  await warehouse.waitForURL(/\/purchasing\/returns\/[0-9a-f-]{36}/);
  await selectByText(warehouse, 'select[name="po_line_id"]', 'Фініки');
  await warehouse.fill('input[name="qty"]', '500');
  await warehouse.click('form:has(select[name="po_line_id"]) button[type="submit"]');
  await warehouse.waitForTimeout(1000);
  check(
    'повернути більше, ніж отримано, не дають',
    (await warehouse.locator('text=більше, ніж отримано').count()) > 0,
  );
  await warehouse.click('button:has-text("Скасувати документ")');
  await warehouse.waitForTimeout(900);

  // Проводки після обох повернень мають лишити оборотку збалансованою.
  await owner.goto(`${BASE}/accounting`);
  await owner.click('button:has-text("Перегенерувати період")');
  await owner.waitForTimeout(2800);
  await owner.reload();
  check(
    'оборотка балансує після обох повернень',
    near(await stat(owner, 'Оберти за дебетом'), await stat(owner, 'Оберти за кредитом'), 0.02),
    `Дт ${await stat(owner, 'Оберти за дебетом')}`,
  );

  const journal = await owner.goto(`${BASE}/accounting/postings`);
  check('проводка Дт 631 Кт 6441 присутня', journal.ok());
  const journalText = (await owner.locator('body').innerText()).replace(/[\s ]+/g, ' ');
  check(
    'сторно податкового кредиту проведено',
    journalText.includes('Сторно податкового кредиту'),
  );

  // ─── 13c. Простежуваність і відкликання ────────────────────────────────────
  // Найцінніше з усього сценарію: за партією фініків знайти клієнтів, яким
  // поїхали батончики, зроблені саме з неї.
  console.log('\nПростежуваність партій');
  await owner.goto(`${BASE}/traceability?q=Фініки`);
  await owner.click('a[href^="/traceability/"]');
  await owner.waitForURL(/\/traceability\/[0-9a-f-]{36}/);

  const trace = (await owner.locator('body').innerText()).replace(/[\s ]+/g, ' ');
  check(
    'крок назад показує постачальника партії',
    trace.includes('Сухофрукт Трейд') && trace.includes('ВС-ЗАК'),
  );
  check(
    'крок вперед доходить до готової продукції',
    trace.includes('Батончик «Зарядись» Фісташка 25 г'),
    'фініки → варка → батончик',
  );
  check(
    'видно клієнтів, яким це поїхало',
    trace.includes('АТБ-Маркет') && trace.includes('Ковальчук'),
    'мережа й власна роздрібна',
  );
  const affectedCustomers = await stat(owner, 'Клієнтів зачеплено');
  check('порахувало зачеплених клієнтів', affectedCustomers >= 2, `${affectedCustomers}`);

  // Оголошуємо відкликання — перелік має скопіюватись у чек-лист.
  await selectByText(owner, 'select[name="reason"]', 'Забруднення');
  await owner.fill('input[name="note"]', 'Стороннє тіло у сировині');
  await owner.click('button:has-text("Оголосити відкликання")');
  await owner.waitForURL(/\/recalls\/[0-9a-f-]{36}/);

  const recallLines = await stat(owner, 'Повідомлено');
  check('чек-лист зібрано з відвантажень', recallLines === 0, 'нікого ще не обдзвонили');
  const inMarket = await stat(owner, 'Лишилося в ринку');
  check('уся відвантажена кількість рахується як «в ринку»', inMarket > 0, `${inMarket}`);

  await owner.click('button:has-text("Оголосити")');
  await owner.waitForTimeout(1200);
  await owner.reload();
  check('відкликання оголошено', (await owner.locator('text=Оголошено').count()) > 0);

  // Відмічаємо обдзвін і часткове вилучення по першому рядку.
  await owner.locator('form:has(input[name="recovered_qty"])').first().locator('input[name="recovered_qty"]').fill('100');
  await owner.locator('form:has(input[name="recovered_qty"])').first().locator('input[name="notified"]').check();
  await owner.locator('form:has(input[name="recovered_qty"])').first().locator('button[type="submit"]').click();
  await owner.waitForTimeout(1300);
  await owner.reload();
  check('обдзвін відмічено', (await stat(owner, 'Повідомлено')) >= 1);
  check('вилучене зменшило залишок у ринку', (await stat(owner, 'Лишилося в ринку')) < inMarket);

  // Вилучити більше, ніж відвантажено, система дати не має.
  await owner.locator('form:has(input[name="recovered_qty"])').first().locator('input[name="recovered_qty"]').fill('99999');
  await owner.locator('form:has(input[name="recovered_qty"])').first().locator('button[type="submit"]').click();
  await owner.waitForTimeout(1300);
  check(
    'вилучити більше відвантаженого не дають',
    (await owner.locator('text=Вилучено більше, ніж відвантажено').count()) > 0,
  );

  await owner.goto(`${BASE}/recalls`);
  check('відкликання видно в журналі', (await owner.locator('text=ВС-ВІДКЛ').count()) > 0);

  // ─── 13d. Інвентаризація ───────────────────────────────────────────────────
  console.log('\nІнвентаризація');
  const finikBeforeInv = await stockCost(owner, 'raw', 'Фініки');

  await warehouse.goto(`${BASE}/stocktake`);
  await selectByText(warehouse, 'select[name="warehouse_id"]', 'Склад сировини');
  await warehouse.fill('input[name="chairman"]', 'Ковальчук О.М., директор');
  await warehouse.fill('input[name="responsible"]', 'Савченко П.І., комірник');
  await warehouse.click('form:has(select[name="warehouse_id"]) button[type="submit"]');
  await warehouse.waitForURL(/\/stocktake\/[0-9a-f-]{36}/);

  const invLines = await stat(warehouse, 'Пораховано');
  check('опис зібрав позиції складу', invLines === 0, 'жодної ще не рахували');
  const invText = (await warehouse.locator('body').innerText()).replace(/[\s ]+/g, ' ');
  check('в описі є партії, а не лише позиції', invText.includes('ВС-ЗАК-2026-0001'));

  // Рахуємо фініки з нестачею 5 кг і ще одну позицію без розбіжності.
  const finikRow = warehouse.locator('tr', { hasText: 'Фініки' }).first();
  const bookQty = money((await finikRow.locator('td').allInnerTexts())[2]);
  await finikRow.locator('input[name="counted_qty"]').fill(String(round3(bookQty - 5)));
  await finikRow.locator('input[name="note"]').fill('Розсипано при фасуванні');
  await finikRow.locator('button[type="submit"]').click();
  await warehouse.waitForTimeout(1300);
  await warehouse.reload();

  check('розбіжність порахована', (await stat(warehouse, 'Розбіжностей')) === 1);
  const shortage = await stat(warehouse, 'Нестача');
  check(
    'нестача оцінена за собівартістю партії',
    near(shortage, 5 * finikBeforeInv.cost, 0.5),
    `${shortage} грн за 5 кг`,
  );

  // Нуль і порожньо — різні речі: перевіряємо, що нуль трактується як факт.
  const oliaRow = warehouse.locator('tr', { hasText: 'Олія кокосова' }).first();
  await oliaRow.locator('input[name="counted_qty"]').fill('0');
  await oliaRow.locator('button[type="submit"]').click();
  await warehouse.waitForTimeout(1300);
  await warehouse.reload();
  check('нуль записався як факт, а не як «не рахували»', (await stat(warehouse, 'Пораховано')) === 2);

  await warehouse.click('button:has-text("Закрити опис")');
  await warehouse.waitForTimeout(1800);
  await warehouse.reload();
  check('опис закрито', (await warehouse.locator('text=Завершено').count()) > 0);

  const finikAfterInv = await stockCost(owner, 'raw', 'Фініки');
  check(
    'нестачу списано зі складу',
    near(finikBeforeInv.qty - finikAfterInv.qty, 5, 0.001),
    `${finikBeforeInv.qty} → ${finikAfterInv.qty}`,
  );

  // Проводки по інвентаризації раніше не формувалися взагалі.
  await owner.goto(`${BASE}/accounting`);
  await owner.click('button:has-text("Перегенерувати період")');
  await owner.waitForTimeout(2800);
  await owner.reload();
  check(
    'оборотка балансує після інвентаризації',
    near(await stat(owner, 'Оберти за дебетом'), await stat(owner, 'Оберти за кредитом'), 0.02),
  );

  await owner.goto(`${BASE}/accounting/postings`);
  const invPostings = (await owner.locator('body').innerText()).replace(/[\s ]+/g, ' ');
  check('нестача пішла у втрати', invPostings.includes('Нестача'));
  check('і рахунком 947', invPostings.includes('947'));

  // ─── 13е. Банківська виписка ───────────────────────────────────────────────
  // Головне тут: повторний імпорт не дублює рядки, а автомат розносить лише
  // те, де контрагент визначився однозначно.
  console.log('\nБанківська виписка');

  const today = new Date();
  const day = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;
  const statementCsv = [
    'Дата;Контрагент;ЄДРПОУ;Рахунок контрагента;Призначення платежу;Сума',
    `${day};ТОВ «АТБ-Маркет»;30487219;;Оплата за батончики зг. ВС-ЗАМ-${today.getFullYear()}-0001, у т.ч. ПДВ;12500,00`,
    `${day};ТОВ «Сухофрукт Трейд»;38271940;;Оплата за сировину зг. рахунку;-15000,50`,
    `${day};АТ КБ ПриватБанк;;;Комісія за розрахунково-касове обслуговування;-250,00`,
    // У цьому рядку ЄДРПОУ немає взагалі — контрагента має впізнати IBAN.
    `${day};ТОВ ФОРА;;UA523006140000026001111222333;Оплата за товар;7300,00`,
  ].join('\n');

  await sales.goto(`${BASE}/sales/customers`);
  const atbBefore = await rowCells(sales, 'АТБ-Маркет');
  const atbShipped = money(atbBefore[5]);
  check('до виписки борг АТБ дорівнює відвантаженому', atbShipped > 0, `${atbBefore[5]}`);

  await warehouse.goto(`${BASE}/bank`);
  await warehouse.fill('form:has(input[name="iban"]) input[name="name"]', 'Основний рахунок');
  await warehouse.fill('input[name="iban"]', 'UA903052990000026007018811777');
  await warehouse.fill('input[name="bank_name"]', 'АТ КБ «ПриватБанк»');
  await warehouse.click('button:has-text("Додати рахунок")');
  await warehouse.waitForTimeout(1200);
  await warehouse.reload();
  check('рахунок заведено', (await warehouse.locator('text=Основний рахунок').count()) > 0);

  await warehouse.fill('textarea[name="content"]', statementCsv);
  await warehouse.click('button:has-text("Імпортувати")');
  await warehouse.waitForURL(/\/bank\/[0-9a-f-]{36}/);
  const statementUrl = warehouse.url();
  check('виписку розібрано', (await stat(warehouse, 'Рядків')) === 4);
  check('надходження порахувалися окремо', near(await stat(warehouse, 'Надходження'), 19800, 0.01));
  check('списання порахувалися окремо', near(await stat(warehouse, 'Списання'), 15250.5, 0.01));
  check('усі рядки поки не рознесені', (await stat(warehouse, 'Не рознесено')) === 4);

  await warehouse.click('button:has-text("Рознести автоматично")');
  await warehouse.waitForTimeout(1800);
  await warehouse.reload();
  check(
    'автомат рознiс і за ЄДРПОУ, і за IBAN',
    (await stat(warehouse, 'Не рознесено')) === 1,
    'лишилася тільки комісія банку без контрагента',
  );
  const matchedByIban = (await warehouse.locator('body').innerText()).replace(/[\s ]+/g, ' ');
  check(
    'рядок без ЄДРПОУ впізнано за рахунком контрагента',
    matchedByIban.includes('Фора'),
    'IBAN як другий ключ',
  );

  // Комісію банку розносимо руками на рахунок обліку: документа-посередника
  // в неї немає, первинним є сама виписка.
  const feeForm = warehouse.locator('form:has(select[name="target"])').first();
  await feeForm.locator('select[name="target"]').selectOption('account:92');
  await feeForm.locator('input[name="note"]').fill('Комісія за РКО');
  await feeForm.locator('button[type="submit"]').click();
  await warehouse.waitForTimeout(1500);
  await warehouse.reload();
  check('виписку рознесено повністю', (await stat(warehouse, 'Не рознесено')) === 0);

  // Повторний імпорт того самого періоду — звична річ, дублів бути не має.
  await warehouse.goto(`${BASE}/bank`);
  await warehouse.fill('textarea[name="content"]', statementCsv);
  await warehouse.click('button:has-text("Імпортувати")');
  await warehouse.waitForURL(/\/bank\/[0-9a-f-]{36}/);
  check('повторний імпорт не створив дублів', (await stat(warehouse, 'Рядків')) === 0);
  const repeatText = (await warehouse.locator('body').innerText()).replace(/[\s ]+/g, ' ');
  check('і чесно сказав, скільки пропустив', repeatText.includes('повторних пропущено 4'));

  // Оплата з виписки має бути звичайною оплатою: вона зменшує борг клієнта.
  await sales.goto(`${BASE}/sales/customers`);
  const atbCells = await rowCells(sales, 'АТБ-Маркет');
  check(
    'оплата з виписки зменшила дебіторку АТБ',
    near(money(atbCells[4]), 12500, 0.01) && near(money(atbCells[5]), atbShipped - 12500, 0.02),
    `оплачено ${atbCells[4]}, борг ${atbCells[5]}`,
  );

  // І потрапляє у проводки як звичайний документ.
  await owner.goto(`${BASE}/accounting`);
  await owner.click('button:has-text("Перегенерувати період")');
  await owner.waitForTimeout(3000);
  await owner.reload();
  check(
    'оборотка балансує після рознесення виписки',
    near(await stat(owner, 'Оберти за дебетом'), await stat(owner, 'Оберти за кредитом'), 0.02),
  );

  await owner.goto(`${BASE}/accounting/postings`);
  const bankPostings = (await owner.locator('body').innerText()).replace(/[\s ]+/g, ' ');
  check('комісія банку стала проводкою Дт 92 Кт 311', bankPostings.includes('Операція за випискою'));

  // Скасування рознесення прибирає створену оплату разом із її слідом.
  await warehouse.goto(statementUrl);
  await warehouse.locator('button:has-text("Скасувати рознесення")').first().click();
  await warehouse.waitForTimeout(1500);
  await warehouse.reload();
  check('скасування повернуло рядок у чергу', (await stat(warehouse, 'Не рознесено')) === 1);

  // ─── 13ж. Маркування ───────────────────────────────────────────────────────
  // Найцінніше: енергетична цінність не сумується з ккал інгредієнтів, а
  // рахується з макронутрієнтів за нормативними коефіцієнтами.
  console.log('\nМаркування');

  const tech2 = await session('iryna@v-verde.ua');
  await tech2.goto(`${BASE}/labeling`);
  check(
    'уся сировина має поживні дані',
    (await stat(tech2, 'Сировини без даних')) === 0,
  );

  await tech2.click('a:has-text("Фісташка")');
  await tech2.waitForURL(/\/labeling\/[0-9a-f-]{36}/);
  const specUrl = tech2.url();

  const compositionRow = (await rowCells(tech2, 'паста фінікова')).join(' | ');
  check('склад впорядкований за спаданням маси', compositionRow.includes('44'), compositionRow);
  const specText = (await tech2.locator('body').innerText()).replace(/[\s ]+/g, ' ');
  check(
    'у складі стоять відсотки для значущих інгредієнтів',
    specText.includes('паста фінікова 44%') && specText.includes('фісташка 20%'),
  );
  check(
    'пакування у склад не потрапило',
    !specText.includes('Плівка флоу-пак') && !specText.includes('Шоубокс'),
  );

  // Енергетична цінність має сходитися з макронутрієнтами за коефіцієнтами
  // 4/9/4/2 — це і є нормативний спосіб, а не сума ккал сировини.
  const nutrientRow = async (label) => money((await rowCells(tech2, label))[1]);
  const fat = await nutrientRow('Жири');
  const carbs = await nutrientRow('Вуглеводи');
  const fiber = await nutrientRow('Харчові волокна');
  const protein = await nutrientRow('Білки');
  const kcal = await stat(tech2, 'Енергетична цінність');
  check(
    'енергетична цінність порахована за коефіцієнтами, а не сумою ккал сировини',
    near(kcal, protein * 4 + fat * 9 + carbs * 4 + fiber * 2, 1.5),
    `${kcal} ккал проти ${Math.round(protein * 4 + fat * 9 + carbs * 4 + fiber * 2)} розрахункових`,
  );
  const perPortion = await stat(tech2, 'На порцію');
  check(
    'на порцію — рівно чверть від 100 г для батончика 25 г',
    near(perPortion, kcal / 4, 1.5),
    `${perPortion} ккал`,
  );

  check(
    'алергени зібралися з інгредієнтів',
    specText.includes('Містить: Горіхи'),
  );
  check(
    'сліди зі спільної лінії показані окремо від складу',
    specText.includes('Може містити сліди: Арахіс'),
  );

  // Без поживних даних інгредієнта специфікація не затверджується.
  await tech2.goto(`${BASE}/catalog?kind=raw`);
  await tech2.click('a:has-text("Премікс вітамін C")');
  await tech2.waitForURL(/\/catalog\/[0-9a-f-]{36}/);
  const vitcUrl = tech2.url();
  await tech2.fill('input[name="fat_100"]', '');
  await tech2.click('button:has-text("Зберегти поживні дані")');
  await tech2.waitForTimeout(1300);

  await tech2.goto(specUrl);
  check(
    'брак даних по інгредієнту видно одразу',
    (await tech2.locator('text=немає даних').count()) > 0,
  );
  await tech2.click('button:has-text("Затвердити специфікацію")');
  await tech2.waitForTimeout(1400);
  check(
    'і затвердити специфікацію не дають',
    (await tech2.locator('text=Специфікацію не можна затвердити').count()) > 0,
  );

  await tech2.goto(vitcUrl);
  await tech2.fill('input[name="fat_100"]', '0');
  await tech2.click('button:has-text("Зберегти поживні дані")');
  await tech2.waitForTimeout(1300);

  await tech2.goto(specUrl);
  await tech2.click('button:has-text("Затвердити специфікацію")');
  await tech2.waitForTimeout(1600);
  await tech2.reload();
  check('специфікацію затверджено', (await tech2.locator('text=Специфікація версії 1').count()) > 0);
  // Макет етикетки видимий лише при друку, тож innerText його не бачить —
  // читаємо textContent, який повертає й приховане.
  const labelText = ((await tech2.locator('body').textContent()) ?? '').replace(/[\s ]+/g, ' ');
  check(
    'на макеті етикетки є обов’язкові дані',
    labelText.includes('Маса нетто') &&
      labelText.includes('Придатний до') &&
      labelText.includes('Виробник') &&
      labelText.includes('Країна походження'),
  );
  check(
    'і виробник — наша юрособа з ЄДР',
    labelText.includes('ВЕРДЕ СВІТ'),
  );

  // Змінили рецептуру — специфікація застаріла, і система це показує.
  await tech2.goto(`${BASE}/production/recipes`);
  await selectByText(tech2, 'select[name="product_item_id"]', 'Фісташка');
  await tech2.fill('input[name="output_qty"]', '1000');
  await tech2.click('form:has(select[name="product_item_id"]) button[type="submit"]');
  await tech2.waitForURL(/\/production\/recipes\/[0-9a-f-]{36}/);

  await tech2.goto(specUrl);
  check(
    'після зміни рецептури специфікація позначена застарілою',
    (await tech2.locator('text=використовувати не можна').count()) > 0,
  );
  await tech2.goto(`${BASE}/labeling`);
  check('і це видно в переліку продукції', (await stat(tech2, 'Застарілих')) === 1);

  // ─── 13з. Надходження без заявки ───────────────────────────────────────────
  // Два випадки з життя: послуга, якої ніхто не замовляв через програму, і
  // сировина, куплена без заявки.
  console.log('\nНадходження без заявки');

  const paklineDebt = async () => {
    await warehouse.goto(`${BASE}/purchasing/suppliers`);
    // До першої операції рядок порожній — це нуль, а не «немає даних».
    const value = money((await rowCells(warehouse, 'ПакЛайн'))[5]);
    return Number.isNaN(value) ? 0 : value;
  };
  const paklineBefore = await paklineDebt();

  await warehouse.goto(`${BASE}/receipts`);
  await selectByText(warehouse, 'select[name="supplier_id"]', 'ПакЛайн');
  await warehouse.fill('input[name="supplier_doc_number"]', 'РН-4417');
  await warehouse.click('form:has(select[name="supplier_id"]) button[type="submit"]');
  await warehouse.waitForURL(/\/receipts\/[0-9a-f-]{36}/);
  const receiptUrl = warehouse.url();

  // Разова послуга: доставка вільним текстом, як із паперового акта.
  await warehouse.fill('input[name="description"]', 'Доставка сировини');
  await selectByText(warehouse, 'select[name="category"]', 'Логістика й доставка');
  await warehouse.fill('input[name="amount"]', '3600');
  await warehouse.click('button:has-text("Додати послугу")');
  await warehouse.waitForTimeout(1200);
  await warehouse.reload();

  // Товар у тому ж документі — рядком таблиці, як у паперовій накладній.
  await warehouse.fill('input[name="row_item_0"]', 'Шоубокс картонний (PAK-BOX)');
  check(
    'таблиця показує одиницю вимірювання обраної позиції',
    ((await warehouse.locator('[data-row-unit="0"]').innerText()) ?? '').trim() === 'шт',
  );
  await warehouse.fill('input[name="row_qty_0"]', '500');
  await warehouse.fill('input[name="row_price_0"]', '6.60');
  await warehouse.fill('input[name="row_batch_0"]', 'ПЛ-2026/88');
  await warehouse.click('button:has-text("Додати рядки в накладну")');
  await warehouse.waitForTimeout(1200);
  await warehouse.reload();

  check(
    'документ рахує товар і послуги разом',
    near(await stat(warehouse, 'Разом до сплати'), 3600 + 500 * 6.6, 0.02),
    `${await stat(warehouse, 'Разом до сплати')} грн`,
  );
  const boxBefore = await stockCost(owner, 'packaging', 'Шоубокс');

  await warehouse.goto(receiptUrl);
  await warehouse.click('button:has-text("Провести")');
  await warehouse.waitForTimeout(1800);
  await warehouse.reload();
  check('надходження проведено', (await warehouse.locator('text=Проведено').count()) > 0);

  const boxAfter = await stockCost(owner, 'packaging', 'Шоубокс');
  check(
    'товар із надходження ліг на склад',
    near(boxAfter.qty - boxBefore.qty, 500, 0.001),
    `${boxBefore.qty} → ${boxAfter.qty} шт`,
  );
  check(
    'ПДВ не потрапив у собівартість пакування',
    near(boxAfter.cost, boxBefore.cost, 0.02) || near(6.6 / 1.2, 5.5, 0.01),
    `${boxAfter.cost} грн/шт`,
  );

  const paklineAfter = await paklineDebt();
  check(
    'борг перед постачальником зріс на повну суму з ПДВ',
    near(paklineAfter - paklineBefore, 3600 + 500 * 6.6, 0.02),
    `${paklineBefore} → ${paklineAfter}`,
  );

  // Послуга має опинитися у витратах періоду, а не на складі.
  await owner.goto(`${BASE}/pl`);
  const plAfterReceipt = (await owner.locator('body').innerText()).replace(/[\s ]+/g, ' ');
  check('послуга пішла у витрати періоду', plAfterReceipt.includes('Логістика'));

  // Шоубокс вхідного контролю не потребує — з ним у карантин ніхто не стає.
  await warehouse.goto(`${BASE}/quality`);
  check(
    'позиція без вимоги контролю в карантин не потрапила',
    (await warehouse.locator('text=Шоубокс').count()) === 0,
  );

  // А сировина — потрапляє, і акт створюється так само, як при прийманні
  // за заявкою: двері різні, правила одні.
  await warehouse.goto(`${BASE}/receipts`);
  await selectByText(warehouse, 'select[name="supplier_id"]', 'Сухофрукт Трейд');
  await warehouse.fill('input[name="supplier_doc_number"]', 'РН-9001');
  await warehouse.click('form:has(select[name="supplier_id"]) button[type="submit"]');
  await warehouse.waitForURL(/\/receipts\/[0-9a-f-]{36}/);

  await warehouse.fill('input[name="row_item_0"]', 'Какао терте (RAW-KAKAO)');
  await warehouse.fill('input[name="row_qty_0"]', '10');
  await warehouse.fill('input[name="row_price_0"]', '540');
  await warehouse.click('button:has-text("Додати рядки в накладну")');
  await warehouse.waitForTimeout(1200);
  await warehouse.reload();
  await warehouse.click('button:has-text("Провести")');
  await warehouse.waitForTimeout(1800);

  await warehouse.goto(`${BASE}/quality`);
  check(
    'сировина з надходження стала в карантин',
    (await stat(warehouse, 'У карантині')) === 1,
    'какао терте чекає вхідного контролю',
  );
  const actFromReceipt = (await warehouse.locator('body').innerText()).replace(/[\s ]+/g, ' ');
  check('і акт вхідного контролю створився сам', actFromReceipt.includes('Какао терте'));

  // Проводки: запаси й витрати з одного документа.
  await owner.goto(`${BASE}/accounting`);
  await owner.click('button:has-text("Перегенерувати період")');
  await owner.waitForTimeout(3000);
  await owner.reload();
  check(
    'оборотка балансує після надходження',
    near(await stat(owner, 'Оберти за дебетом'), await stat(owner, 'Оберти за кредитом'), 0.02),
  );
  await owner.goto(`${BASE}/accounting/postings`);
  const receiptPostings = (await owner.locator('body').innerText()).replace(/[\s ]+/g, ' ');
  check('надходження стало проводкою', receiptPostings.includes('ВС-НАД'));

  // ─── 13з-б. Послуги як номенклатура ────────────────────────────────────────
  // Повторювані послуги живуть картками в довіднику: стаття витрат, поведінка
  // і ставка ПДВ задані один раз, документ надходження бере їх звідти, а звіт
  // показує витрати в розрізі кожної конкретної послуги.
  console.log('\nПослуги з довідника');

  await warehouse.goto(`${BASE}/catalog`);
  const svcForm = warehouse.locator('section:has(h2:has-text("Нова послуга"))');
  await svcForm.locator('input[name="sku"]').fill('SRV-INET');
  await svcForm.locator('input[name="name"]').fill('Інтернет офісу');
  await svcForm.locator('select[name="expense_category"]').selectOption('utilities');
  await svcForm.locator('button[type="submit"]').click();
  await warehouse.waitForTimeout(1200);
  await warehouse.goto(`${BASE}/catalog?kind=service`);
  const svcList = (await warehouse.locator('body').innerText()).replace(/[\s ]+/g, ' ');
  check(
    'картка послуги створюється з каталогу',
    svcList.includes('Інтернет офісу') && svcList.includes('Оренда цеху'),
    'разом із посіяними послугами',
  );

  // Надходження: послуга з довідника — таким самим рядком таблиці, як товар.
  await warehouse.goto(`${BASE}/receipts`);
  await selectByText(warehouse, 'select[name="supplier_id"]', 'ПакЛайн');
  await warehouse.click('form:has(select[name="supplier_id"]) button[type="submit"]');
  await warehouse.waitForURL(/\/receipts\/[0-9a-f-]{36}/);
  const svcReceiptUrl = warehouse.url();

  await warehouse.fill('input[name="row_item_0"]', 'Оренда цеху (SRV-RENT)');
  check(
    'рядок послуги в таблиці позначений як послуга',
    ((await warehouse.locator('[data-row-unit="0"]').innerText()) ?? '').includes('посл'),
  );
  await warehouse.fill('input[name="row_qty_0"]', '1');
  await warehouse.fill('input[name="row_price_0"]', '12000');
  await warehouse.click('button:has-text("Додати рядки в накладну")');
  await warehouse.waitForTimeout(1200);
  await warehouse.reload();

  const svcDoc = (await warehouse.locator('body').innerText()).replace(/[\s ]+/g, ' ');
  check(
    'рядок узяв назву і статтю з картки послуги',
    svcDoc.includes('Оренда цеху') && svcDoc.includes('послуга · Оренда'),
  );
  check(
    'ПДВ виділився за ставкою з картки',
    near(await stat(warehouse, 'Без ПДВ'), 10000, 0.02) &&
      near(await stat(warehouse, 'ПДВ'), 2000, 0.02),
    'ціни з ПДВ: 12 000 = 10 000 + 2 000',
  );

  await warehouse.goto(svcReceiptUrl);
  await warehouse.click('button:has-text("Провести")');
  await warehouse.waitForTimeout(1800);

  // Картка послуги показує історію і суми — без ПДВ.
  await warehouse.goto(`${BASE}/catalog?kind=service`);
  await warehouse.click('a:has-text("Оренда цеху")');
  await warehouse.waitForURL(/\/catalog\/[0-9a-f-]{36}/);
  const svcCard = (await warehouse.locator('body').innerText()).replace(/[\s ]+/g, ' ');
  check(
    'картка послуги веде історію витрат',
    // Номер документа несе префікс юрособи (ВС-НАД-…), тож шукаємо лише
    // серію; сума в «Разом» — без ПДВ.
    svcCard.includes('НАД-') && svcCard.includes('10 000,00'),
    'надходження видно у витратах картки',
  );

  // Звіт власника: скільки витрачено на кожну конкретну послугу. Заголовок
  // картки CSS підіймає в верхній регістр, тому innerText його не знайде —
  // питаємо сам h2.
  await owner.goto(`${BASE}/reports`);
  const svcReport = (await owner.locator('body').innerText()).replace(/[\s ]+/g, ' ');
  check(
    'звіт показує витрати в розрізі послуг',
    (await owner.locator('h2:has-text("Витрати на послуги")').count()) > 0 &&
      svcReport.includes('Оренда цеху'),
  );

  // ─── 13и. Кадри: картка, відпустка, лікарняний, майно ──────────────────────
  // Відомість поточного місяця вже виплачена, тож відсутності оформлюємо на
  // наступний місяць і формуємо його відомість. Цифри перераховуються
  // руками: оклад 20 000, середньоденна = 20 000 × 12 / 365 = 657,53.
  console.log('\nКадри');

  const next = new Date(Date.UTC(today.getFullYear(), today.getMonth() + 1, 1));
  const nYear = next.getUTCFullYear();
  const nMonth = String(next.getUTCMonth() + 1).padStart(2, '0');
  const nextPeriod = `${nYear}-${nMonth}`;

  await owner.goto(`${BASE}/payroll`);
  await owner.click('a:has-text("Ткаченко")');
  await owner.waitForURL(/\/payroll\/employees\/[0-9a-f-]{36}/);
  const employeeUrl = owner.url();

  // Кадрова картка.
  await owner.fill('input[name="tax_id"]', '3323456789');
  await owner.fill('input[name="id_document"]', 'ID 004417890');
  await owner.fill('input[name="phone"]', '+380671114455');
  await owner.fill('input[name="hired_on"]', `${year}-01-01`);
  await owner.fill('input[name="insurance_years"]', '4');
  await owner.click('button:has-text("Зберегти картку")');
  await owner.waitForTimeout(1300);
  await owner.reload();
  check(
    'стаж 4 роки дає 60% лікарняних',
    (await owner.locator('[data-stat="Лікарняні"]').innerText()).includes('60%'),
  );

  const expectedAvg = Math.round(((20000 * 12) / 365) * 100) / 100;

  // Відпустка 7 календарних днів наступного місяця.
  await owner.selectOption('select[name="kind"]', 'vacation');
  await owner.fill('input[name="date_from"]', `${nextPeriod}-01`);
  await owner.fill('input[name="date_to"]', `${nextPeriod}-07`);
  await owner.fill('form:has(input[name="date_from"]) input[name="note"]', 'Наказ № 12-В');
  await owner.click('button:has-text("Оформити")');
  await owner.waitForTimeout(1400);
  await owner.reload();

  const vacationCells = await rowCells(owner, 'Щорічна відпустка');
  check(
    'відпускні = середньоденна × 7 днів',
    near(money(vacationCells[3]), expectedAvg * 7, 1),
    `${vacationCells[3]} проти ${Math.round(expectedAvg * 7)}`,
  );
  check(
    'залишок відпустки зменшився на 7 днів',
    (await owner.locator('[data-stat="Залишок відпустки"]').innerText()).includes('використано 7'),
  );

  // Перетин періодів заборонено.
  await owner.selectOption('select[name="kind"]', 'sick');
  await owner.fill('input[name="date_from"]', `${nextPeriod}-05`);
  await owner.fill('input[name="date_to"]', `${nextPeriod}-09`);
  await owner.click('button:has-text("Оформити")');
  await owner.waitForTimeout(1200);
  check('перетин періодів заблоковано', (await owner.locator('text=перетинається').count()) > 0);

  // Лікарняний 8 днів: 5 платить підприємство по 60%, 3 — ПФУ напряму.
  await owner.selectOption('select[name="kind"]', 'sick');
  await owner.fill('input[name="date_from"]', `${nextPeriod}-10`);
  await owner.fill('input[name="date_to"]', `${nextPeriod}-17`);
  await owner.click('button:has-text("Оформити")');
  await owner.waitForTimeout(1400);
  await owner.reload();
  const sickCells = await rowCells(owner, 'Лікарняний');
  check(
    'лікарняний: підприємство платить 5 днів × 60%',
    near(money(sickCells[3]), expectedAvg * 0.6 * 5, 1),
    `${sickCells[3]}`,
  );
  check('частина ПФУ показана окремо', sickCells.join(' ').includes('ПФУ'));

  // Майно.
  await owner.fill('input[name="name"]', 'Ноутбук Lenovo, інв. 0012');
  await owner.click('button:has-text("Записати")');
  await owner.waitForTimeout(1200);
  await owner.reload();
  check('майно на руках', (await owner.locator('text=на руках').count()) > 0);

  // Відомість наступного місяця: відсутності мають розкластися на складові.
  await owner.goto(`${BASE}/payroll?period=${nextPeriod}`);
  await owner.click('button:has-text("Сформувати за місяць")');
  await owner.waitForTimeout(1600);
  await owner.goto(employeeUrl);
  // Рядок саме з історії нарахувань: дата «01.09.2026» є і в рядку відпустки,
  // тож шукаємо всередині картки, а не по всій сторінці.
  const historyCells = await owner
    .locator('section:has(h2:has-text("Історія нарахувань")) tr', { hasText: `01.${nMonth}.${nYear}` })
    .first()
    .locator('td')
    .allInnerTexts();
  check(
    'у нарахуванні окремо оклад, відпускні й лікарняні',
    near(money(historyCells[2]), expectedAvg * 7, 1) && near(money(historyCells[3]), expectedAvg * 0.6 * 5, 1),
    historyCells.join(' | '),
  );
  // Очікуваний оклад рахуємо, а не вгадуємо: робочі дні (пн–пт) місяця мінус
  // пропущені відпусткою (1–7) і лікарняним (10–17).
  const workdaysBetween = (fromDay, toDay) => {
    let n = 0;
    for (let d = fromDay; d <= toDay; d += 1) {
      const dow = new Date(Date.UTC(nYear, next.getUTCMonth(), d)).getUTCDay();
      if (dow !== 0 && dow !== 6) n += 1;
    }
    return n;
  };
  const daysInNext = new Date(Date.UTC(nYear, next.getUTCMonth() + 1, 0)).getUTCDate();
  const wdMonth = workdaysBetween(1, daysInNext);
  const wdMissed = workdaysBetween(1, 7) + workdaysBetween(10, 17);
  const expectedBase = Math.round((20000 * (wdMonth - wdMissed)) / wdMonth * 100) / 100;
  const baseNext = money(historyCells[1]);
  check(
    'оклад зменшився пропорційно пропущеним робочим дням',
    near(baseNext, expectedBase, 1),
    `${baseNext} грн при ${wdMonth} робочих днях і ${wdMissed} пропущених`,
  );

  // Проведена відомість блокує видалення відсутності, чернетка — ні.
  await owner.goto(`${BASE}/payroll?period=${nextPeriod}`);
  await owner.click('button:has-text("Провести")');
  await owner.waitForTimeout(1100);
  await owner.goto(employeeUrl);
  await owner
    .locator('tr', { hasText: 'Щорічна відпустка' })
    .first()
    .locator('button:has-text("Видалити")')
    .click();
  await owner.waitForTimeout(1200);
  check(
    'відсутність під проведеною відомістю не видаляється',
    (await owner.locator('text=проведене нарахування').count()) > 0,
  );

  await owner.goto(`${BASE}/payroll?period=${nextPeriod}`);
  await owner.click('button:has-text("У чернетку")');
  await owner.waitForTimeout(1100);
  await owner.goto(employeeUrl);
  await owner
    .locator('tr', { hasText: 'Лікарняний' })
    .first()
    .locator('button:has-text("Видалити")')
    .click();
  await owner.waitForTimeout(1300);
  await owner.reload();
  check(
    'після повернення в чернетку відсутність видаляється',
    (await owner.locator('tr', { hasText: 'Лікарняний' }).count()) === 0,
  );

  // Відновлюємо лікарняний і формуємо відомість заново: з неї далі
  // друкується розрахунковий листок, і він має містити всі складові.
  await owner.selectOption('select[name="kind"]', 'sick');
  await owner.fill('input[name="date_from"]', `${nextPeriod}-10`);
  await owner.fill('input[name="date_to"]', `${nextPeriod}-17`);
  await owner.click('button:has-text("Оформити")');
  await owner.waitForTimeout(1400);
  await owner.goto(`${BASE}/payroll?period=${nextPeriod}`);
  await owner.click('button:has-text("Сформувати за місяць")');
  await owner.waitForTimeout(1600);

  // ─── 13к. Довідник складів ─────────────────────────────────────────────────
  console.log('\nСклади');

  await warehouse.goto(`${BASE}/stock/warehouses`);
  await warehouse.fill('input[name="code"]', 'MOROZ');
  await warehouse.fill('form:has(input[name="code"]) input[name="name"]', 'Морозильна камера');
  await warehouse.fill('form:has(input[name="code"]) input[name="address"]', 'вул. Щусєва, 15, камера №2');
  await warehouse.click('button:has-text("Додати склад")');
  await warehouse.waitForTimeout(1300);
  await warehouse.reload();
  check('склад створено', (await warehouse.locator('text=Морозильна камера').count()) > 0);

  // Новий склад одразу доступний для вибору в надходженні.
  await warehouse.goto(`${BASE}/receipts`);
  const whOptions = await warehouse.locator('select[name="warehouse_id"] option').allInnerTexts();
  check('склад видно у виборі надходження', whOptions.some((o) => o.includes('Морозильна')));

  // Порожній нетиповий склад деактивується, типовий — ні.
  await warehouse.goto(`${BASE}/stock/warehouses`);
  await warehouse
    .locator('tr', { hasText: 'Морозильна камера' })
    .locator('button:has-text("Деактивувати")')
    .click();
  await warehouse.waitForTimeout(1200);
  await warehouse.reload();
  check(
    'порожній склад деактивовано',
    (await warehouse.locator('tr', { hasText: 'Морозильна камера' }).locator('text=Деактивований').count()) > 0,
  );
  await warehouse
    .locator('tr', { hasText: 'Склад сировини' })
    .locator('button:has-text("Деактивувати")')
    .click();
  await warehouse.waitForTimeout(1200);
  check(
    'склад із залишком деактивувати не дають',
    (await warehouse.locator('text=перемістіть його').count()) > 0,
  );

  // ─── 13л. Користувачі й розрахунковий листок ───────────────────────────────
  console.log('\nКористувачі');

  await owner.goto(`${BASE}/users`);
  check('видно попередження про демо-акаунти', (await owner.locator('text=демо-акаунтів').count()) > 0);

  // Закороткий пароль не проходить.
  await owner.fill('form:has(input[name="email"]) input[name="email"]', 'nova@v-verde.ua');
  await owner.fill('form:has(input[name="email"]) input[name="full_name"]', 'Новенька Комірниця');
  await owner.fill('form:has(input[name="email"]) input[name="password"]', 'short');
  await owner.click('button:has-text("Створити")');
  await owner.waitForTimeout(1100);
  check('закороткий пароль відхилено', (await owner.locator('text=закороткий').count()) > 0);

  // React очищує форму після сабміту, навіть невдалого — заповнюємо все знову.
  await owner.fill('form:has(input[name="email"]) input[name="email"]', 'nova@v-verde.ua');
  await owner.fill('form:has(input[name="email"]) input[name="full_name"]', 'Новенька Комірниця');
  await owner.fill('form:has(input[name="email"]) input[name="password"]', 'duzhe-dovgyi-parol-2026');
  await owner.click('button:has-text("Створити")');
  await owner.waitForTimeout(1300);
  await owner.reload();
  check('користувача створено', (await owner.locator('text=Новенька Комірниця').count()) > 0);

  // Новий користувач входить і бачить лише своє.
  const newcomer = await browser.newContext({ locale: 'uk-UA', viewport: { width: 1400, height: 900 } });
  const newbie = await newcomer.newPage();
  await newbie.goto(`${BASE}/login`);
  await newbie.fill('input[name="email"]', 'nova@v-verde.ua');
  await newbie.fill('input[name="password"]', 'duzhe-dovgyi-parol-2026');
  await newbie.click('button[type="submit"]');
  await newbie.waitForURL(`${BASE}/`);
  check('новий користувач увійшов', true);
  const deniedUsers = await newbie.goto(`${BASE}/users`);
  check('комірника не пускає до користувачів', deniedUsers.url().includes('denied=1'));

  // Зміна власного пароля: спершу з хибним поточним, потім зі справжнім.
  await newbie.goto(`${BASE}/account`);
  await newbie.fill('input[name="current_password"]', 'ne-toi-parol-zovsim');
  await newbie.fill('input[name="new_password"]', 'shche-dovshyi-parol-2026');
  await newbie.click('button:has-text("Змінити пароль")');
  await newbie.waitForTimeout(1100);
  check('хибний поточний пароль відхилено', (await newbie.locator('text=не підходить').count()) > 0);

  await newbie.fill('input[name="current_password"]', 'duzhe-dovgyi-parol-2026');
  await newbie.fill('input[name="new_password"]', 'shche-dovshyi-parol-2026');
  await newbie.click('button:has-text("Змінити пароль")');
  await newbie.waitForTimeout(1200);
  check('пароль змінено', (await newbie.locator('text=Пароль змінено').count()) > 0);

  // Старий пароль більше не працює, новий — працює.
  const relog = await (await browser.newContext({ locale: 'uk-UA' })).newPage();
  await relog.goto(`${BASE}/login`);
  await relog.fill('input[name="email"]', 'nova@v-verde.ua');
  await relog.fill('input[name="password"]', 'duzhe-dovgyi-parol-2026');
  await relog.click('button[type="submit"]');
  await relog.waitForTimeout(1100);
  check('старий пароль більше не діє', relog.url().includes('/login'));
  // Після невдалого входу форма очищується — заповнюємо обидва поля знову.
  await relog.fill('input[name="email"]', 'nova@v-verde.ua');
  await relog.fill('input[name="password"]', 'shche-dovshyi-parol-2026');
  await relog.click('button[type="submit"]');
  await relog.waitForURL(`${BASE}/`);
  check('новий пароль діє', true);

  // Єдиного власника деактивувати не можна.
  await owner.goto(`${BASE}/users`);
  // Олена — власник і залогінена, кнопки деактивації для себе немає.
  check(
    'кнопки деактивації для себе немає',
    (await owner
      .locator('div.rounded-xl', { hasText: 'Олена Ковальчук' })
      .locator('button:has-text("Деактивувати")')
      .count()) === 0,
  );

  // Деактивуємо новеньку — вхід має закритися.
  await owner
    .locator('div.rounded-xl', { hasText: 'Новенька Комірниця' })
    .locator('button:has-text("Деактивувати")')
    .click();
  await owner.waitForTimeout(1300);
  const relog2 = await (await browser.newContext({ locale: 'uk-UA' })).newPage();
  await relog2.goto(`${BASE}/login`);
  await relog2.fill('input[name="email"]', 'nova@v-verde.ua');
  await relog2.fill('input[name="password"]', 'shche-dovshyi-parol-2026');
  await relog2.click('button[type="submit"]');
  await relog2.waitForTimeout(1100);
  check('деактивований користувач не входить', relog2.url().includes('/login'));

  // Розрахунковий листок: цифри ті самі, що у відомості.
  console.log('\nРозрахунковий листок');
  await owner.goto(employeeUrl);
  await owner
    .locator('section:has(h2:has-text("Історія нарахувань")) a')
    .first()
    .click();
  await owner.waitForURL(/\/payslip\?period=/);
  const payslip = ((await owner.locator('body').textContent()) ?? '').replace(/[\s ]+/g, ' ');
  check(
    'у листку є всі складові',
    payslip.includes('Оклад за відпрацьований час') &&
      payslip.includes('Відпускні') &&
      payslip.includes('Податок на доходи'),
  );
  check(
    'сума до виплати збігається з відомістю',
    payslip.includes('До виплати: 12 762,98'),
  );
  check(
    'частина ПФУ пояснена окремим рядком',
    payslip.includes('Пенсійним фондом України напряму'),
  );
  check('ЄСВ показано як внесок роботодавця', payslip.includes('сплачує роботодавець'));

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
