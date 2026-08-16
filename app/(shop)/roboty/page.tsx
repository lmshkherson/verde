import type { Metadata } from "next";
import Link from "next/link";
import { ShowcaseCard } from "@/components/catalog/ShowcaseCard";
import { Breadcrumbs, ButtonLink, Container, EmptyState } from "@/components/ui";
import { pluralize } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Готові роботи — авточохли на конкретних авто з фото",
  description:
    "Фотографії наших комплектів у реальних салонах: конкретна модель авто, матеріал, кольори й ціна. Такий самий комплект пошиємо на ваше авто.",
  alternates: { canonical: "/roboty" },
};

export default async function WorksPage(props: PageProps<"/roboty">) {
  const search = await props.searchParams;
  const brandSlug = typeof search.brand === "string" ? search.brand : undefined;

  const works = await prisma.showcase.findMany({
    where: {
      published: true,
      ...(brandSlug
        ? { carModel: { brand: { slug: brandSlug } } }
        : {}),
    },
    orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
    include: {
      photos: { orderBy: { sortOrder: "asc" } },
      series: { select: { name: true } },
    },
  });

  // Марки для фільтра беремо лише ті, на які роботи справді є.
  const brands = await prisma.brand.findMany({
    where: { models: { some: { showcases: { some: { published: true } } } } },
    orderBy: { name: "asc" },
    select: { slug: true, name: true },
  });

  return (
    <Container className="pb-16">
      <Breadcrumbs
        items={[{ href: "/", label: "Головна" }, { label: "Готові роботи" }]}
      />

      <header className="max-w-3xl pb-8">
        <h1 className="text-3xl font-extrabold sm:text-4xl">Готові роботи</h1>
        <p className="mt-4 text-lg text-ink-muted">
          Це не рендери й не стокові знімки: кожне фото зняте в реальному салоні
          після встановлення. Знайдіть своє авто — і побачите, як виглядатиме
          результат. Такий самий комплект пошиємо на вашу машину.
        </p>
      </header>

      {brands.length > 1 ? (
        <div className="flex flex-wrap gap-2 pb-8">
          <Link
            href="/roboty"
            className={`rounded-[4px] border px-3 py-1.5 text-sm font-medium ${
              !brandSlug ? "border-ink bg-white" : "border-line text-ink-muted"
            }`}
          >
            Усі марки
          </Link>
          {brands.map((brand) => (
            <Link
              key={brand.slug}
              href={`/roboty?brand=${brand.slug}`}
              className={`rounded-[4px] border px-3 py-1.5 text-sm font-medium ${
                brandSlug === brand.slug
                  ? "border-ink bg-white"
                  : "border-line text-ink-muted"
              }`}
            >
              {brand.name}
            </Link>
          ))}
        </div>
      ) : null}

      {works.length === 0 ? (
        <EmptyState
          title="Тут скоро будуть фото наших робіт"
          description="Поки що оберіть дизайн у каталозі — покажемо матеріали, кольори й точну ціну для вашого авто."
          action={
            <ButtonLink href="/catalog" className="mt-2">
              До каталогу дизайнів
            </ButtonLink>
          }
        />
      ) : (
        <>
          <p className="pb-5 text-sm text-ink-muted">
            {pluralize(works.length, "робота", "роботи", "робіт")}
          </p>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {works.map((work) => (
              <ShowcaseCard key={work.id} work={work} />
            ))}
          </div>
        </>
      )}

      <section className="mt-12 rounded-[4px] border border-line bg-ink p-8 text-paper lg:p-10">
        <h2 className="text-2xl font-bold">Не знайшли своє авто серед робіт?</h2>
        <p className="mt-3 max-w-2xl text-paper/70">
          Це не означає, що ми не шиємо на нього. Лекала є на 247 моделей —
          просто ще не встигли відзняти всі. Оберіть дизайн у каталозі, і ми
          покажемо ціну для вашої моделі.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="/catalog" variant="accent">
            Обрати дизайн
          </ButtonLink>
          <ButtonLink
            href="/chohly"
            variant="outline"
            className="border-paper/30 text-paper hover:bg-paper hover:text-ink"
          >
            Підбір за маркою авто
          </ButtonLink>
        </div>
      </section>
    </Container>
  );
}
