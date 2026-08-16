import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShowcaseCard } from "@/components/catalog/ShowcaseCard";
import { ShowcaseBuy } from "@/components/product/ShowcaseBuy";
import { ShowcaseGallery } from "@/components/product/ShowcaseGallery";
import { BreadcrumbJsonLd, ProductJsonLd } from "@/components/seo/JsonLd";
import { Badge, Breadcrumbs, ButtonLink, Container, SectionHeading } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { site } from "@/lib/site";

export const revalidate = 300;

export async function generateStaticParams() {
  const works = await prisma.showcase.findMany({
    where: { published: true },
    select: { slug: true },
  });
  return works.map((work) => ({ slug: work.slug }));
}

async function loadWork(slug: string) {
  return prisma.showcase.findUnique({
    where: { slug },
    include: {
      photos: { orderBy: { sortOrder: "asc" } },
      series: true,
      carModel: { include: { brand: true } },
    },
  });
}

export async function generateMetadata(
  props: PageProps<"/roboty/[slug]">,
): Promise<Metadata> {
  const { slug } = await props.params;
  const work = await loadWork(slug);
  if (!work) return {};

  return {
    title: work.seoTitle ?? `Авточохли на ${work.carLabel} — фото нашої роботи`,
    description:
      work.seoDescription ??
      `Готовий комплект авточохлів на ${work.carLabel}. ${work.materialNote} ${work.colorNote}`.trim(),
    alternates: { canonical: `/roboty/${work.slug}` },
    openGraph: {
      type: "article",
      title: work.title,
      images: work.photos[0]?.url ? [work.photos[0].url] : undefined,
    },
  };
}

export default async function WorkPage(props: PageProps<"/roboty/[slug]">) {
  const { slug } = await props.params;
  const work = await loadWork(slug);

  if (!work || !work.published) notFound();

  const related = await prisma.showcase.findMany({
    where: {
      published: true,
      id: { not: work.id },
      ...(work.carModel ? { carModel: { brandId: work.carModel.brandId } } : {}),
    },
    take: 3,
    orderBy: { createdAt: "desc" },
    include: {
      photos: { orderBy: { sortOrder: "asc" } },
      series: { select: { name: true } },
    },
  });

  const productionDays = work.series?.productionDays ?? site.promises.productionDays;
  const warrantyMonths = work.series?.warrantyMonths ?? site.promises.warrantyMonths;

  return (
    <Container className="pb-16">
      <ProductJsonLd
        name={work.title}
        description={work.description || work.title}
        price={work.price}
        brandName={site.name}
      />
      <BreadcrumbJsonLd
        items={[
          { name: "Головна", url: "/" },
          { name: "Готові роботи", url: "/roboty" },
          { name: work.carLabel, url: `/roboty/${work.slug}` },
        ]}
      />

      <Breadcrumbs
        items={[
          { href: "/", label: "Головна" },
          { href: "/roboty", label: "Готові роботи" },
          ...(work.carModel
            ? [
                {
                  href: `/chohly/${work.carModel.brand.slug}`,
                  label: work.carModel.brand.name,
                },
              ]
            : []),
          { label: work.carLabel },
        ]}
      />

      <header className="max-w-3xl pb-8">
        <Badge tone="accent">Фото з нашої роботи</Badge>
        <h1 className="mt-3 text-3xl font-extrabold sm:text-4xl">{work.title}</h1>
        <p className="mt-3 text-lg text-ink-muted">
          Комплект пошитий і встановлений у нашому цеху. Усі фото — цей самий
          автомобіль, без ретуші й стокових знімків.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_400px]">
        <ShowcaseGallery photos={work.photos} carLabel={work.carLabel} />

        <div className="lg:sticky lg:top-28 lg:self-start">
          <ShowcaseBuy
            work={{
              slug: work.slug,
              carLabel: work.carLabel,
              price: work.price,
              oldPrice: work.oldPrice,
              materialNote: work.materialNote,
              colorNote: work.colorNote,
              carModelId: work.carModelId,
              seriesId: work.seriesId,
              seriesName: work.series?.name ?? null,
            }}
            productionDays={productionDays}
            warrantyMonths={warrantyMonths}
          />
        </div>
      </div>

      {work.description ? (
        <section className="mt-12 max-w-[68ch]">
          <h2 className="text-xl font-bold">Про цю роботу</h2>
          <p className="mt-3 leading-relaxed text-ink-muted">{work.description}</p>
        </section>
      ) : null}

      <section className="mt-12 rounded-[4px] border border-line bg-white p-6 lg:p-8">
        <h2 className="text-xl font-bold">Хочете так само, але в іншому кольорі?</h2>
        <p className="mt-2 max-w-2xl text-ink-muted">
          Той самий крій можна пошити в будь-якому поєднанні матеріалів, кольорів
          і строчки. Відкрийте конфігуратор — там видно, як виглядатиме ваш
          варіант, і скільки він коштує.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          {work.series ? (
            <ButtonLink
              href={
                work.carModel
                  ? `/product/${work.series.slug}?brand=${work.carModel.brand.slug}&model=${work.carModel.slug}`
                  : `/product/${work.series.slug}`
              }
            >
              Зібрати свій варіант
            </ButtonLink>
          ) : (
            <ButtonLink href="/catalog">Обрати дизайн</ButtonLink>
          )}
          {work.carModel ? (
            <Link
              href={`/chohly/${work.carModel.brand.slug}/${work.carModel.slug}`}
              className="inline-flex h-11 items-center rounded-[4px] border border-line px-6 text-sm font-semibold hover:border-ink"
            >
              Усі комплекти на {work.carModel.brand.name} {work.carModel.name}
            </Link>
          ) : null}
        </div>
      </section>

      {related.length > 0 ? (
        <section className="mt-12">
          <SectionHeading
            eyebrow="Схожі роботи"
            title={
              work.carModel
                ? `Інші роботи на ${work.carModel.brand.name}`
                : "Інші наші роботи"
            }
          />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((item) => (
              <ShowcaseCard key={item.id} work={item} />
            ))}
          </div>
        </section>
      ) : null}
    </Container>
  );
}
