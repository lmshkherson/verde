/**
 * Єдине місце з даними бренду. Щоб змінити назву магазину, домен чи телефони —
 * правимо тільки цей файл, решта проєкту тягне значення звідси.
 *
 * ЩЕ НЕ ПІДТВЕРДЖЕНО клієнтом і поки що заповнено орієнтовно:
 * телефони, email, месенджери, адреса цеху, графік роботи.
 */
export const site = {
  name: "Авто-Юа",
  legalName: "Авто-Юа",
  domain: "avtochehol.in.ua",
  url: "https://avtochehol.in.ua",
  tagline: "Авточохли власного виробництва",
  description:
    "Модельні авточохли власного виробництва під конкретну модель і комплектацію авто. Понад 10 років на ринку України, гарантія 18 місяців, доставка по Україні.",

  /// Скільки років компанія на ринку — використовується в текстах про виробництво
  yearsOnMarket: 10,

  phones: [
    { label: "+38 (067) 000-00-00", href: "tel:+380670000000" },
    { label: "+38 (050) 000-00-00", href: "tel:+380500000000" },
  ],
  email: "info@avtochehol.in.ua",
  messengers: {
    viber: "viber://chat?number=%2B380670000000",
    telegram: "https://t.me/",
  },

  schedule: "Пн–Пт 9:00–19:00 · Сб 10:00–16:00",
  showroom: {
    city: "Київ",
    address: "вул. Прикладна, 1",
    mapUrl: "https://maps.google.com/?q=Kyiv",
  },

  /// Ключові обіцянки, які повторюються в шапці, картці товару й футері
  promises: {
    warrantyMonths: 18,
    productionDays: 5,
    returnDays: 14,
    freeShippingFrom: 3000,
  },

  social: {
    instagram: "https://instagram.com/",
    facebook: "https://facebook.com/",
    youtube: "https://youtube.com/",
  },
} as const;

export type Site = typeof site;
