import Link from "next/link";
import { formatYearsShort, pluralize } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminCarsPage(props: PageProps<"/admin/cars">) {
  const search = await props.searchParams;
  const brandSlug = typeof search.brand === "string" ? search.brand : undefined;

  const [brands, factors] = await Promise.all([
    prisma.brand.findMany({
      orderBy: [{ popular: "desc" }, { name: "asc" }],
      include: { _count: { select: { models: true } } },
    }),
    prisma.bodyFactor.findMany(),
  ]);

  const bodyLabels = new Map(factors.map((row) => [row.bodyType, row.label]));

  const selected = brandSlug
    ? await prisma.brand.findUnique({
        where: { slug: brandSlug },
        include: { models: { orderBy: [{ popular: "desc" }, { name: "asc" }] } },
      })
    : null;

  const totalModels = brands.reduce((sum, brand) => sum + brand._count.models, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">База авто</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {pluralize(brands.length, "марка", "марки", "марок")} і{" "}
          {pluralize(totalModels, "модель", "моделі", "моделей")} з лекалами. Кожна
          модель — окрема сторінка в пошуку.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <div className="flex max-h-[70vh] flex-col gap-px overflow-y-auto rounded-[4px] border border-line bg-line">
          {brands.map((brand) => (
            <Link
              key={brand.id}
              href={`/admin/cars?brand=${brand.slug}`}
              className={`flex items-center justify-between gap-2 px-4 py-2.5 text-sm transition-colors ${
                brandSlug === brand.slug
                  ? "bg-ink text-paper"
                  : "bg-white hover:bg-paper-warm"
              }`}
            >
              <span className="font-medium">{brand.name}</span>
              <span className="tabular text-xs opacity-60">
                {brand._count.models}
              </span>
            </Link>
          ))}
        </div>

        <div>
          {!selected ? (
            <p className="rounded-[4px] border border-line bg-white p-6 text-sm text-ink-muted">
              Оберіть марку зліва, щоб побачити моделі та їхні комплектації.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-[4px] border border-line bg-white">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="border-b border-line bg-paper-warm text-left">
                    <th className="px-4 py-3 font-semibold">Модель</th>
                    <th className="px-4 py-3 font-semibold">Кузов</th>
                    <th className="px-4 py-3 font-semibold">Роки</th>
                    <th className="px-4 py-3 font-semibold">Заднє сидіння</th>
                    <th className="px-4 py-3 font-semibold">Airbag у спинці</th>
                    <th className="px-4 py-3 font-semibold">Сторінка</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.models.map((model) => (
                    <tr
                      key={model.id}
                      className="border-b border-line-soft last:border-0"
                    >
                      <td className="px-4 py-3 font-medium">
                        {model.name}
                        {model.popular ? (
                          <span className="ml-2 rounded-[3px] bg-tan-soft px-1.5 py-0.5 text-[0.65rem] font-semibold text-tan-deep">
                            популярна
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-ink-muted">
                        {bodyLabels.get(model.bodyType) ?? model.bodyType}
                      </td>
                      <td className="tabular px-4 py-3 text-ink-muted">
                        {formatYearsShort(model.yearFrom, model.yearTo)}
                      </td>
                      <td className="px-4 py-3 text-ink-muted">
                        {model.splitRearSeat ? "Ділене" : "Суцільне"}
                        {model.rearArmrest ? ", підлокітник" : ""}
                      </td>
                      <td className="px-4 py-3 text-ink-muted">
                        {model.airbagInBackrest ? "Так" : "Ні"}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/chohly/${selected.slug}/${model.slug}`}
                          className="font-semibold hover:underline"
                        >
                          Відкрити →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
