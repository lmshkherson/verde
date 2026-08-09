/**
 * Мінімальний розбір CSV під те, що реально приходить із Excel:
 * BOM на початку, крапка з комою як роздільник, лапки навколо полів із комами,
 * подвоєні лапки всередині.
 */

/** Визначає роздільник за першим рядком: що частіше зустрічається поза лапками. */
function detectDelimiter(line) {
  let semicolons = 0;
  let commas = 0;
  let inQuotes = false;

  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === ';') semicolons += 1;
    else if (!inQuotes && ch === ',') commas += 1;
  }
  return semicolons >= commas ? ';' : ',';
}

function parseLine(line, delimiter) {
  const cells = [];
  let value = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(value.trim());
      value = '';
    } else {
      value += ch;
    }
  }
  cells.push(value.trim());
  return cells;
}

/**
 * Повертає масив об'єктів, де ключі — заголовки з першого рядка.
 * @param {string} text
 * @returns {Record<string, string>[]}
 */
export function parseCsv(text) {
  const clean = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  const lines = clean.split('\n').filter((l) => l.trim() !== '');
  const delimiter = detectDelimiter(lines[0]);
  const headers = parseLine(lines[0], delimiter).map((h) => h.toLowerCase());

  return lines.slice(1).map((line) => {
    const cells = parseLine(line, delimiter);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']));
  });
}

/** Число з української локалі: кома як десятковий роздільник, пробіли між тисячами. */
export function num(value) {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = Number(String(value).replace(/[\s ]/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

export const str = (value) => (value === undefined || value === null ? '' : String(value).trim());
export const strOrNull = (value) => (str(value) === '' ? null : str(value));
