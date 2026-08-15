import type { Metadata } from "next";
import Link from "next/link";
import { CarPicker } from "@/components/car/CarPicker";
import { Breadcrumbs, Container } from "@/components/ui";
import { pluralize } from "@/lib/format";
import { getBrands, getCarTree } from "@/lib/queries";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Авточохли за марками авто — усі марки",
  description:
    "Модельні авточохли на 40 марок автомобілів. Оберіть марку, щоб побачити моделі з готовими лекалами та ціни на комплекти.",
};

export default async function BrandsPage() {
  const [brands, tree] = await Promise.all([getBrands(), getCarTree()]);
  const modelCount = tree.reduce((sum, brand) => sum + brand.models.length, 0);

  const popular = brands.filter((brand) => brand.popular);
  const rest = brands.filter((brand) => !brand.popular);

  return (
    <Container className="pb-16">
      <Breadcrumbs items={[{ href: "/", label: "Головна" }, { label: "Марки авто" }]} />

      <header className="max-w-3xl pb-8">
        <h1 className="text-3xl font-extrabold sm:text-4xl">
          Авточохли за маркою авто
        </h1>
        <p className="mt-3 text-lg text-ink-muted">
          У базі цеху {pluralize(brands.length, "марка", "марки", "марок")} і{" "}
          {pluralize(modelCount, "модель", "моделі", "моделей")} з готовими лекалами.
          Якщо вашої моделі немає — знімемо лекала з вашого салону.
        </p>
      </header>

      <div className="pb-10">
        <CarPicker tree={tree} />
      </div>

      <section className="pb-10">
        <h2 className="pb-4 text-xl font-bold">Популярні марки</h2>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-line bg-line sm:grid-cols-3 lg:grid-cols-4">
          {popular.map((brand) => (
            <Link
              key={brand.slug}
              href={`/chohly/${brand.slug}`}
              className="flex flex-col gap-1 bg-white px-5 py-4 transition-colors hover:bg-paper-warm"
            >
              <span className="font-display text-base font-bold">{brand.name}</span>
              <span className="text-xs text-ink-muted">
                {pluralize(brand._count.models, "модель", "моделі", "моделей")}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="pb-4 text-xl font-bold">Усі марки</h2>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
          {rest.map((brand) => (
            <Link
              key={brand.slug}
              href={`/chohly/${brand.slug}`}
              className="flex flex-col gap-0.5 bg-white px-4 py-3 transition-colors hover:bg-paper-warm"
            >
              <span className="text-sm font-semibold">{brand.name}</span>
              <span className="text-xs text-ink-muted">
                {brand._count.models}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </Container>
  );
}
