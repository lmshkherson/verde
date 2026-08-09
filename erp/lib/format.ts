const money = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 3 });
const dateFmt = new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });

export const fmtMoney = (n: number | null | undefined) => `${money.format(Number(n ?? 0))} грн`;
export const fmtNum = (n: number | null | undefined) => money.format(Number(n ?? 0));
export const fmtQty = (n: number | null | undefined, unit?: string) =>
  `${qtyFmt.format(Number(n ?? 0))}${unit ? ` ${unit}` : ''}`;

export const fmtDate = (d: string | Date | null | undefined) =>
  d ? dateFmt.format(typeof d === 'string' ? new Date(d) : d) : '—';

export const fmtPct = (n: number | null | undefined) => `${qtyFmt.format(Number(n ?? 0))}%`;

export const ITEM_KINDS: Record<string, string> = {
  raw: 'Сировина',
  packaging: 'Пакування',
  semi: 'Напівфабрикат',
  finished: 'Готова продукція',
};

export const UNITS: Record<string, string> = {
  kg: 'кг',
  g: 'г',
  l: 'л',
  ml: 'мл',
  pcs: 'шт',
  pack: 'уп',
};

export const CUSTOMER_KINDS: Record<string, string> = {
  network: 'Мережа',
  distributor: "Дистриб'ютор",
  pharmacy: 'Аптека',
  horeca: 'HoReCa',
  retail: 'Роздріб',
};

export const PRICE_LEVELS: Record<string, string> = {
  distributor: "Ціна дистриб'ютора",
  network: 'Ціна на мережу',
  rrp: 'РРЦ',
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
