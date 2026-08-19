#!/usr/bin/env node
/**
 * Знімки екранів для показу. Заходить власником — він бачить усе — і знімає
 * ключові сторінки цілком, разом із друкованими формами в PDF.
 */
import { globSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3100';
const OUT = '/tmp/verde-screens';
mkdirSync(OUT, { recursive: true });

const preinstalled = globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome')[0];
const browser = await chromium.launch(preinstalled ? { executablePath: preinstalled } : {});
const context = await browser.newContext({
  locale: 'uk-UA',
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', 'olena@v-verde.ua');
await page.fill('input[name="password"]', process.env.SEED_PASSWORD ?? 'verde2026');
await page.click('button[type="submit"]');
await page.waitForURL(`${BASE}/`);

async function shot(name, path, wait = 900) {
  await page.goto(`${BASE}${path}`);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(`  ✓ ${name} — ${path}`);
}

/** Перше посилання, що веде на сторінку виду /prefix/<uuid>. */
async function firstLink(listPath, prefix) {
  await page.goto(`${BASE}${listPath}`);
  await page.waitForTimeout(600);
  const href = await page.locator(`a[href^="${prefix}/"]`).first().getAttribute('href');
  return href;
}

console.log('\nЗнімаю екрани');
await shot('01-dashboard', '/');
await shot('02-stock', '/stock');
await shot('03-sales', '/sales');
await shot('04-purchasing', '/purchasing');
await shot('05-quality', '/quality');
await shot('06-haccp', '/haccp');

const specHref = await firstLink('/labeling', '/labeling');
await shot('07-labeling', specHref);

const traceHref = await firstLink('/traceability?q=Фініки', '/traceability');
await shot('08-traceability', traceHref);

await shot('09-bank', '/bank');
await shot('10-accounting', '/accounting');
await shot('11-pl', '/pl');
await shot('12-reports', '/reports');
await shot('13-vat', '/vat');

const stocktakeHref = await firstLink('/stocktake', '/stocktake');
if (stocktakeHref) await shot('14-stocktake', stocktakeHref);

const recallHref = await firstLink('/recalls', '/recalls');
if (recallHref) await shot('15-recall', recallHref);

// Мобільний вигляд: у цеху й на складі працюють із телефона.
const phone = await browser.newContext({
  locale: 'uk-UA',
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const mobile = await phone.newPage();
await mobile.goto(`${BASE}/login`);
await mobile.fill('input[name="email"]', 'petro@v-verde.ua');
await mobile.fill('input[name="password"]', process.env.SEED_PASSWORD ?? 'verde2026');
await mobile.click('button[type="submit"]');
await mobile.waitForURL(`${BASE}/`);
await mobile.waitForTimeout(800);
await mobile.screenshot({ path: `${OUT}/16-mobile.png`, fullPage: true });
console.log('  ✓ 16-mobile — телефон комірника');

console.log('\nДруковані форми');
async function pdf(name, path, options) {
  await page.goto(`${BASE}${path}`);
  await page.waitForTimeout(900);
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: `${OUT}/${name}.pdf`, printBackground: true, ...options });
  await page.emulateMedia({ media: 'screen' });
  console.log(`  ✓ ${name}`);
}

const shipmentHref = await firstLink('/shipments', '/shipments');
if (shipmentHref) {
  const id = shipmentHref.split('/')[2];
  await pdf('n1-nakladna', `/shipments/${id}/print`, { format: 'A4' });
  await pdf('n2-ttn', `/shipments/${id}/ttn`, { format: 'A4', landscape: true });
}
await pdf('n3-etyketka', specHref, {
  width: '90mm',
  height: '150mm',
  margin: { top: '2mm', bottom: '2mm', left: '2mm', right: '2mm' },
});
const actHref = await firstLink('/quality', '/quality');
if (actHref) await pdf('n4-akt-vhidnogo-kontrolyu', actHref, { format: 'A4' });
if (stocktakeHref) await pdf('n5-inventaryzaciya', stocktakeHref, { format: 'A4' });

await browser.close();
console.log(`\nГотово: ${OUT}`);
