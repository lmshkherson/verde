/**
 * Ціноутворення конфігуратора. Одне джерело правди для каталогу, картки товару,
 * кошика й адмінки — інакше ціна в кошику рано чи пізно розійдеться з ціною
 * на сторінці.
 *
 * Ціна фіксована за варіантом комплекту (передні 1+1, 1+2, повний на 5 або 7
 * місць) і не залежить від марки авто: марка визначає лише лекала. Зверху
 * додаються доплата за матеріал, за рідкісні кольори й обрані опції.
 *
 * Готові роботи (Showcase) сюди не входять — у них своя ціна на кожну картку.
 */

export type PricingInput = {
  /** Ціна лінійки за обраним варіантом комплекту */
  seatSetPrice: number;
  /** Різниця з базовим матеріалом лінійки; може бути відʼємною */
  materialDelta?: number;
  colorSurcharge?: number;
};

export function calcPrice({
  seatSetPrice,
  materialDelta = 0,
  colorSurcharge = 0,
}: PricingInput): number {
  const total = seatSetPrice + materialDelta + colorSurcharge;
  return Math.max(0, Math.round(total / 10) * 10);
}

export function discountPercent(price: number, oldPrice: number): number {
  if (!oldPrice || oldPrice <= price) return 0;
  return Math.round(((oldPrice - price) / oldPrice) * 100);
}

/**
 * Які варіанти комплекту доступні для конкретного авто.
 * Мікроавтобусний «1+2» не пропонуємо легковикам, а «7 місць» — пʼятимісним.
 */
export function availableSeatSets<
  T extends { minSeats: number; vanOnly: boolean; slug: string },
>(sets: T[], car: { seats: number; bodyType: string } | null): T[] {
  if (!car) return sets;
  const isVan = car.bodyType === "van" || car.bodyType === "minivan";
  return sets.filter((set) => {
    if (set.vanOnly && !isVan) return false;
    return car.seats >= set.minSeats;
  });
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
    label: "Курʼєр за адресою",
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
