import { site } from "@/lib/site";

/**
 * Мікророзмітка для пошуку. JSON-LD віддається як текст усередині script —
 * дані формуємо самі, тому серіалізація безпечна; на всякий випадок екрануємо
 * послідовність, якою можна було б закрити тег.
 */
function JsonLdScript({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}

export function OrganizationJsonLd() {
  return (
    <JsonLdScript
      data={{
        "@context": "https://schema.org",
        // AutoPartsStore — підтип LocalBusiness: пошук і асистенти розуміють
        // і графік, і адресу, і те, що це магазин автотоварів, а не абстрактна фірма.
        "@type": "AutoPartsStore",
        "@id": `${site.url}/#store`,
        name: site.name,
        legalName: site.legalName,
        url: site.url,
        description: site.description,
        email: site.email,
        telephone: site.phones[0].label,
        priceRange: "₴₴",
        currenciesAccepted: "UAH",
        paymentAccepted: "Cash, Credit Card, Installments",
        address: {
          "@type": "PostalAddress",
          addressLocality: site.showroom.city,
          streetAddress: site.showroom.address,
          addressCountry: "UA",
        },
        openingHoursSpecification: [
          {
            "@type": "OpeningHoursSpecification",
            dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
            opens: "09:00",
            closes: "19:00",
          },
          {
            "@type": "OpeningHoursSpecification",
            dayOfWeek: "Saturday",
            opens: "10:00",
            closes: "16:00",
          },
        ],
        areaServed: { "@type": "Country", name: "Ukraine" },
        knowsLanguage: "uk",
      }}
    />
  );
}

export function WebSiteJsonLd() {
  return (
    <JsonLdScript
      data={{
        "@context": "https://schema.org",
        "@type": "WebSite",
        "@id": `${site.url}/#website`,
        name: site.name,
        url: site.url,
        description: site.description,
        inLanguage: "uk-UA",
        publisher: { "@id": `${site.url}/#store` },
      }}
    />
  );
}

export function ArticleJsonLd({
  title,
  description,
  url,
  datePublished,
}: {
  title: string;
  description: string;
  url: string;
  datePublished?: string;
}) {
  return (
    <JsonLdScript
      data={{
        "@context": "https://schema.org",
        "@type": "Article",
        headline: title,
        description,
        url: `${site.url}${url}`,
        inLanguage: "uk-UA",
        ...(datePublished ? { datePublished } : {}),
        author: { "@type": "Organization", name: site.name, url: site.url },
        publisher: { "@id": `${site.url}/#store` },
      }}
    />
  );
}

export function ProductJsonLd({
  name,
  description,
  price,
  brandName,
  ratingValue,
  reviewCount,
}: {
  name: string;
  description: string;
  price: number;
  brandName: string;
  ratingValue?: number;
  reviewCount?: number;
}) {
  return (
    <JsonLdScript
      data={{
        "@context": "https://schema.org",
        "@type": "Product",
        name,
        description,
        brand: { "@type": "Brand", name: brandName },
        offers: {
          "@type": "Offer",
          price,
          priceCurrency: "UAH",
          availability: "https://schema.org/InStock",
          seller: { "@type": "Organization", name: site.name },
        },
        ...(ratingValue && reviewCount
          ? {
              aggregateRating: {
                "@type": "AggregateRating",
                ratingValue,
                reviewCount,
              },
            }
          : {}),
      }}
    />
  );
}

/** Товар із діапазоном цін — для сторінок моделі авто, де кілька лінійок. */
export function ProductRangeJsonLd({
  name,
  description,
  url,
  lowPrice,
  highPrice,
  offerCount,
}: {
  name: string;
  description: string;
  url: string;
  lowPrice: number;
  highPrice: number;
  offerCount: number;
}) {
  return (
    <JsonLdScript
      data={{
        "@context": "https://schema.org",
        "@type": "Product",
        name,
        description,
        url: `${site.url}${url}`,
        brand: { "@type": "Brand", name: site.name },
        offers: {
          "@type": "AggregateOffer",
          lowPrice,
          highPrice,
          offerCount,
          priceCurrency: "UAH",
          availability: "https://schema.org/InStock",
          seller: { "@id": `${site.url}/#store` },
        },
      }}
    />
  );
}

export function BreadcrumbJsonLd({
  items,
}: {
  items: { name: string; url: string }[];
}) {
  return (
    <JsonLdScript
      data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: items.map((item, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: item.name,
          item: `${site.url}${item.url}`,
        })),
      }}
    />
  );
}

export function FaqJsonLd({ items }: { items: { q: string; a: string }[] }) {
  return (
    <JsonLdScript
      data={{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: items.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      }}
    />
  );
}
