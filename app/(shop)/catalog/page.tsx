import type { Metadata } from "next";
import Link from "next/link";
import { CarPicker } from "@/components/car/CarPicker";
import { SeriesCard } from "@/components/catalog/SeriesCard";
import { Breadcrumbs, Container, EmptyState } from "@/components/ui";
import { pluralize } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { tierLabels } from "@/lib/pricing";
import {
  getSeatSets,
  getCarTree,
  getSeriesList,
  priceForSeatSet,
  priceFrom,
} from "@/lib/queries";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Каталог авточохлів — усі лінійки й матеріали",
  description:
    "Каталог авточохлів власного виробництва: універсальні, модельні з жакарду та екошкіри, преміум з алькантарою, індивідуальне пошиття. Ціни від 1690 ₴.",
};

type FilterLink = {
  label: string;
  value: string;
  count: number;
};

function buildHref(
  base: Record<string, string | undefined>,
  key: string,
  value: string | undefined,
) {
  const next = { ...base, [key]: value };
  const params = new URLSearchParams();
  for (const [name, item] of Object.entries(next)) {
    if (item) params.set(name, item);
  }
  const query = params.toString();
  return query ? `/catalog?${query}` : "/catalog";
}

function FilterGroup({
  title,
  options,
  active,
  paramKey,
  current,
}: {
  title: string;
  options: FilterLink[];
  active?: string;
  paramKey: string;
  current: Record<string, string | undefined>;
}) {
  return (
    <div className="border-b border-line-soft py-4 last:border-0">
      <h3 className="pb-3 text-sm font-bold">{title}</h3>
      <ul className="flex flex-col gap-1.5">
        <li>
          <Link
            href={buildHref(current, paramKey, undefined)}
            className={`flex justify-between gap-2 text-sm ${
              active ? "text-ink-muted hover:text-ink" : "font-semibold text-ink"
            }`}
          >
            Усі
          </Link>
        </li>
        {options.map((option) => {
          const selected = active === option.value;
          return (
            <li key={option.value}>
              <Link
                href={buildHref(
                  current,
                  paramKey,
                  selected ? undefined : option.value,
                )}
                className={`flex justify-between gap-2 text-sm ${
                  selected ? "font-semibold text-ink" : "text-ink-muted hover:text-ink"
                }`}
              >
                <span>{option.label}</span>
                <span className="tabular text-xs text-ink-faint">{option.count}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default async function CatalogPage(props: PageProps<"/catalog">) {
  const search = await props.searchParams;
  const tier = typeof search.tier === "string" ? search.tier : undefined;
  const material = typeof search.material === "string" ? search.material : undefined;
  const seatSet = typeof search.set === "string" ? search.set : undefined;
  const sort = typeof search.sort === "string" ? search.sort : undefined;

  const [seriesList, seatSets, tree, materials] = await Promise.all([
    getSeriesList(),
    getSeatSets(),
    getCarTree(),
    prisma.material.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  const current = { tier, material, set: seatSet, sort };
  const activeSet = seatSets.find((item) => item.slug === seatSet);

  const tierOptions: FilterLink[] = Object.entries(tierLabels)
    .map(([value, label]) => ({
      value,
      label,
      count: seriesList.filter((item) => item.tier === value).length,
    }))
    .filter((option) => option.count > 0);

  const materialOptions: FilterLink[] = materials
    .map((item) => ({
      value: item.slug,
      label: item.name,
      count: seriesList.filter((series) => series.materialId === item.id).length,
    }))
    .filter((option) => option.count > 0);

  const seatSetOptions: FilterLink[] = seatSets.map((row) => ({
    value: row.slug,
    label: row.name,
    count: seriesList.length,
  }));

  let filtered = seriesList;
  if (tier) filtered = filtered.filter((item) => item.tier === tier);
  if (material) {
    filtered = filtered.filter((item) => item.material.slug === material);
  }

  const priced = filtered.map((item) => {
    // Обраний варіант комплекту — точна ціна; без нього показуємо «від»
    const { price, oldPrice } = activeSet
      ? priceForSeatSet(item, activeSet.id)
      : priceFrom(item, seatSets, null);
    return { item, price, oldPrice };
  });

  if (sort === "price-asc") priced.sort((a, b) => a.price - b.price);
  if (sort === "price-desc") priced.sort((a, b) => b.price - a.price);



  return (
    <Container className="pb-16">
      <Breadcrumbs items={[{ href: "/", label: "Головна" }, { label: "Каталог" }]} />

      <header className="max-w-3xl pb-8">
        <h1 className="text-3xl font-extrabold sm:text-4xl">Каталог авточохлів</h1>
        <p className="mt-3 text-lg text-ink-muted">
          Усі лінійки власного виробництва. Ціна фіксована й залежить лише від
          того, скільки крісел закриваємо — марка авто на неї не впливає.
        </p>
      </header>

      <div className="pb-8">
        <CarPicker tree={tree} variant="compact" />
      </div>

      <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-[4px] border border-line bg-white px-5 py-2">
            <FilterGroup
              title="Тип комплекту"
              options={tierOptions}
              active={tier}
              paramKey="tier"
              current={current}
            />
            <FilterGroup
              title="Матеріал"
              options={materialOptions}
              active={material}
              paramKey="material"
              current={current}
            />
            <FilterGroup
              title="Варіант комплекту"
              options={seatSetOptions}
              active={seatSet}
              paramKey="set"
              current={current}
            />
          </div>
        </aside>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 pb-5">
            <p className="text-sm text-ink-muted">
              {pluralize(priced.length, "лінійка", "лінійки", "лінійок")}
              {activeSet ? ` · ціни за варіантом «${activeSet.name.toLowerCase()}»` : ""}
            </p>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-ink-muted">Сортувати:</span>
              <Link
                href={buildHref(current, "sort", undefined)}
                className={!sort ? "font-semibold" : "text-ink-muted hover:text-ink"}
              >
                За замовчуванням
              </Link>
              <Link
                href={buildHref(current, "sort", "price-asc")}
                className={
                  sort === "price-asc" ? "font-semibold" : "text-ink-muted hover:text-ink"
                }
              >
                Дешевші
              </Link>
              <Link
                href={buildHref(current, "sort", "price-desc")}
                className={
                  sort === "price-desc"
                    ? "font-semibold"
                    : "text-ink-muted hover:text-ink"
                }
              >
                Дорожчі
              </Link>
            </div>
          </div>

          {priced.length === 0 ? (
            <EmptyState
              title="За цими фільтрами нічого немає"
              description="Спробуйте зняти частину фільтрів або подивіться весь каталог."
              action={
                <Link
                  href="/catalog"
                  className="mt-2 inline-flex h-11 items-center rounded-[4px] bg-ink px-6 text-sm font-semibold text-paper"
                >
                  Скинути фільтри
                </Link>
              }
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {priced.map(({ item, price, oldPrice }) => (
                <SeriesCard
                  key={item.id}
                  series={item}
                  price={price}
                  oldPrice={oldPrice}
                  exact={Boolean(activeSet)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </Container>
  );
}
