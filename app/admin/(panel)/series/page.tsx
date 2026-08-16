import { updateSeries } from "@/app/actions/admin";
import { Button } from "@/components/ui";
import { formatPriceWithCurrency } from "@/lib/format";
import { tierLabels } from "@/lib/pricing";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const inputClass =
  "h-10 w-full rounded-[4px] border border-line px-3 text-sm outline-none focus:border-ink";

export default async function AdminSeriesPage() {
  const [series, seatSets] = await Promise.all([
    prisma.series.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        material: true,
        seatPrices: true,
        _count: { select: { colors: true, orderItems: true } },
      },
    }),
    prisma.seatSet.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Лінійки чохлів</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          Ціни фіксовані за варіантом комплекту й однакові для всіх марок авто.
          Порожнє поле означає, що варіант не продається — він зникне з
          конфігуратора.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {series.map((item) => (
          <form
            key={item.id}
            action={updateSeries}
            className="rounded-[4px] border border-line bg-white p-5"
          >
            <input type="hidden" name="id" value={item.id} />

            <div className="flex flex-wrap items-baseline justify-between gap-3 pb-4">
              <div>
                <h2 className="text-lg font-bold">{item.name}</h2>
                <p className="text-xs text-ink-muted">
                  {tierLabels[item.tier] ?? item.tier} · {item.material.name} ·{" "}
                  {item._count.colors} кольорів · продано{" "}
                  {item._count.orderItems} комплектів
                </p>
              </div>
              <p className="tabular text-sm text-ink-muted">
                повний на 5 місць:{" "}
                {formatPriceWithCurrency(
                  item.seatPrices.find(
                    (row) =>
                      row.seatSetId ===
                      seatSets.find((set) => set.slug === "full-5")?.id,
                  )?.price ?? 0,
                )}
              </p>
            </div>

            <div className="overflow-x-auto rounded-[4px] border border-line-soft">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="border-b border-line-soft bg-paper text-left">
                    <th className="px-3 py-2 font-semibold">Варіант комплекту</th>
                    <th className="w-32 px-3 py-2 font-semibold">Ціна, ₴</th>
                    <th className="w-32 px-3 py-2 font-semibold">Стара ціна, ₴</th>
                  </tr>
                </thead>
                <tbody>
                  {seatSets.map((set) => {
                    const row = item.seatPrices.find(
                      (price) => price.seatSetId === set.id,
                    );
                    return (
                      <tr key={set.id} className="border-b border-line-soft last:border-0">
                        <td className="px-3 py-2">
                          <span className="block font-medium">{set.name}</span>
                          <span className="block text-xs text-ink-muted">
                            {set.hint}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="h-9 w-full rounded-[4px] border border-line px-2 text-sm outline-none focus:border-ink"
                            name={`price-${set.id}`}
                            type="number"
                            min={0}
                            defaultValue={row?.price ?? ""}
                            placeholder="—"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="h-9 w-full rounded-[4px] border border-line px-2 text-sm outline-none focus:border-ink"
                            name={`old-${set.id}`}
                            type="number"
                            min={0}
                            defaultValue={row?.oldPrice || ""}
                            placeholder="—"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-ink-muted">
                  Пошиття, робочих днів
                </span>
                <input
                  className={inputClass}
                  name="productionDays"
                  type="number"
                  min={1}
                  defaultValue={item.productionDays}
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-ink-muted">
                  Гарантія, місяців
                </span>
                <input
                  className={inputClass}
                  name="warrantyMonths"
                  type="number"
                  min={1}
                  defaultValue={item.warrantyMonths}
                />
              </label>

              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-xs font-medium text-ink-muted">Підзаголовок</span>
                <input
                  className={inputClass}
                  name="tagline"
                  defaultValue={item.tagline}
                />
              </label>

              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-xs font-medium text-ink-muted">
                  Короткий опис
                </span>
                <input
                  className={inputClass}
                  name="shortDescription"
                  defaultValue={item.shortDescription}
                />
              </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-5 border-t border-line-soft pt-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={item.active}
                  className="h-4 w-4 accent-[#14161a]"
                />
                Показувати в каталозі
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="popular"
                  defaultChecked={item.popular}
                  className="h-4 w-4 accent-[#14161a]"
                />
                Позначка «хіт продажів»
              </label>
              <Button type="submit" size="sm" className="ml-auto">
                Зберегти
              </Button>
            </div>
          </form>
        ))}
      </div>
    </div>
  );
}
