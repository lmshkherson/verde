#!/usr/bin/env node
/**
 * Конвертер експорту номенклатури з БАС (xlsx) у CSV для scripts/import.mjs.
 *
 *   node scripts/convert-bas.mjs експорт.xlsx номенклатура.csv
 *
 * Очікувані колонки БАС: Найменування, Код, Штрихкод, Рецепт, од,
 * Ціна продажу, Ціна закупівлі, Вид, Категорія ФР, Тип, Ваговий, Послуга,
 * Належність, Код УКТЗЕД, Акциз, Класифікатор.
 *
 * Що робить з брудом реального експорту:
 *  - рядки-папки (групи без одиниці виміру) пропускає;
 *  - технічні рядки БАС на кшталт «ПДВ (внутрішній)» пропускає — податки
 *    в цій системі ведуться не номенклатурою;
 *  - послуги розпізнає за чотирма ознаками одразу (колонка «Послуга»,
 *    Вид, Тип, одиниця) і підбирає статтю витрат за ключовими словами;
 *  - типи мапить: Сировина/Спеція → сировина, Напівфабрикат → н/ф,
 *    готову продукцію впізнає за рецептом, штрихкодом і назвою,
 *    пакування — за назвою (гофроящик, плівка, етикетка…);
 *  - невалідні штрихкоди відкидає у звіт, а не тягне в базу.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { normalizeEan } from '../lib/barcode.mjs';

const [, , input, output = 'номенклатура.csv'] = process.argv;
if (!input) {
  console.error('Використання: node scripts/convert-bas.mjs експорт.xlsx [номенклатура.csv]');
  process.exit(1);
}

// ── Мінімальний читач xlsx: sharedStrings + перший аркуш ─────────────────────
// Без зовнішніх залежностей: xlsx — це zip, а Node вміє inflateRaw.
import { inflateRawSync } from 'node:zlib';

const unesc = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

/** Дістає файл із zip-архіву через центральний каталог. */
function unzipEntry(buf, wanted) {
  const eocd = buf.lastIndexOf(Buffer.from('PK\x05\x06', 'binary'));
  if (eocd < 0) throw new Error('Не zip-файл — це точно xlsx?');
  let offset = buf.readUInt32LE(eocd + 16);
  const total = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < total; i += 1) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buf.readUInt16LE(offset + 10);
    const compressed = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    if (name === wanted) {
      const localNameLen = buf.readUInt16LE(localOffset + 26);
      const localExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLen + localExtraLen;
      const data = buf.subarray(start, start + compressed);
      return method === 8 ? inflateRawSync(data).toString('utf8') : data.toString('utf8');
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`У архіві немає ${wanted}`);
}

function readSheet(file) {
  const buf = readFileSync(file);
  const shared = [];
  const ss = unzipEntry(buf, 'xl/sharedStrings.xml');
  for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    shared.push(unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  }
  const sheetXml = unzipEntry(buf, 'xl/worksheets/sheet1.xml');
  const rows = [];
  for (const rm of sheetXml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {};
    for (const cm of rm[2].matchAll(/<c ([^>]*)>([\s\S]*?)<\/c>/g)) {
      const col = (cm[1].match(/r="([A-Z]+)\d+"/) ?? [])[1];
      const type = (cm[1].match(/t="([^"]*)"/) ?? [])[1];
      const v = (cm[2].match(/<v>([\s\S]*?)<\/v>/) ?? [])[1];
      let val = (v ?? '').trim();
      if (type === 's') val = (shared[Number(v)] ?? '').trim();
      if (col) cells[col] = val;
    }
    if (Object.keys(cells).length) rows.push(cells);
  }
  return rows;
}

// ── Правила класифікації ─────────────────────────────────────────────────────

// Псевдо-номенклатура, якою в БАС оформлювали податки та виправлення обліку.
// У цій системі податки й коригування ведуться своїми документами.
const TECHNICAL = [
  'пдв (внутрішній)',
  'податок на прибуток',
  'податки фоп',
  "корекція від'ємних залишків",
  'компенсування списання',
];

const UNIT_MAP = { шт: 'pcs', кг: 'kg', пак: 'pack', рул: 'pcs', набір: 'pcs', послуга: 'pcs', л: 'l', мл: 'ml', г: 'g' };

const CATEGORY_RULES = [
  [/оренд|суборенд/, 'rent'],
  [/реклам|маркетинг|смм|сео|ppc|трафік|блогер|мерчендайз|амбасадор|просув|розсилк|інстаграм|тік[- ]?ток|сайт/, 'marketing'],
  [/логіст|доставк|перевез|транспорт|відправлен/, 'logistics'],
  [/ркО|банк|еквайр/i, 'bank'],
  [/інтернет|водопост|електро|комунал|утиліза|вивіз|компенсація витрат ее|експлуатац/, 'utilities'],
];

const PACKAGING_RE =
  /гофро|коробк|піддон|стрічк|плівк|етикетк|пакет |пакет$|скотч|кришк|банка|стакан|дой[- ]?пак|лоток|цифри для датера|цифри до/i;
const FINISHED_RE = /^(батончик|цукерк|1 кг цукерок|набір |сет |шоубокс цукерок|книга|дріп-кава)/i;
const EQUIPMENT_RE =
  /кутер|машин[аи]|стелаж|деко |стіл |стіл$|кондиціонер|піч|обігрівач|осушув|рукомийник|фаршезміш|промо-стіл|топильна|штанцформ|кріплення для пк|гигрометр|психометр/i;

function serviceCategory(name) {
  const lower = name.toLowerCase();
  for (const [re, cat] of CATEGORY_RULES) if (re.test(lower)) return cat;
  return 'services';
}

// ── Конвертація ──────────────────────────────────────────────────────────────
const rows = readSheet(input);
const header = rows[0];
if (!header || header.A !== 'Найменування') {
  console.error('Не схоже на експорт номенклатури з БАС: перша колонка не «Найменування»');
  process.exit(1);
}

const out = [];
const report = { groups: [], technical: [], badBarcodes: [], dupBarcodes: [], equipment: [], byKind: {} };
const seenSku = new Set();
const seenBarcodes = new Set();

for (const r of rows.slice(1)) {
  const name = (r.A ?? '').replace(/\s+/g, ' ').trim();
  if (!name) continue;
  const rawUnit = r.E ?? '';
  const unit = UNIT_MAP[rawUnit];

  // Папки дерева номенклатури мають сміттєве значення замість одиниці.
  if (!unit) {
    report.groups.push(name);
    continue;
  }
  if (TECHNICAL.includes(name.toLowerCase())) {
    report.technical.push(name);
    continue;
  }

  const sku = (r.B ?? '').trim() || `BAS-${out.length + 1}`;
  if (seenSku.has(sku)) continue;
  seenSku.add(sku);

  const vid = r.H ?? '';
  const isService =
    (r.L ?? '') === 'Так' || vid === 'Послуга' || (r.J ?? '') === 'Услуга' || rawUnit === 'послуга';
  const hasRecipe = (r.D ?? '') === 'Так';

  let barcodeValue = '';
  const rawBarcode = (r.C ?? '').trim();
  if (/^\d{8,14}$/.test(rawBarcode)) {
    const result = normalizeEan(rawBarcode);
    if ('error' in result) report.badBarcodes.push(`${name}: ${rawBarcode}`);
    else if (seenBarcodes.has(result.ean)) {
      // Той самий EAN на двох картках БАС (типово — стара й нова назва).
      // У базі штрихкод унікальний, тож другій позиції він не дістається.
      report.dupBarcodes.push(`${name}: ${result.ean}`);
    } else {
      seenBarcodes.add(result.ean);
      barcodeValue = result.ean;
    }
  }

  let kind;
  if (isService) kind = 'service';
  // «НФ» у назві — так у БАС позначали напівфабрикати власного виробництва
  // (начинки, корпуси цукерок), навіть коли Вид не заповнений.
  // \b не дружить із кирилицею, тому межі слова — явні пробіли чи краї рядка.
  else if (vid === 'Напівфабрикат' || /(^|\s)НФ(\s|$)/.test(name)) kind = 'semi';
  else if (PACKAGING_RE.test(name)) kind = 'packaging';
  else if (hasRecipe || FINISHED_RE.test(name) || barcodeValue.startsWith('4820277')) kind = 'finished';
  else if (vid === 'Сировина' || vid === 'Спеція') kind = 'raw';
  else kind = 'raw';

  if (kind !== 'service' && kind !== 'finished' && EQUIPMENT_RE.test(name)) {
    report.equipment.push(name);
  }

  const uktzed = /^\d{4,}$/.test((r.N ?? '').trim()) ? (r.N ?? '').trim() : '';
  const price = Number((r.F ?? '').replace(',', '.')) || 0;
  // «, 35 г» у назві готової продукції — це вага одиниці для етикетки.
  const weight = kind === 'finished' ? (name.match(/(\d+(?:[.,]\d+)?)\s*г\.?$/) ?? [])[1] ?? '' : '';

  report.byKind[kind] = (report.byKind[kind] ?? 0) + 1;
  out.push({
    sku,
    назва: name,
    тип: kind,
    одиниця: unit,
    ррц: kind === 'finished' && price > 0 ? String(price) : '',
    уктзед: uktzed,
    штрихкод: barcodeValue,
    вага_г: weight.replace(',', '.'),
    стаття_витрат: kind === 'service' ? serviceCategory(name) : '',
  });
}

const columns = ['sku', 'назва', 'тип', 'одиниця', 'ррц', 'уктзед', 'штрихкод', 'вага_г', 'стаття_витрат'];
const esc = (v) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csv = [columns.join(';'), ...out.map((r) => columns.map((c) => esc(String(r[c] ?? ''))).join(';'))].join('\n');
writeFileSync(output, `﻿${csv}`, 'utf8');

console.log(`Записано ${out.length} позицій у ${output}`);
console.log('За типами:', JSON.stringify(report.byKind));
console.log(`Пропущено груп-папок: ${report.groups.length} (${report.groups.slice(0, 8).join(', ')}…)`);
if (report.technical.length) console.log(`Пропущено технічних рядків БАС: ${report.technical.join(', ')}`);
if (report.badBarcodes.length) console.log(`Штрихкоди з помилкою контрольної цифри (не імпортовано): ${report.badBarcodes.join('; ')}`);
if (report.dupBarcodes.length) console.log(`Повторні штрихкоди (лишився за першою позицією): ${report.dupBarcodes.join('; ')}`);
if (report.equipment.length) {
  console.log(`\nСхоже на обладнання/інвентар (${report.equipment.length}) — імпортовано як сировину, `);
  console.log('за потреби деактивуйте або заведіть як основні засоби в розділі «Основні засоби»:');
  console.log(report.equipment.join('; '));
}
