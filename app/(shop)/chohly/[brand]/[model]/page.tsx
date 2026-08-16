import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SeriesCard } from "@/components/catalog/SeriesCard";
import { ShowcaseCard } from "@/components/catalog/ShowcaseCard";
import { ModelFaq } from "@/components/seo/ModelFaq";
import { BreadcrumbJsonLd, ProductRangeJsonLd } from "@/components/seo/JsonLd";
import { Badge, Breadcrumbs, ButtonLink, Container, SectionHeading } from "@/components/ui";
import { formatPriceWithCurrency, formatYears, pluralize } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import {
  getBodyFactors,
  getCarModel,
  getSeatSets,
  getSeriesList,
  priceFrom,
} from "@/lib/queries";
import { availableSeatSets } from "@/lib/pricing";
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
  const [seriesList, factors, seatSets, works] = await Promise.all([
    getSeriesList(),
    getBodyFactors(),
    getSeatSets(),
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
  const car = { seats: model.seats, bodyType: model.bodyType };
  const sets = availableSeatSets(seatSets, car);
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

  // Діапазон цін для розмітки: усі доступні варіанти всіх лінійок
  const allPrices = seriesList
    .flatMap((series) =>
      series.seatPrices
        .filter((price) => sets.some((set) => set.id === price.seatSetId))
        .map((price) => price.price),
    )
    .filter((price) => price > 0);

  return (
    <Container className="pb-16">
      {allPrices.length > 0 ? (
        <ProductRangeJsonLd
          name={`Авточохли на ${brand.name} ${model.name}`}
          description={`Модельні авточохли на ${brand.name} ${model.name} за лекалами виробника. Гарантія ${site.promises.warrantyMonths} місяців, доставка по Україні.`}
          url={`/chohly/${brand.slug}/${model.slug}`}
          lowPrice={Math.min(...allPrices)}
          highPrice={Math.max(...allPrices)}
          offerCount={allPrices.length}
        />
      ) : null}
      <BreadcrumbJsonLd
        items={[
          { name: "Головна", url: "/" },
          { name: "Марки авто", url: "/chohly" },
          { name: brand.name, url: `/chohly/${brand.slug}` },
          { name: model.name, url: `/chohly/${brand.slug}/${model.slug}` },
        ]}
      />
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
          Лекала під цю модель уже в базі цеху. Ціна залежить від того, скільки
          крісел закриваємо: тільки передні чи весь салон. Марка на вартість не
          впливає.
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

      {/* Прайс за варіантами комплекту — головна відповідь на «скільки коштує» */}
      <section className="pb-12">
        <SectionHeading
          eyebrow={`Ціни на ${carLabel}`}
          title="Скільки коштує за варіантом комплекту"
          description="Ціни фіксовані. Обираєте, що саме закриваємо — і бачите суму."
        />
        <div className="overflow-x-auto rounded-[4px] border border-line bg-white">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line bg-paper-warm text-left">
                <th className="px-4 py-3 font-semibold">Варіант комплекту</th>
                {seriesList.map((item) => (
                  <th key={item.id} className="px-4 py-3 font-semibold">
                    {item.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sets.map((set) => (
                <tr key={set.id} className="border-b border-line-soft last:border-0">
                  <td className="px-4 py-3">
                    <span className="block font-medium">{set.name}</span>
                    <span className="block text-xs text-ink-muted">{set.hint}</span>
                  </td>
                  {seriesList.map((item) => {
                    const row = item.seatPrices.find(
                      (price) => price.seatSetId === set.id,
                    );
                    return (
                      <td key={item.id} className="tabular px-4 py-3 font-semibold">
                        {row
                          ? formatPriceWithCurrency(row.price)
                          : <span className="text-ink-faint">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <SectionHeading
          eyebrow="Лінійки"
          title="Комплекти для цього авто"
          description={`Гарантія ${site.promises.warrantyMonths} місяців на кожну лінійку. Дату відправлення показуємо в картці комплекту.`}
        />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {seriesList.map((item) => {
            const { price, oldPrice } = priceFrom(item, seatSets, car);
            return (
              <SeriesCard
                key={item.id}
                series={item}
                price={price}
                oldPrice={oldPrice}
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

      <ModelFaq
        brandName={brand.name}
        model={model}
        seriesList={seriesList}
        sets={sets}
      />
    </Container>
  );
}
