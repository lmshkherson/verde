import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductConfigurator } from "@/components/product/ProductConfigurator";
import { BreadcrumbJsonLd, ProductJsonLd } from "@/components/seo/JsonLd";
import { Badge, Breadcrumbs, Container, SectionHeading } from "@/components/ui";
import { formatDate, pluralize } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { tierLabels } from "@/lib/pricing";
import {
  getAddOns,
  getBodyFactors,
  getCarModel,
  getModelPrices,
  getSeriesBySlug,
} from "@/lib/queries";
import { site } from "@/lib/site";

export const revalidate = 300;

export async function generateStaticParams() {
  const list = await prisma.series.findMany({ select: { slug: true } });
  return list.map((item) => ({ slug: item.slug }));
}

export async function generateMetadata(
  props: PageProps<"/product/[slug]">,
): Promise<Metadata> {
  const { slug } = await props.params;
  const series = await getSeriesBySlug(slug);
  if (!series) return {};
  return {
    title: series.seoTitle ?? `Авточохли ${series.name}`,
    description: series.seoDescription ?? series.shortDescription,
    alternates: { canonical: `/product/${series.slug}` },
  };
}

export default async function ProductPage(props: PageProps<"/product/[slug]">) {
  const { slug } = await props.params;
  const search = await props.searchParams;

  const brandSlug = typeof search.brand === "string" ? search.brand : undefined;
  const modelSlug = typeof search.model === "string" ? search.model : undefined;
  const year = typeof search.year === "string" ? search.year : undefined;

  const [series, addOns, factors, materials, paletteRows] = await Promise.all([
    getSeriesBySlug(slug),
    getAddOns(),
    getBodyFactors(),
    prisma.material.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.palette.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  if (!series) notFound();

  const found =
    brandSlug && modelSlug ? await getCarModel(brandSlug, modelSlug) : null;

  const overrides = found ? await getModelPrices(found.model.id) : undefined;
  const bodyFactor = found
    ? (factors.byType.get(found.model.bodyType)?.factor ?? 1)
    : 1;

  const car = found
    ? {
        label: `${found.brand.name} ${found.model.name}${year ? `, ${year}` : ""}`,
        carModelId: found.model.id,
        brandSlug: found.brand.slug,
        modelSlug: found.model.slug,
      }
    : null;

  const features = JSON.parse(series.featuresJson) as string[];
  const includes = JSON.parse(series.includesJson) as string[];

  const specs = [
    { label: "Тип комплекту", value: tierLabels[series.tier] ?? series.tier },
    { label: "Матеріал", value: series.material.name },
    {
      label: "Ресурс матеріалу",
      value: pluralize(series.material.wearYears, "рік", "роки", "років"),
    },
    {
      label: "Гарантія",
      value: pluralize(series.warrantyMonths, "місяць", "місяці", "місяців"),
    },
    {
      label: "Строк пошиття",
      value: pluralize(
        series.productionDays,
        "робочий день",
        "робочі дні",
        "робочих днів",
      ),
    },
    { label: "Кольорів у лінійці", value: String(series.colors.length) },
    { label: "Догляд", value: series.material.careNotes ?? "—" },
    { label: "Виробництво", value: `Україна, ${site.showroom.city}` },
  ];

  const price = Math.round((series.basePrice * bodyFactor) / 10) * 10;
  const ratingSum = series.reviews.reduce((sum, review) => sum + review.rating, 0);

  return (
    <Container className="pb-16">
      <ProductJsonLd
        name={`Авточохли ${series.name}${car ? ` на ${car.label}` : ""}`}
        description={series.shortDescription}
        price={price}
        brandName={site.name}
        ratingValue={
          series.reviews.length
            ? Number((ratingSum / series.reviews.length).toFixed(1))
            : undefined
        }
        reviewCount={series.reviews.length || undefined}
      />
      <BreadcrumbJsonLd
        items={[
          { name: "Головна", url: "/" },
          { name: "Каталог", url: "/catalog" },
          { name: series.name, url: `/product/${series.slug}` },
        ]}
      />
      <Breadcrumbs
        items={[
          { href: "/", label: "Головна" },
          { href: "/catalog", label: "Каталог" },
          ...(found
            ? [
                { href: `/chohly/${found.brand.slug}`, label: found.brand.name },
                {
                  href: `/chohly/${found.brand.slug}/${found.model.slug}`,
                  label: found.model.name,
                },
              ]
            : []),
          { label: series.name },
        ]}
      />

      <header className="max-w-3xl pb-8">
        <div className="flex flex-wrap gap-2">
          <Badge tone="accent">{tierLabels[series.tier] ?? series.tier}</Badge>
          {series.popular ? <Badge tone="sale">Хіт продажів</Badge> : null}
        </div>
        <h1 className="mt-3 text-3xl font-extrabold sm:text-4xl">
          Авточохли {series.name}
          {car ? ` на ${car.label}` : ""}
        </h1>
        <p className="mt-3 text-lg text-ink-muted">{series.shortDescription}</p>
      </header>

      <ProductConfigurator
        series={{
          id: series.id,
          slug: series.slug,
          name: series.name,
          tier: series.tier,
          basePrice: series.basePrice,
          oldPrice: series.oldPrice,
          productionDays: series.productionDays,
          warrantyMonths: series.warrantyMonths,
          materialId: series.materialId,
          allowCustomColors: series.allowCustomColors,
        }}
        materials={materials.map((item) => ({
          id: item.id,
          slug: item.slug,
          name: item.name,
          shortName: item.shortName,
          wearYears: item.wearYears,
          surcharge: item.surcharge,
        }))}
        materialColors={paletteRows
          .filter((item) => item.kind === "material")
          .map((item) => ({
            id: item.id,
            slug: item.slug,
            name: item.name,
            hex: item.hex,
            surcharge: item.surcharge,
          }))}
        threadColors={paletteRows
          .filter((item) => item.kind === "thread")
          .map((item) => ({
            id: item.id,
            slug: item.slug,
            name: item.name,
            hex: item.hex,
            surcharge: item.surcharge,
          }))}
        logoAddOnSlug="vyshyvka-logo"
        colors={series.colors.map((color) => ({
          id: color.id,
          slug: color.slug,
          name: color.name,
          hex: color.hex,
          insertHex: color.insertHex,
          threadHex: color.threadHex,
          surcharge: color.surcharge,
        }))}
        addOns={addOns.map((item) => ({
          id: item.id,
          slug: item.slug,
          name: item.name,
          description: item.description,
          price: item.price,
        }))}
        bodyFactor={bodyFactor}
        overridePrice={overrides?.get(series.id) ?? null}
        car={car}
      />

      <section className="mt-14 grid gap-10 lg:grid-cols-[1fr_400px]">
        <div className="flex flex-col gap-8">
          <div>
            <h2 className="text-xl font-bold">Про лінійку</h2>
            <p className="mt-3 leading-relaxed text-ink-muted">
              {series.description}
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold">Особливості</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {features.map((item) => (
                <li key={item} className="flex gap-3 text-ink-muted">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 bg-tan" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-bold">Що входить у комплект</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {includes.map((item) => (
                <li key={item} className="flex gap-3 text-ink-muted">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 bg-ink" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-bold">Матеріал: {series.material.name}</h2>
            <p className="mt-3 leading-relaxed text-ink-muted">
              {series.material.description}
            </p>
          </div>
        </div>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <h2 className="pb-3 text-xl font-bold">Характеристики</h2>
          <dl className="overflow-hidden rounded-[4px] border border-line bg-white">
            {specs.map((spec, index) => (
              <div
                key={spec.label}
                className={`flex justify-between gap-4 px-4 py-3 text-sm ${
                  index > 0 ? "border-t border-line-soft" : ""
                }`}
              >
                <dt className="text-ink-muted">{spec.label}</dt>
                <dd className="text-right font-medium">{spec.value}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </section>

      {series.reviews.length > 0 ? (
        <section className="mt-14">
          <SectionHeading
            eyebrow="Відгуки"
            title={`Що кажуть про лінійку ${series.name}`}
            action={
              <Link
                href="/reviews"
                className="text-sm font-semibold text-tan-deep hover:underline"
              >
                Усі відгуки →
              </Link>
            }
          />
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {series.reviews.map((review) => (
              <figure
                key={review.id}
                className="flex flex-col gap-3 rounded-[4px] border border-line bg-white p-5"
              >
                <span className="text-tan" aria-label={`Оцінка ${review.rating} з 5`}>
                  {"★".repeat(review.rating)}
                  <span className="text-ink-faint">
                    {"★".repeat(5 - review.rating)}
                  </span>
                </span>
                <blockquote className="text-sm leading-relaxed text-ink-muted">
                  {review.text}
                </blockquote>
                <figcaption className="mt-auto border-t border-line-soft pt-3 text-sm">
                  <span className="font-semibold">{review.author}</span>
                  <span className="block text-xs text-ink-muted">
                    {review.carLabel} · {formatDate(review.createdAt)}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ) : null}
    </Container>
  );
}
