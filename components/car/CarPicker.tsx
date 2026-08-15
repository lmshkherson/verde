"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui";
import type { CarTree } from "@/lib/queries";

type Props = {
  tree: CarTree;
  /** compact — для внутрішніх сторінок, hero — для першого екрана */
  variant?: "hero" | "compact";
  initialBrand?: string;
  initialModel?: string;
};

const selectClass =
  "h-12 w-full rounded-[4px] border border-line bg-white px-3 text-[0.95rem] text-ink outline-none transition-colors focus:border-ink disabled:bg-paper-warm disabled:text-ink-faint";

export function CarPicker({
  tree,
  variant = "hero",
  initialBrand = "",
  initialModel = "",
}: Props) {
  const router = useRouter();
  const [brandSlug, setBrandSlug] = useState(initialBrand);
  const [modelSlug, setModelSlug] = useState(initialModel);
  const [year, setYear] = useState("");

  const brand = useMemo(
    () => tree.find((item) => item.slug === brandSlug),
    [tree, brandSlug],
  );

  const model = useMemo(
    () => brand?.models.find((item) => item.slug === modelSlug),
    [brand, modelSlug],
  );

  // Роки показуємо тільки в межах випуску обраної моделі —
  // так покупець не вибере рік, для якого лекал не існує.
  const years = useMemo(() => {
    if (!model) return [];
    const to = model.yearTo ?? new Date().getFullYear();
    const list: number[] = [];
    for (let value = to; value >= model.yearFrom; value -= 1) list.push(value);
    return list;
  }, [model]);

  function submit() {
    if (!brandSlug || !modelSlug) return;
    const query = year ? `?year=${year}` : "";
    router.push(`/chohly/${brandSlug}/${modelSlug}${query}`);
  }

  const hero = variant === "hero";

  return (
    <div
      className={
        hero
          ? "rounded-[6px] border border-line bg-white p-5 shadow-[0_20px_60px_-40px_rgba(20,22,26,0.6)] sm:p-6"
          : "rounded-[4px] border border-line bg-white p-4"
      }
    >
      {hero ? (
        <div className="mb-4">
          <p className="label">Крок 1 — підбір за авто</p>
          <p className="mt-1 text-sm text-ink-muted">
            Оберіть авто, і ми покажемо лише ті комплекти, лекала яких у нас є.
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto]">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-ink-muted">Марка</span>
          <select
            className={selectClass}
            value={brandSlug}
            onChange={(event) => {
              setBrandSlug(event.target.value);
              setModelSlug("");
              setYear("");
            }}
          >
            <option value="">Оберіть марку</option>
            {tree.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-ink-muted">Модель</span>
          <select
            className={selectClass}
            value={modelSlug}
            disabled={!brand}
            onChange={(event) => {
              setModelSlug(event.target.value);
              setYear("");
            }}
          >
            <option value="">
              {brand ? "Оберіть модель" : "Спершу марка"}
            </option>
            {brand?.models.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-ink-muted">Рік</span>
          <select
            className={`${selectClass} lg:w-28`}
            value={year}
            disabled={!model}
            onChange={(event) => setYear(event.target.value)}
          >
            <option value="">Будь-який</option>
            {years.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="hidden text-xs font-semibold text-ink-muted lg:block">
            &nbsp;
          </span>
          <Button
            type="button"
            onClick={submit}
            disabled={!brandSlug || !modelSlug}
            className="h-12 w-full lg:w-auto"
          >
            Підібрати чохли
          </Button>
        </div>
      </div>

      {hero ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line-soft pt-4">
          <span className="text-xs text-ink-muted">Часто шукають:</span>
          {tree
            .filter((item) => item.popular)
            .slice(0, 8)
            .map((item) => (
              <button
                key={item.slug}
                type="button"
                onClick={() => {
                  setBrandSlug(item.slug);
                  setModelSlug("");
                  setYear("");
                }}
                className="rounded-[3px] border border-line px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:border-ink hover:text-ink"
              >
                {item.name}
              </button>
            ))}
        </div>
      ) : null}
    </div>
  );
}
