import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SeriesCard } from "@/components/catalog/SeriesCard";
import { ShowcaseCard } from "@/components/catalog/ShowcaseCard";
import { Badge, Breadcrumbs, ButtonLink, Container, SectionHeading } from "@/components/ui";
import { formatYears, pluralize } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import {
  getBodyFactors,
  getCarModel,
  getModelPrices,
  getSeriesList,
  priceFor,
} from "@/lib/queries";
import { site } from "@/lib/site";

export const revalidate = 300;

export async function generateStaticParams() {
  const models = await prisma.carModel.findMany({
    select: { slug: true, brand: { select: { slug: true } } },
  });
  return models.map((model) => ({
    brand: model.brand.slug,
    model: model.slug,
  }));
}

export async function generateMetadata(
  props: PageProps<"/chohly/[brand]/[model]">,
): Promise<Metadata> {
  const { brand: brandSlug, model: modelSlug } = await props.params;
  const found = await getCarModel(brandSlug, modelSlug);
  if (!found) return {};
  return {
    title: found.model.seoTitle ?? `Авточохли на ${found.brand.name} ${found.model.name}`,
    description: found.model.seoDescription ?? undefined,
    alternates: { canonical: `/chohly/${brandSlug}/${modelSlug}` },
  };
}

export default async function ModelPage(
  props: PageProps<"/chohly/[brand]/[model]">,
) {
  const { brand: brandSlug, model: modelSlug } = await props.params;
  const search = await props.searchParams;
  const year = typeof search.year === "string" ? search.year : undefined;

  const found = await getCarModel(brandSlug, modelSlug);
  if (!found) notFound();

  const { brand, model } = found;
  const [seriesList, factors, overrides, works] = await Promise.all([
    getSeriesList(),
    getBodyFactors(),
    getModelPrices(model.id),
    prisma.showcase.findMany({
      where: { published: true, carModelId: model.id },
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
      take: 6,
      include: {
        photos: { orderBy: { sortOrder: "asc" } },
        series: { select: { name: true } },
      },
    }),
  ]);

  const bodyLabel = factors.byType.get(model.bodyType)?.label ?? model.bodyType;
  const carLabel = `${brand.name} ${model.name}${year ? `, ${year}` : ""}`;

  const fitment = [
    {
      label: "Заднє сидіння",
      value: model.splitRearSeat ? "Ділене (40/60)" : "Суцільне",
    },
    {
      label: "Задній підлокітник",
      value: model.rearArmrest ? "Передбачений у лекалах" : "Немає в комплектації",
    },
    {
      label: "Airbag у спинках",
      value: model.airbagInBackrest
        ? "Є — шиємо розривний шов"
        : "Немає",
    },
    { label: "Кузов", value: bodyLabel },
    { label: "Місць у салоні", value: String(model.seats) },
    { label: "Роки випуску", value: formatYears(model.yearFrom, model.yearTo) },
  ];

  const carQuery = new URLSearchParams({
    brand: brand.slug,
    model: model.slug,
    ...(year ? { year } : {}),
  }).toString();

  return (
    <Container className="pb-16">
      <Breadcrumbs
        items={[
          { href: "/", label: "Головна" },
          { href: "/chohly", label: "Марки авто" },
          { href: `/chohly/${brand.slug}`, label: brand.name },
          { label: model.name },
        ]}
      />

      <header className="max-w-3xl pb-8">
        <Badge tone="accent">{bodyLabel}</Badge>
        <h1 className="mt-3 text-3xl font-extrabold sm:text-4xl">
          Авточохли на {brand.name} {model.name}
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          {formatYears(model.yearFrom, model.yearTo)}
          {year ? ` · обраний рік: ${year}` : ""}
        </p>
        <p className="mt-4 text-lg text-ink-muted">
          Лекала під цю модель уже в базі цеху. Ціни нижче розраховані саме для
          кузова «{bodyLabel.toLowerCase()}» — це не «від», а вартість комплекту на
          ваше авто.
        </p>
      </header>

      {/* Готові роботи саме на це авто — найсильніший доказ перед вибором дизайну */}
      {works.length > 0 ? (
        <section className="pb-12">
          <SectionHeading
            eyebrow="Наші роботи на це авто"
            title={`Фото комплектів на ${brand.name} ${model.name}`}
            description="Реальні знімки після встановлення. Можна замовити такий самий комплект — ціна вже порахована."
            action={
              <ButtonLink href="/roboty" variant="ghost" size="sm">
                Усі роботи
              </ButtonLink>
            }
          />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {works.map((work) => (
              <ShowcaseCard key={work.id} work={work} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Комплектація — те, на чому конкуренти найчастіше помиляються */}
      <section className="pb-10">
        <SectionHeading
          eyebrow="Що ми врахуємо при пошитті"
          title="Комплектація цієї моделі"
          description="Якщо ваша версія відрізняється — скажіть менеджеру, лекала скоригуємо до розкрою."
        />
        <dl className="grid gap-px overflow-hidden rounded-[4px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {fitment.map((item) => (
            <div key={item.label} className="bg-white px-5 py-4">
              <dt className="text-xs text-ink-muted">{item.label}</dt>
              <dd className="mt-1 font-semibold">{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <SectionHeading
          eyebrow={`Ціни на ${carLabel}`}
          title="Комплекти для цього авто"
          description={`Гарантія ${site.promises.warrantyMonths} місяців на кожну лінійку. Дату відправлення показуємо в картці комплекту.`}
        />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {seriesList.map((item) => {
            const { price, oldPrice } = priceFor(
              item,
              model.bodyType,
              factors.byType,
              overrides,
            );
            return (
              <SeriesCard
                key={item.id}
                series={item}
                price={price}
                oldPrice={oldPrice}
                exact
                href={`/product/${item.slug}?${carQuery}`}
              />
            );
          })}
        </div>
      </section>

      <section className="mt-12 grid gap-6 rounded-[4px] border border-line bg-white p-6 lg:grid-cols-2 lg:p-8">
        <div>
          <h2 className="text-xl font-bold">
            Скільки служать чохли на {brand.name} {model.name}
          </h2>
          <p className="mt-3 text-ink-muted">
            Найшвидше зношується місце посадки водія та бічна підтримка з боку
            дверей. Тому в лінійках «Комфорт» і «Престиж» саме ці зони закриті
            щільнішим матеріалом. Ресурс автотканини —{" "}
            {pluralize(4, "рік", "роки", "років")}, екошкіри —{" "}
            {pluralize(5, "рік", "роки", "років")}, преміальної екошкіри —{" "}
            {pluralize(6, "рік", "роки", "років")} щоденної експлуатації.
          </p>
        </div>
        <div>
          <h2 className="text-xl font-bold">Встановлення</h2>
          <p className="mt-3 text-ink-muted">
            Комплект ставиться без зняття сидінь приблизно за годину. У комплекті —
            кріплення, гачки та інструкція. Якщо не хочете возитись, привозьте авто
            в цех: встановлення займає дві години.
          </p>
          <Link
            href="/blog/yak-vstanovyty-chohly"
            className="mt-3 inline-block text-sm font-semibold text-tan-deep hover:underline"
          >
            Покрокова інструкція зі встановлення →
          </Link>
        </div>
      </section>
    </Container>
  );
}
