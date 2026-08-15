/**
 * Ціноутворення. Одне джерело правди для каталогу, картки товару, кошика й адмінки —
 * інакше ціна в кошику рано чи пізно розійдеться з ціною на сторінці.
 *
 * Ціна = базова ціна серії × коефіцієнт кузова + доплата за колір,
 * округлена до 10 грн. Точкове перевизначення в ModelPrice має пріоритет над формулою.
 */

export type PricingInput = {
  basePrice: number;
  bodyFactor?: number;
  colorSurcharge?: number;
  /** Ціна з ModelPrice, якщо для цієї пари серія + модель авто задано вручну */
  overridePrice?: number | null;
};

export function calcPrice({
  basePrice,
  bodyFactor = 1,
  colorSurcharge = 0,
  overridePrice = null,
}: PricingInput): number {
  const base = overridePrice ?? basePrice * bodyFactor;
  return Math.round((base + colorSurcharge) / 10) * 10;
}

/** Стара ціна масштабується тим самим коефіцієнтом, щоб економія лишалась чесною. */
export function calcOldPrice({
  oldPrice,
  bodyFactor = 1,
}: {
  oldPrice: number;
  bodyFactor?: number;
}): number {
  if (!oldPrice) return 0;
  return Math.round((oldPrice * bodyFactor) / 10) * 10;
}

export function discountPercent(price: number, oldPrice: number): number {
  if (!oldPrice || oldPrice <= price) return 0;
  return Math.round(((oldPrice - price) / oldPrice) * 100);
}

/** Вартість доставки. Від певної суми беремо на себе. */
export function deliveryCost(
  itemsTotal: number,
  method: string,
  freeFrom: number,
): number {
  if (method === "pickup") return 0;
  if (itemsTotal >= freeFrom) return 0;
  if (method === "courier") return 150;
  return 90;
}

export const tierLabels: Record<string, string> = {
  universal: "Універсальні",
  basic: "Модельні базові",
  eco: "Модельні екошкіра",
  premium: "Преміум",
  individual: "Індивідуальне пошиття",
};

export const deliveryMethods = [
  {
    slug: "nova_poshta_branch",
    label: "Нова пошта, відділення",
    hint: "1–2 дні по Україні",
    needsWarehouse: true,
  },
  {
    slug: "nova_poshta_locker",
    label: "Нова пошта, поштомат",
    hint: "До 30 кг, цілодобово",
    needsWarehouse: true,
  },
  {
    slug: "ukrposhta",
    label: "Укрпошта",
    hint: "2–4 дні, дешевше",
    needsWarehouse: true,
  },
  {
    slug: "courier",
    label: "Кур'єр за адресою",
    hint: "По місту, у зручний час",
    needsWarehouse: false,
  },
  {
    slug: "pickup",
    label: "Самовивіз із цеху",
    hint: "Київ, вул. Прикладна, 1",
    needsWarehouse: false,
  },
] as const;

export const paymentMethods = [
  {
    slug: "cod",
    label: "Накладений платіж",
    hint: "Оплата при отриманні, передоплата 500 ₴",
  },
  {
    slug: "card_online",
    label: "Картка онлайн",
    hint: "Visa, Mastercard, Apple Pay, Google Pay",
  },
  {
    slug: "installments",
    label: "Оплата частинами",
    hint: "До 4 платежів без переплати",
  },
  {
    slug: "invoice",
    label: "Рахунок для юрособи",
    hint: "З ПДВ, для автопарків і компаній",
  },
] as const;

export const orderStatuses: Record<string, { label: string; tone: string }> = {
  new: { label: "Нове", tone: "bg-tan-soft text-tan-deep" },
  confirmed: { label: "Підтверджене", tone: "bg-paper-warm text-ink" },
  production: { label: "У пошитті", tone: "bg-paper-warm text-ink" },
  shipped: { label: "Відправлене", tone: "bg-ok-soft text-ok" },
  done: { label: "Виконане", tone: "bg-ok-soft text-ok" },
  canceled: { label: "Скасоване", tone: "bg-paper-warm text-ink-muted" },
};
