import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CarPicker } from "@/components/car/CarPicker";
import { Breadcrumbs, Container, SectionHeading } from "@/components/ui";
import { formatPriceWithCurrency, formatYearsShort, pluralize } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import {
  getBodyFactors,
  getBrandBySlug,
  getCarTree,
  getSeriesList,
  priceFrom,
} from "@/lib/queries";

export const revalidate = 300;

export async function generateStaticParams() {
  const brands = await prisma.brand.findMany({ select: { slug: true } });
  return brands.map((brand) => ({ brand: brand.slug }));
}

export async function generateMetadata(
  props: PageProps<"/chohly/[brand]">,
): Promise<Metadata> {
  const { brand: slug } = await props.params;
  const brand = await getBrandBySlug(slug);
  if (!brand) return {};
  return {
    title: brand.seoTitle ?? `Авточохли на ${brand.name}`,
    description: brand.seoDescription ?? undefined,
    alternates: { canonical: `/chohly/${brand.slug}` },
  };
}

export default async function BrandPage(props: PageProps<"/chohly/[brand]">) {
  const { brand: slug } = await props.params;
  const [brand, seriesList, factors, tree] = await Promise.all([
    getBrandBySlug(slug),
    getSeriesList(),
    getBodyFactors(),
    getCarTree(),
  ]);

  if (!brand) notFound();

  const { models, slug: brandSlug } = brand;
  const popular = models.filter((model) => model.popular);
  const rest = models.filter((model) => !model.popular);

  function renderModel(model: (typeof models)[number]) {
    const from = priceFrom(seriesList, model.bodyType, factors.byType);
    return (
      <Link
        key={model.id}
        href={`/chohly/${brandSlug}/${model.slug}`}
        className="flex items-center justify-between gap-4 bg-white px-5 py-4 transition-colors hover:bg-paper-warm"
      >
        <span className="min-w-0">
          <span className="block truncate font-semibold">{model.name}</span>
          <span className="block text-xs text-ink-muted">
            {formatYearsShort(model.yearFrom, model.yearTo)} ·{" "}
            {factors.byType.get(model.bodyType)?.label ?? model.bodyType}
          </span>
        </span>
        <span className="tabular shrink-0 text-sm font-semibold">
          від {formatPriceWithCurrency(from)}
        </span>
      </Link>
    );
  }

  return (
    <Container className="pb-16">
      <Breadcrumbs
        items={[
          { href: "/", label: "Головна" },
          { href: "/chohly", label: "Марки авто" },
          { label: brand.name },
        ]}
      />

      <header className="max-w-3xl pb-8">
        <h1 className="text-3xl font-extrabold sm:text-4xl">
          Авточохли на {brand.name}
        </h1>
        <p className="mt-3 text-lg text-ink-muted">{brand.intro}</p>
        <p className="mt-2 text-sm text-ink-muted">
          Готові лекала на{" "}
          {pluralize(models.length, "модель", "моделі", "моделей")}.
        </p>
      </header>

      <div className="pb-10">
        <CarPicker tree={tree} variant="compact" initialBrand={brand.slug} />
      </div>

      {popular.length > 0 ? (
        <section className="pb-10">
          <SectionHeading
            title={`Популярні моделі ${brand.name}`}
            description="Ці моделі замовляють найчастіше — лекала перевірені сотнями комплектів."
          />
          <div className="grid gap-px overflow-hidden rounded-[4px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {popular.map(renderModel)}
          </div>
        </section>
      ) : null}

      {rest.length > 0 ? (
        <section>
          <SectionHeading title={`Усі моделі ${brand.name}`} />
          <div className="grid gap-px overflow-hidden rounded-[4px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {rest.map(renderModel)}
          </div>
        </section>
      ) : null}

      <section className="mt-12 rounded-[4px] border border-line bg-white p-6">
        <h2 className="text-lg font-bold">Не знайшли свою модель {brand.name}?</h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          Ми постійно додаємо лекала. Залиште заявку — уточнимо комплектацію й
          скажемо строк. Для рідкісних версій знімаємо лекала з вашого авто в цеху.
        </p>
        <Link
          href="/individual"
          className="mt-4 inline-flex h-11 items-center rounded-[4px] bg-ink px-6 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
        >
          Залишити заявку
        </Link>
      </section>
    </Container>
  );
}
