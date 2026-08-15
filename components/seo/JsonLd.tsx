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
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}

export function OrganizationJsonLd() {
  return (
    <JsonLdScript
      data={{
        "@context": "https://schema.org",
        "@type": "Organization",
        name: site.name,
        legalName: site.legalName,
        url: site.url,
        description: site.description,
        email: site.email,
        telephone: site.phones.map((phone) => phone.label),
        address: {
          "@type": "PostalAddress",
          addressLocality: site.showroom.city,
          streetAddress: site.showroom.address,
          addressCountry: "UA",
        },
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
