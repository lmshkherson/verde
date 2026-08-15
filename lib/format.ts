/** Форматування чисел, дат і телефонів у звичному для українського покупця вигляді. */

export function formatPrice(value: number): string {
  return new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPriceWithCurrency(value: number): string {
  return `${formatPrice(value)} ₴`;
}

export function formatDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("uk-UA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Роки випуску моделі: «2013–2020» або «2020 — випускається». */
export function formatYears(yearFrom: number, yearTo: number | null): string {
  return yearTo ? `${yearFrom}–${yearTo}` : `${yearFrom} — випускається`;
}

export function formatYearsShort(yearFrom: number, yearTo: number | null): string {
  return yearTo ? `${yearFrom}–${yearTo}` : `${yearFrom}+`;
}

/**
 * Дата відправлення з урахуванням робочих днів.
 * Конкурентів на цьому й ловимо: показуємо конкретний день, а не «уточнюйте».
 */
export function shippingDate(productionDays: number, from = new Date()): Date {
  const date = new Date(from);
  let added = 0;
  while (added < productionDays) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return date;
}

export function formatShippingDate(productionDays: number): string {
  return new Intl.DateTimeFormat("uk-UA", {
    day: "numeric",
    month: "long",
  }).format(shippingDate(productionDays));
}

/** Українські відмінки: 1 відгук, 2 відгуки, 5 відгуків. */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function pluralize(count: number, one: string, few: string, many: string): string {
  return `${count} ${plural(count, one, few, many)}`;
}

/** Платіж частинами: скільки виходить на місяць. */
export function installment(total: number, months = 4): number {
  return Math.ceil(total / months / 10) * 10;
}
