import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Канали обміну документами: M.E.Doc і «Вчасно».
 *
 * Обидва сервіси приймають документи двома способами — файлом і через API.
 * Файловий шлях зроблено основним свідомо: він працює без жодних облікових
 * даних, його видно очима, і саме так M.E.Doc інтегрується штатно. API
 * «Вчасно» додається зверху, коли компанія оплатить тариф з інтеграцією.
 *
 * Точні шляхи REST API «Вчасно» винесені в налаштування юрособи, а не зашиті
 * в код: їхня публічна документація закрита тарифом, і звірити її треба перед
 * першим бойовим надсиланням. Помилятися тут дешево — міняється один рядок.
 */

export type OutboxStatus = 'queued' | 'sent' | 'delivered' | 'rejected' | 'failed';

export interface OutboxItem {
  id: string;
  doc_type: string;
  doc_number: string;
  doc_date: string;
  counterparty: string | null;
  counterparty_id: string | null;
  file_name: string;
  payload: string;
}

export interface SendResult {
  status: OutboxStatus;
  externalId?: string;
  error?: string;
  /** Куди саме лягло — шлях файла або відповідь сервісу. Іде в журнал. */
  detail?: string;
}

export interface Settings {
  provider: 'none' | 'file' | 'vchasno';
  export_dir: string | null;
  api_base_url: string | null;
  api_token_env: string | null;
}

/**
 * Драйвер `pg` віддає колонки типу date об'єктом Date, а не рядком. Уся решта
 * системи працює з датою як з рядком, тож зводимо до нього тут, а не сподіваємось
 * на те, чим саме виявиться значення.
 */
const isoDate = (value: string | Date): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

/**
 * Ім'я файла за конвенцією «Вчасно»: код контрагента, дата й номер документа.
 * За ним сервіс сам підтягує контрагента й реквізити, тож ручного заповнення
 * при завантаженні не буде. M.E.Doc до імені байдужий, але тримати дві різні
 * конвенції — зайвий привід переплутати.
 */
export function outboxFileName(input: {
  counterpartyId: string | null;
  docDate: string | Date;
  docType: string;
  docNumber: string;
}): string {
  const kinds: Record<string, string> = {
    tax_invoice: 'PN',
    shipment: 'VN',
    customer_return: 'POV',
    supplier_return: 'POVP',
  };
  const date = isoDate(input.docDate).replace(/-/g, '');
  const code = (input.counterpartyId ?? '000000000').replace(/\D/g, '') || '000000000';
  // У імені файла лишаються лише безпечні символи: службові зламали б і шлях,
  // і розбір імені на боці сервісу.
  const number = input.docNumber.replace(/[^0-9A-Za-zА-Яа-яЇїІіЄєҐґ_-]/g, '-');
  return `${code}_${date}_${kinds[input.docType] ?? 'DOC'}_${number}.xml`;
}

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Корисне навантаження документа.
 *
 * Обгортка `DECLAR` — це конверт, у якому обидва сервіси очікують первинку.
 * Склад полів усередині `DECLARBODY` залежить від конкретної форми ДПС, а її
 * схема постачається разом із M.E.Doc. Тому тут свідомо зроблено плоский і
 * повний зліпок документа: він містить усе, що знадобиться будь-якому
 * мапуванню, а сама відповідність полів схемі задається в одному місці —
 * у цій функції, і правиться без переробки решти системи.
 */
export function buildPayload(doc: {
  docType: string;
  number: string;
  date: string | Date;
  sellerName: string;
  sellerEdrpou: string | null;
  sellerIpn: string | null;
  counterparty: string | null;
  counterpartyId: string | null;
  counterpartyIpn: string | null;
  baseAmount: number;
  vatAmount: number;
  totalAmount: number;
  lines: { name: string; qty: number; price: number; uktzed?: string | null; uom?: string | null }[];
}): string {
  const lines = doc.lines
    .map(
      (l, i) =>
        `    <ROW ROWNUM="${i + 1}">\n` +
        `      <NAME>${esc(l.name)}</NAME>\n` +
        `      <UKTZED>${esc(l.uktzed ?? '')}</UKTZED>\n` +
        `      <UOM>${esc(l.uom ?? '')}</UOM>\n` +
        `      <QTY>${Number(l.qty).toFixed(3)}</QTY>\n` +
        `      <PRICE>${Number(l.price).toFixed(2)}</PRICE>\n` +
        `      <SUM>${(Number(l.qty) * Number(l.price)).toFixed(2)}</SUM>\n` +
        `    </ROW>`,
    )
    .join('\n');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<DECLAR>\n` +
    `  <DECLARHEAD>\n` +
    `    <DOCTYPE>${esc(doc.docType)}</DOCTYPE>\n` +
    `    <DOCNUMBER>${esc(doc.number)}</DOCNUMBER>\n` +
    `    <DOCDATE>${esc(isoDate(doc.date))}</DOCDATE>\n` +
    `    <SELLER>${esc(doc.sellerName)}</SELLER>\n` +
    `    <SELLEREDRPOU>${esc(doc.sellerEdrpou ?? '')}</SELLEREDRPOU>\n` +
    `    <SELLERIPN>${esc(doc.sellerIpn ?? '')}</SELLERIPN>\n` +
    `    <BUYER>${esc(doc.counterparty ?? '')}</BUYER>\n` +
    `    <BUYEREDRPOU>${esc(doc.counterpartyId ?? '')}</BUYEREDRPOU>\n` +
    `    <BUYERIPN>${esc(doc.counterpartyIpn ?? '')}</BUYERIPN>\n` +
    `  </DECLARHEAD>\n` +
    `  <DECLARBODY>\n` +
    lines +
    `\n    <TOTALBASE>${doc.baseAmount.toFixed(2)}</TOTALBASE>\n` +
    `    <TOTALVAT>${doc.vatAmount.toFixed(2)}</TOTALVAT>\n` +
    `    <TOTAL>${doc.totalAmount.toFixed(2)}</TOTAL>\n` +
    `  </DECLARBODY>\n` +
    `</DECLAR>\n`
  );
}

/**
 * Файловий канал. Система кладе документ у теку обміну — M.E.Doc забирає її
 * своїм планувальником, «Вчасно» приймає ту саму теку через свій агент або
 * ручне завантаження архіву.
 *
 * Статус тут `sent`, а не `delivered`: файл лише покладено. Підтвердження
 * приходить із самого сервісу, і поставити його може лише людина або
 * майбутній зчитувач квитанцій.
 */
async function sendToFile(item: OutboxItem, settings: Settings): Promise<SendResult> {
  const dir = settings.export_dir?.trim();
  if (!dir) return { status: 'failed', error: 'Не задано теку обміну' };

  try {
    await mkdir(dir, { recursive: true });
    const path = join(dir, item.file_name);
    await writeFile(path, item.payload, 'utf8');
    return { status: 'sent', externalId: item.file_name, detail: path };
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : 'Не вдалося записати файл' };
  }
}

/**
 * REST-канал «Вчасно». Токен береться зі змінної середовища, назва якої
 * записана в налаштуваннях: у базі лежить лише посилання на секрет.
 */
async function sendToVchasno(item: OutboxItem, settings: Settings): Promise<SendResult> {
  const base = settings.api_base_url?.trim();
  const tokenEnv = settings.api_token_env?.trim();
  if (!base) return { status: 'failed', error: 'Не задано базову адресу API' };
  if (!tokenEnv) return { status: 'failed', error: 'Не вказано змінну середовища з токеном' };

  const token = process.env[tokenEnv];
  if (!token) {
    return { status: 'failed', error: `Змінна середовища ${tokenEnv} порожня — токен не заданий` };
  }

  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/documents`, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_name: item.file_name,
        content: Buffer.from(item.payload, 'utf8').toString('base64'),
        counterparty_edrpou: item.counterparty_id,
        doc_number: item.doc_number,
        doc_date: item.doc_date,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    const text = await response.text();
    if (response.status === 201 || response.ok) {
      let externalId: string | undefined;
      try {
        externalId = JSON.parse(text)?.id;
      } catch {
        // Сервіс міг відповісти не JSON — це не помилка відправки.
      }
      return { status: 'sent', externalId, detail: text.slice(0, 500) };
    }
    // 403 — прострочений токен, 429 — перевищено ліміт. Обидва варті повтору
    // руками, а не мовчазного «відхилено».
    return {
      status: response.status === 400 ? 'rejected' : 'failed',
      error: `HTTP ${response.status}: ${text.slice(0, 300)}`,
    };
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : 'Помилка мережі' };
  }
}

export async function sendDocument(item: OutboxItem, settings: Settings): Promise<SendResult> {
  if (settings.provider === 'file') return sendToFile(item, settings);
  if (settings.provider === 'vchasno') return sendToVchasno(item, settings);
  return { status: 'failed', error: 'Обмін документами вимкнено в налаштуваннях' };
}

export const PROVIDER_LABELS: Record<string, string> = {
  none: 'Вимкнено',
  file: 'Тека обміну (M.E.Doc)',
  vchasno: '«Вчасно» через API',
};

export const OUTBOX_STATUS_LABELS: Record<string, string> = {
  queued: 'У черзі',
  sent: 'Надіслано',
  delivered: 'Доставлено',
  rejected: 'Відхилено',
  failed: 'Помилка',
};

export const OUTBOX_DOC_LABELS: Record<string, string> = {
  tax_invoice: 'Податкова накладна',
  shipment: 'Видаткова накладна',
  customer_return: 'Повернення від клієнта',
  supplier_return: 'Повернення постачальнику',
};
