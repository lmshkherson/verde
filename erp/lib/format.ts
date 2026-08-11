const money = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 3 });
const dateFmt = new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });

export const fmtMoney = (n: number | null | undefined) => `${money.format(Number(n ?? 0))} грн`;
export const fmtNum = (n: number | null | undefined) => money.format(Number(n ?? 0));
export const fmtQty = (n: number | null | undefined, unit?: string) =>
  `${qtyFmt.format(Number(n ?? 0))}${unit ? ` ${unit}` : ''}`;

export const fmtDate = (d: string | Date | null | undefined) =>
  d ? dateFmt.format(typeof d === 'string' ? new Date(d) : d) : '—';

// Для журналів моніторингу година має значення: запис «о 6:20» і «о 14:20»
// в одну добу — це різні зміни й різні відповідальні.
const dateTimeFmt = new Intl.DateTimeFormat('uk-UA', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export const fmtDateTime = (d: string | Date | null | undefined) =>
  d ? dateTimeFmt.format(typeof d === 'string' ? new Date(d) : d) : '—';

/**
 * Дата у вигляді YYYY-MM-DD для input[type=date] і порівнянь. Драйвер
 * повертає колонки типу date вже об'єктом Date, тож рядкові операції над
 * ними падають — саме тому це окремий хелпер, а не .slice(0, 10).
 */
export const isoDay = (d: string | Date | null | undefined): string | null => {
  if (!d) return null;
  const date = typeof d === 'string' ? new Date(d) : d;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const fmtPct = (n: number | null | undefined) => `${qtyFmt.format(Number(n ?? 0))}%`;

export const ITEM_KINDS: Record<string, string> = {
  raw: 'Сировина',
  packaging: 'Пакування',
  semi: 'Напівфабрикат',
  finished: 'Готова продукція',
  service: 'Послуга',
};

/** Типи, що лежать на складі. Послуга — ні: вона одразу йде у витрати. */
export const STOCK_ITEM_KINDS = ['raw', 'packaging', 'semi', 'finished'];

export const UNITS: Record<string, string> = {
  kg: 'кг',
  g: 'г',
  l: 'л',
  ml: 'мл',
  pcs: 'шт',
  pack: 'уп',
};

/**
 * Канал продажу — і хто клієнт, і за якою ціною йому продаємо: одне поняття
 * замість окремих «типу» і «рівня цін». Ціни в номенклатурі діляться саме
 * по цих каналах.
 */
export const SALES_CHANNELS: Record<string, string> = {
  site: 'Сайт',
  small_wholesale: 'Дрібний гурт',
  offices: 'Офіси',
  supermarkets: 'Супермаркети',
  distributors: "Дистриб'ютори",
  private_label: 'Private Label',
};

export const PO_STATUS: Record<string, string> = {
  draft: 'Чернетка',
  ordered: 'Замовлено',
  received: 'Отримано',
  cancelled: 'Скасовано',
};

export const SO_STATUS: Record<string, string> = {
  draft: 'Чернетка',
  confirmed: 'Підтверджено',
  shipped: 'Відвантажено',
  cancelled: 'Скасовано',
};

export const PROD_STATUS: Record<string, string> = {
  planned: 'Заплановано',
  in_progress: 'У роботі',
  done: 'Завершено',
  cancelled: 'Скасовано',
};

export const MOVE_TYPES: Record<string, string> = {
  opening: 'Початковий залишок',
  purchase_receipt: 'Прихід від постачальника',
  production_consume: 'Списано у виробництво',
  production_output: 'Випуск продукції',
  sale_shipment: 'Відвантаження клієнту',
  sale_return: 'Повернення від клієнта',
  purchase_return: 'Повернення постачальнику',
  write_off: 'Списання',
  adjustment: 'Коригування (інвентаризація)',
  transfer_in: 'Переміщення (прихід)',
  transfer_out: 'Переміщення (видаток)',
};

export const EXPENSE_CATEGORIES: Record<string, string> = {
  production_salary: 'Зарплата цеху',
  production_energy: 'Електроенергія цеху',
  rent: 'Оренда',
  salary: 'Зарплата й податки на неї',
  utilities: 'Комунальні та енергія',
  logistics: 'Логістика й доставка',
  marketing: 'Маркетинг і реклама',
  bank: 'Банківські послуги',
  services: 'Послуги підрядників',
  other: 'Інше',
};

/** Витрати цеху показуємо окремою групою: вони прямо стосуються випуску. */
export const PRODUCTION_EXPENSE_CATEGORIES = ['production_salary', 'production_energy'];

export const RETURN_REASONS: Record<string, string> = {
  surplus: 'Надлишок / не продалось',
  quality: 'Брак',
  expiry: 'Закінчився термін',
  other: 'Інше',
};

export const SUPPLIER_RETURN_REASONS: Record<string, string> = {
  quality: 'Брак / невідповідна якість',
  surplus: 'Надлишок / пересорт',
  expiry: 'Малий залишковий термін',
  other: 'Інше',
};

export const RETURN_STATUS: Record<string, string> = {
  draft: 'Чернетка',
  accepted: 'Прийнято',
  cancelled: 'Скасовано',
};

export const PAY_METHODS: Record<string, string> = {
  bank: 'Банк',
  cash: 'Готівка',
  other: 'Інше',
};

export const unitLabel = (u: string) => UNITS[u] ?? u;
