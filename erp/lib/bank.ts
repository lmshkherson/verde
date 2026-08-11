import { createHash } from 'node:crypto';
import { parseCsv } from '@/lib/csv.mjs';

/**
 * Розбір банківської виписки.
 *
 * Єдиного формату виписки в Україні немає: кожен банк вивантажує свій CSV, і
 * навіть один банк міняє його між версіями кабінету. Тому колонки шукаються
 * за назвами із набору синонімів, а не за позицією — так файл переживає і
 * зайву колонку, і перестановку. Якщо ключову колонку не впізнано, імпорт
 * не вгадує: він показує заголовки, які побачив, і зупиняється.
 */

export interface RawTransaction {
  opDate: string;
  amount: number;
  currency: string;
  counterpartyName: string | null;
  counterpartyEdrpou: string | null;
  counterpartyIban: string | null;
  purpose: string | null;
  docNumber: string | null;
  extId: string;
}

export interface ParseResult {
  rows: RawTransaction[];
  headers: string[];
  /** Які колонки впізнано — показуємо користувачеві, щоб він бачив розбір. */
  mapping: Record<string, string>;
  skipped: number;
}

export class StatementFormatError extends Error {
  constructor(
    message: string,
    public readonly headers: string[],
  ) {
    super(message);
    this.name = 'StatementFormatError';
  }
}

const SYNONYMS: Record<string, string[]> = {
  date: ['дата', 'дата операції', 'дата операции', 'дата проводки', 'дата документа', 'date', 'дата валютування'],
  amount: ['сума', 'сума операції', 'сума у валюті рахунку', 'сума в грн', 'amount', 'сумма'],
  debit: ['дебет', 'списання', 'видаток', 'debit', 'сума дебет', 'дебет, грн'],
  credit: ['кредит', 'зарахування', 'надходження', 'credit', 'сума кредит', 'кредит, грн'],
  counterparty: [
    'контрагент', 'найменування контрагента', 'назва контрагента', 'контрагент(платник/отримувач)',
    'платник', 'отримувач', 'кореспондент', 'counterparty', 'наименование контрагента',
  ],
  edrpou: ['єдрпоу', 'едрпоу', 'єдрпоу контрагента', 'код контрагента', 'окпо', 'окпо контрагента', 'edrpou'],
  iban: ['рахунок контрагента', 'iban контрагента', 'рахунок кореспондента', 'iban', 'рахунок'],
  purpose: ['призначення платежу', 'призначення', 'опис операції', 'коментар', 'purpose', 'description', 'назначение платежа'],
  doc: ['номер документа', '№ документа', 'документ', 'номер', 'doc'],
  ext: ['id', 'ідентифікатор', 'reference', 'референс', 'номер транзакції'],
  currency: ['валюта', 'currency'],
};

/** Заголовки приходять у різному регістрі й з різними лапками — нормалізуємо. */
function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/["'«»]/g, '').replace(/\s+/g, ' ').trim();
}

function findColumn(headers: string[], key: string): string | null {
  const variants = SYNONYMS[key];
  // Спершу точний збіг, і лише потім входження: інакше «дата» знайшлася б
  // усередині «дата валютування» раніше за саму «дату операції».
  for (const v of variants) {
    const exact = headers.find((h) => normalizeHeader(h) === v);
    if (exact) return exact;
  }
  for (const v of variants) {
    const partial = headers.find((h) => normalizeHeader(h).includes(v));
    if (partial) return partial;
  }
  return null;
}

/** Дата у трьох формах, які реально трапляються у виписках. */
export function parseDate(value: string): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const dmy = raw.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return ymd[0];

  return null;
}

/** Число з пробілами між тисячами, комою чи крапкою й можливими лапками. */
export function parseAmount(value: string): number {
  const raw = String(value ?? '')
    .replace(/[\s '"]/g, '')
    .replace(/грн\.?|uah/gi, '')
    .replace(',', '.');
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** ЄДРПОУ — 8 цифр, РНОКПП — 10. Беремо перше таке число в тексті. */
export function findEdrpou(text: string): string | null {
  const match = String(text ?? '').match(/(?<!\d)(\d{10}|\d{8})(?!\d)/);
  return match ? match[1] : null;
}

/** Номер документа системи в призначенні платежу: ВС-РЕА-2026-0001. */
export function findDocNumber(text: string): string | null {
  const match = String(text ?? '').match(/([А-ЯЇІЄҐA-Z]{1,4}-[А-ЯЇІЄҐA-Z]{2,5}-\d{4}-\d{3,6})/iu);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Виписка у windows-1251 — досі норма для вивантажень із клієнт-банку.
 * Пробуємо UTF-8 і, якщо з'явилися символи заміни, перечитуємо в 1251.
 */
export function decodeStatement(buffer: Buffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  if (!utf8.includes('�')) return utf8;
  try {
    return new TextDecoder('windows-1251').decode(buffer);
  } catch {
    return utf8;
  }
}

export function parseStatement(text: string): ParseResult {
  const rows = parseCsv(text) as Record<string, string>[];
  if (rows.length === 0) throw new StatementFormatError('Файл порожній або це не CSV', []);

  const headers = Object.keys(rows[0]);
  const dateCol = findColumn(headers, 'date');
  const amountCol = findColumn(headers, 'amount');
  const debitCol = findColumn(headers, 'debit');
  const creditCol = findColumn(headers, 'credit');

  if (!dateCol) {
    throw new StatementFormatError('У файлі не знайдено колонки з датою операції', headers);
  }
  if (!amountCol && !debitCol && !creditCol) {
    throw new StatementFormatError(
      'У файлі не знайдено ні колонки суми, ні пари «дебет / кредит»',
      headers,
    );
  }

  const mapping: Record<string, string> = { Дата: dateCol };
  if (amountCol) mapping['Сума'] = amountCol;
  if (debitCol) mapping['Списання'] = debitCol;
  if (creditCol) mapping['Зарахування'] = creditCol;

  const cols = {
    counterparty: findColumn(headers, 'counterparty'),
    edrpou: findColumn(headers, 'edrpou'),
    iban: findColumn(headers, 'iban'),
    purpose: findColumn(headers, 'purpose'),
    doc: findColumn(headers, 'doc'),
    ext: findColumn(headers, 'ext'),
    currency: findColumn(headers, 'currency'),
  };
  const labels: Record<string, string> = {
    counterparty: 'Контрагент',
    edrpou: 'ЄДРПОУ',
    iban: 'Рахунок',
    purpose: 'Призначення',
    doc: 'Документ',
    ext: 'Ідентифікатор',
    currency: 'Валюта',
  };
  for (const [key, col] of Object.entries(cols)) if (col) mapping[labels[key]] = col;

  const parsed: RawTransaction[] = [];
  // Скільки разів такий самий рядок уже траплявся у файлі. Два однакові
  // платежі за день — не помилка, тож розрізняємо їх порядком, а не
  // склеюємо в один.
  const seen = new Map<string, number>();
  let skipped = 0;

  for (const row of rows) {
    const opDate = parseDate(row[dateCol]);
    if (!opDate) {
      skipped += 1;
      continue;
    }

    let amount = 0;
    if (amountCol && parseAmount(row[amountCol]) !== 0) {
      amount = parseAmount(row[amountCol]);
    } else {
      const debit = debitCol ? Math.abs(parseAmount(row[debitCol])) : 0;
      const credit = creditCol ? Math.abs(parseAmount(row[creditCol])) : 0;
      amount = credit - debit;
    }
    if (amount === 0) {
      skipped += 1;
      continue;
    }

    const purpose = cols.purpose ? row[cols.purpose]?.trim() || null : null;
    const counterparty = cols.counterparty ? row[cols.counterparty]?.trim() || null : null;
    const edrpouCell = cols.edrpou ? findEdrpou(row[cols.edrpou]) : null;

    const fingerprint = [opDate, amount.toFixed(2), purpose ?? '', counterparty ?? ''].join('|');
    const occurrence = (seen.get(fingerprint) ?? 0) + 1;
    seen.set(fingerprint, occurrence);

    const bankId = cols.ext ? row[cols.ext]?.trim() : '';
    const extId = bankId
      ? bankId
      : `${createHash('sha256').update(fingerprint).digest('hex').slice(0, 24)}#${occurrence}`;

    parsed.push({
      opDate,
      amount: Math.round(amount * 100) / 100,
      currency: (cols.currency ? row[cols.currency]?.trim() : '') || 'UAH',
      counterpartyName: counterparty,
      // ЄДРПОУ часто немає окремою колонкою, зате він майже завжди є в
      // призначенні платежу — саме за ним потім знаходиться контрагент.
      counterpartyEdrpou: edrpouCell ?? (purpose ? findEdrpou(purpose) : null),
      counterpartyIban: cols.iban ? row[cols.iban]?.trim() || null : null,
      purpose,
      docNumber: (cols.doc ? row[cols.doc]?.trim() : '') || (purpose ? findDocNumber(purpose) : null),
      extId,
    });
  }

  if (parsed.length === 0) {
    throw new StatementFormatError('У файлі не знайдено жодного рядка з датою й сумою', headers);
  }

  return { rows: parsed, headers, mapping, skipped };
}

export { normalizeName, suggestByName } from './bank-match';


/**
 * IBAN у канонічному вигляді: без пробілів, у верхньому регістрі.
 * Український IBAN — UA і 27 цифр; інші країни в системі поки не потрібні,
 * тож формат перевіряємо саме цей, а не загальний ISO 13616.
 */
export function normalizeIban(value: string | null): { iban: string | null; error?: string } {
  if (!value) return { iban: null };
  const clean = value.replace(/[\s-]/g, '').toUpperCase();
  if (clean === '') return { iban: null };
  if (!/^UA\d{27}$/.test(clean)) {
    return { iban: null, error: 'IBAN має вигляд UA та 27 цифр — перевірте, чи скопійовано повністю' };
  }
  return { iban: clean };
}
