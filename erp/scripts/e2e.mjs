#!/usr/bin/env node
/**
 * Наскрізна перевірка через справжній інтерфейс: закупівля сировини → варка →
 * випуск ГП → замовлення мережі → відвантаження → маржа у звітах.
 * Кожна роль працює під своїм логіном, як у житті.
 *
 * Запуск: BASE_URL=http://127.0.0.1:3100 node scripts/e2e.mjs
 */
import { globSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_PASSWORD ?? 'verde2026';

let failures = 0;
const check = (name, condition, detail = '') => {
  const mark = condition ? '  ✓' : '  ✗';
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
};

/** Обирає пункт списку за частиною тексту — підписи в опціях містять ще й одиниці й залишки. */
async function selectByText(page, selector, substring) {
  const value = await page
    .locator(`${selector} option`, { hasText: substring })
    .first()
    .getAttribute('value');
  if (!value) throw new Error(`У списку ${selector} немає пункту «${substring}»`);
  await page.selectOption(selector, value);
}

const money = (text) => Number(String(text).replace(/[^\d,.-]/g, '').replace(/\s/g, '').replace(',', '.'));

// Chromium уже стоїть у середовищі — беремо його, а не тягнемо свій.
const preinstalled = globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome')[0];
const browser = await chromium.launch(preinstalled ? { executablePath: preinstalled } : {});

async function session(email) {
  const context = await browser.newContext({ locale: 'uk-UA' });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/`);
  return { context, page };
}

try {
  // ─── 1. Комірник: заявка постачальнику й прихід сировини ───────────────────
  console.log('\nКомірник — закупівля сировини');
  const warehouse = await session('petro@v-verde.ua');
  const wp = warehouse.page;

  await wp.goto(`${BASE}/purchasing`);
  await selectByText(wp, 'select[name="supplier_id"]', 'Сухофрукт Трейд');
  await wp.click('form:has(select[name="supplier_id"]) button[type="submit"]');
  await wp.waitForURL(/\/purchasing\/[0-9a-f-]{36}/);
  const poUrl = wp.url();
  check('заявку створено', /\/purchasing\/[0-9a-f-]{36}/.test(poUrl), poUrl.split('/').pop());

  // Сировина під варку 1000 фісташкових батончиків + пакування.
  const purchases = [
    ['Фініки Деглет Нур паста', 200, 182.5],
    ['Ядро фісташки', 60, 615],
    ['Ізолят горохового білка', 50, 340],
    ['Олія кокосова', 40, 220],
    ['Сироп цикорію', 60, 165],
    ['Премікс вітамін C', 5, 1200],
    ['Омега-3 порошок', 5, 1800],
    ['Плівка флоу-пак', 25000, 0.85],
    ['Етикетка самоклейна', 25000, 0.35],
    ['Шоубокс картонний', 1500, 6.2],
  ];

  for (const [name, qty, price] of purchases) {
    await selectByText(wp, 'select[name="item_id"]', name);
    await wp.fill('input[name="qty"]', String(qty));
    await wp.fill('input[name="unit_price"]', String(price));
    await wp.click('form:has(select[name="item_id"]) button[type="submit"]');
    await wp.waitForTimeout(350);
  }

  const poTotal = money(await wp.locator('text=Сума заявки').locator('..').locator('div').nth(1).innerText());
  const expectedTotal = purchases.reduce((s, [, q, p]) => s + q * p, 0);
  check('сума заявки порахована', Math.abs(poTotal - expectedTotal) < 1, `${poTotal} грн`);

  await wp.click('form:has(input[name="po_id"]) button:has-text("Замовлено")');
  await wp.waitForTimeout(400);
  await wp.reload();
  await wp.click('button:has-text("Оприбуткувати на склад")');
  await wp.waitForTimeout(1200);
  await wp.reload();
  check('заявка оприбуткована', (await wp.locator('text=Отримано').count()) > 0);

  await wp.goto(`${BASE}/stock?kind=raw`);
  const dateRow = wp.locator('tr:has-text("Фініки")');
  check('сировина лягла на склад', (await dateRow.count()) > 0, await dateRow.first().innerText().catch(() => ''));

  // ─── 2. Технолог: варка й випуск готової продукції ─────────────────────────
  console.log('\nТехнолог — виробництво');
  const production = await session('iryna@v-verde.ua');
  const pp = production.page;

  await pp.goto(`${BASE}/production`);
  await selectByText(pp, 'select[name="recipe_id"]', 'Фісташка');
  await pp.fill('input[name="planned_qty"]', '1000');
  await pp.click('form:has(select[name="recipe_id"]) button[type="submit"]');
  await pp.waitForURL(/\/production\/[0-9a-f-]{36}/);
  check('варку заплановано', /\/production\/[0-9a-f-]{36}/.test(pp.url()));

  const shortages = await pp.locator('text=бракує').count();
  check('сировини вистачає за планом', shortages === 0, shortages ? `${shortages} позицій бракує` : '');

  await pp.click('button:has-text("Почати")');
  await pp.waitForTimeout(500);
  await pp.reload();

  // Реальність цеху: випустили 980 замість 1000 — норми мають перерахуватися самі.
  await pp.fill('input[name="produced_qty"]', '980');
  await pp.fill('input[name="overhead_cost"]', '4200');
  await pp.waitForTimeout(300);

  const unitCostPreview = money(
    await pp.locator('text=Собівартість одиниці').locator('..').locator('span').last().innerText(),
  );
  check('собівартість рахується наживо', unitCostPreview > 0, `${unitCostPreview} грн/шт`);

  await pp.click('button:has-text("Закрити варку")');
  await pp.waitForTimeout(1500);
  await pp.reload();
  check('варку закрито', (await pp.locator('text=Завершено').count()) > 0);

  const factCost = money(
    await pp.locator('text=Собівартість одиниці').first().locator('..').locator('div').nth(1).innerText(),
  );
  check(
    'фактична собівартість збіглася з попереднім розрахунком',
    Math.abs(factCost - unitCostPreview) < 0.05,
    `${factCost} грн/шт`,
  );

  await pp.goto(`${BASE}/stock?kind=finished`);
  const finishedRow = await pp.locator('tr:has-text("Фісташка")').first().innerText();
  check('готова продукція на складі', finishedRow.includes('980'), finishedRow.replace(/\s+/g, ' ').trim());

  // ─── 3. Менеджер: замовлення мережі, відвантаження, оплата ─────────────────
  console.log('\nМенеджер — продаж мережі');
  const sales = await session('taras@v-verde.ua');
  const sp = sales.page;

  await sp.goto(`${BASE}/sales`);
  await selectByText(sp, 'select[name="customer_id"]', 'АТБ-Маркет');
  await sp.click('form:has(select[name="customer_id"]) button[type="submit"]');
  await sp.waitForURL(/\/sales\/[0-9a-f-]{36}/);

  await selectByText(sp, 'select[name="item_id"]', 'Фісташка');
  await sp.fill('input[name="qty"]', '640');
  await sp.click('form:has(select[name="item_id"]) button[type="submit"]');
  await sp.waitForTimeout(600);
  await sp.reload();

  const orderTotal = money(
    await sp.locator('text=Сума замовлення').locator('..').locator('div').nth(1).innerText(),
  );
  // АТБ працює за ціною на мережу: 35,70 × 640 = 22 848 грн
  check('ціна підтягнулася з прайсу мережі', Math.abs(orderTotal - 640 * 35.7) < 1, `${orderTotal} грн`);

  await sp.click('button:has-text("Підтвердити")');
  await sp.waitForTimeout(600);
  await sp.reload();

  await sp.goto(`${BASE}/stock?kind=finished`);
  const reservedRow = await sp.locator('tr:has-text("Фісташка")').first().innerText();
  check('товар пішов у резерв', reservedRow.includes('640'), reservedRow.replace(/\s+/g, ' ').trim());

  await sp.goBack();
  await sp.reload();
  await sp.fill('input[name="ttn_number"]', '59000123456789');
  await sp.fill('input[name="carrier"]', 'Нова пошта');
  await sp.click('button:has-text("Провести відвантаження")');
  await sp.waitForTimeout(1500);
  await sp.reload();
  check('замовлення відвантажено', (await sp.locator('text=Відвантажено').count()) > 0);

  const marginText = await sp.locator('text=Маржа').first().locator('..').innerText();
  const marginValue = money(marginText.split('\n')[1] ?? '0');
  check('маржа порахована за фактичними партіями', marginValue > 0, marginText.replace(/\s+/g, ' ').trim());

  await sp.click('button:has-text("Записати оплату")');
  await sp.waitForTimeout(900);
  await sp.reload();
  check('оплату зараховано', (await sp.locator('text=закрито').count()) > 0);

  // ─── 4. Власник: звіти сходяться ───────────────────────────────────────────
  console.log('\nВласник — звіти');
  const owner = await session('olena@v-verde.ua');
  const op = owner.page;

  await op.goto(`${BASE}/reports`);
  const revenue = money(await op.locator('text=Виручка').locator('..').locator('div').nth(1).innerText());
  const cogs = money(await op.locator('text=Собівартість продажів').locator('..').locator('div').nth(1).innerText());
  const grossMargin = money(await op.locator('text=Валова маржа').locator('..').locator('div').nth(1).innerText());

  check('виручка у звіті = сумі замовлення', Math.abs(revenue - orderTotal) < 1, `${revenue} грн`);
  check('маржа = виручка − собівартість', Math.abs(grossMargin - (revenue - cogs)) < 1, `${grossMargin} грн`);
  check('собівартість продажів не нульова', cogs > 0, `${cogs} грн`);

  const skuRow = await op.locator('tr:has-text("Фісташка")').first().innerText();
  check('маржа за SKU показана', skuRow.includes('640'), skuRow.replace(/\s+/g, ' ').trim());

  // Комірник не має бачити грошей — перевіряємо розмежування прав.
  console.log('\nПрава доступу');
  const wpDenied = await warehouse.page.goto(`${BASE}/reports`);
  check('комірника не пускає у звіти', wpDenied.url().includes('denied=1'), wpDenied.url().replace(BASE, ''));

  const salesDenied = await sales.page.goto(`${BASE}/production`);
  check('менеджера не пускає у виробництво', salesDenied.url().includes('denied=1'));
} catch (err) {
  console.error(`\nПомилка сценарію: ${err.message}`);
  failures += 1;
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nУсі перевірки пройдено.' : `\nПровалено перевірок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
