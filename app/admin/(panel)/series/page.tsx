import { updateSeries } from "@/app/actions/admin";
import { Button } from "@/components/ui";
import { formatPriceWithCurrency } from "@/lib/format";
import { tierLabels } from "@/lib/pricing";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const inputClass =
  "h-10 w-full rounded-[4px] border border-line px-3 text-sm outline-none focus:border-ink";

export default async function AdminSeriesPage() {
  const [series, factors] = await Promise.all([
    prisma.series.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        material: true,
        _count: { select: { colors: true, orderItems: true } },
      },
    }),
    prisma.bodyFactor.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Лінійки чохлів</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Базова ціна вказана для кузова «седан». Для інших кузовів вона множиться
          на коефіцієнт:{" "}
          {factors
            .map((factor) => `${factor.label.toLowerCase()} ×${factor.factor}`)
            .join(", ")}
          .
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
                зараз: {formatPriceWithCurrency(item.basePrice)}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-ink-muted">
                  Базова ціна, ₴
                </span>
                <input
                  className={inputClass}
                  name="basePrice"
                  type="number"
                  min={1}
                  defaultValue={item.basePrice}
                  required
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-ink-muted">
                  Стара ціна, ₴ (0 — не показувати)
                </span>
                <input
                  className={inputClass}
                  name="oldPrice"
                  type="number"
                  min={0}
                  defaultValue={item.oldPrice}
                />
              </label>

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
