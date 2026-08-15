"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCart } from "@/components/cart/CartProvider";
import { SeatPreview } from "@/components/product/SeatPreview";
import { Badge, Button, Price } from "@/components/ui";
import {
  formatPriceWithCurrency,
  formatShippingDate,
  installment,
  pluralize,
} from "@/lib/format";
import { calcOldPrice, calcPrice } from "@/lib/pricing";

export type ConfiguratorColor = {
  id: number;
  slug: string;
  name: string;
  hex: string;
  insertHex: string;
  threadHex: string;
  surcharge: number;
};

export type ConfiguratorAddOn = {
  id: number;
  slug: string;
  name: string;
  description: string;
  price: number;
};

type Props = {
  series: {
    id: number;
    slug: string;
    name: string;
    tier: string;
    basePrice: number;
    oldPrice: number;
    productionDays: number;
    warrantyMonths: number;
  };
  colors: ConfiguratorColor[];
  addOns: ConfiguratorAddOn[];
  /** Коефіцієнт кузова обраного авто; 1, якщо авто ще не обрано */
  bodyFactor: number;
  overridePrice: number | null;
  car: {
    label: string;
    carModelId: number;
    brandSlug: string;
    modelSlug: string;
  } | null;
};

export function ProductConfigurator({
  series,
  colors,
  addOns,
  bodyFactor,
  overridePrice,
  car,
}: Props) {
  const { add } = useCart();
  const [colorId, setColorId] = useState(colors[0]?.id ?? 0);
  const [selectedAddOns, setSelectedAddOns] = useState<number[]>([]);
  const [added, setAdded] = useState(false);

  const color = colors.find((item) => item.id === colorId) ?? colors[0];

  const basePrice = useMemo(
    () =>
      calcPrice({
        basePrice: series.basePrice,
        bodyFactor,
        colorSurcharge: color?.surcharge ?? 0,
        overridePrice,
      }),
    [series.basePrice, bodyFactor, color?.surcharge, overridePrice],
  );

  const oldPrice = useMemo(
    () => calcOldPrice({ oldPrice: series.oldPrice, bodyFactor }),
    [series.oldPrice, bodyFactor],
  );

  const addOnsTotal = addOns
    .filter((item) => selectedAddOns.includes(item.id))
    .reduce((sum, item) => sum + item.price, 0);

  const total = basePrice + addOnsTotal;

  function toggleAddOn(id: number) {
    setSelectedAddOns((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
    setAdded(false);
  }

  function addToCart() {
    if (!color) return;
    add({
      seriesId: series.id,
      seriesSlug: series.slug,
      seriesName: series.name,
      carLabel: car?.label ?? "Універсальний комплект",
      carModelId: car?.carModelId ?? null,
      colorName: color.name,
      colorHex: color.hex,
      colorInsertHex: color.insertHex,
      colorThreadHex: color.threadHex,
      quilting: series.tier === "premium",
      options: addOns
        .filter((item) => selectedAddOns.includes(item.id))
        .map((item) => ({ slug: item.slug, name: item.name, price: item.price })),
      unitPrice: total,
      quantity: 1,
      productionDays: series.productionDays,
    });
    setAdded(true);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_420px]">
      {/* ── Візуалізація ── */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-center rounded-[4px] border border-line bg-paper-warm p-8">
          {color ? (
            <SeatPreview
              hex={color.hex}
              insertHex={color.insertHex}
              threadHex={color.threadHex}
              quilting={series.tier === "premium" ? "romb" : "none"}
              className="h-[380px] w-auto"
              title={`${series.name}, колір ${color.name}`}
            />
          ) : null}
        </div>

        <div className="rounded-[4px] border border-line bg-white p-4">
          <p className="text-sm text-ink-muted">
            Так виглядає поєднання основного кольору, вставок і нитки. Схема
            показує реальні кольори матеріалів зі складу — фотозйомку конкретно
            вашої моделі надішлемо в месенджер перед розкроєм.
          </p>
        </div>
      </div>

      {/* ── Конфігуратор ── */}
      <div className="flex flex-col gap-5">
        <div className="rounded-[4px] border border-line bg-white p-5">
          {car ? (
            <div className="flex flex-wrap items-center justify-between gap-2 pb-4">
              <div>
                <p className="label">Ціна для авто</p>
                <p className="font-semibold">{car.label}</p>
              </div>
              <Link
                href={`/chohly/${car.brandSlug}/${car.modelSlug}`}
                className="text-xs font-semibold text-tan-deep hover:underline"
              >
                Змінити авто
              </Link>
            </div>
          ) : (
            <div className="mb-4 rounded-[3px] bg-tan-soft px-4 py-3">
              <p className="text-sm font-semibold text-tan-deep">
                Авто не обрано — показуємо базову ціну
              </p>
              <p className="mt-1 text-xs text-tan-deep/80">
                Оберіть модель, щоб побачити точну вартість: вона залежить від типу
                кузова.
              </p>
            </div>
          )}

          <div className="border-t border-line-soft pt-4">
            <Price value={total} oldValue={oldPrice > basePrice ? oldPrice + addOnsTotal : 0} size="lg" />
            <p className="mt-1 text-sm text-ink-muted">
              або {formatPriceWithCurrency(installment(total))} × 4 платежі без
              переплати
            </p>
          </div>
        </div>

        {/* Колір */}
        <div className="rounded-[4px] border border-line bg-white p-5">
          <div className="flex items-center justify-between pb-3">
            <h2 className="text-sm font-bold">Колір комплекту</h2>
            <span className="text-sm text-ink-muted">{color?.name}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {colors.map((item) => {
              const selected = item.id === colorId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setColorId(item.id);
                    setAdded(false);
                  }}
                  aria-pressed={selected}
                  title={
                    item.surcharge
                      ? `${item.name} (+${formatPriceWithCurrency(item.surcharge)})`
                      : item.name
                  }
                  className={`relative h-12 w-12 overflow-hidden rounded-[3px] border-2 transition-colors ${
                    selected ? "border-ink" : "border-line hover:border-ink-faint"
                  }`}
                >
                  <span className="sr-only">{item.name}</span>
                  <span
                    className="absolute inset-0"
                    style={{ background: item.hex }}
                  />
                  {item.insertHex ? (
                    <span
                      className="absolute inset-y-0 right-0 w-1/2"
                      style={{ background: item.insertHex }}
                    />
                  ) : null}
                  <span
                    className="absolute inset-x-1 bottom-1 h-px"
                    style={{ background: item.threadHex }}
                  />
                </button>
              );
            })}
          </div>
          {color?.surcharge ? (
            <p className="mt-3 text-xs text-ink-muted">
              Колір «{color.name}» — доплата{" "}
              {formatPriceWithCurrency(color.surcharge)}: рідкісний матеріал під
              замовлення.
            </p>
          ) : null}
        </div>

        {/* Опції */}
        {addOns.length > 0 ? (
          <div className="rounded-[4px] border border-line bg-white p-5">
            <h2 className="pb-3 text-sm font-bold">Додати до комплекту</h2>
            <ul className="flex flex-col gap-2">
              {addOns.map((item) => {
                const checked = selectedAddOns.includes(item.id);
                return (
                  <li key={item.id}>
                    <label className="flex cursor-pointer items-start gap-3 rounded-[3px] border border-line-soft px-3 py-2.5 transition-colors hover:border-line">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAddOn(item.id)}
                        className="mt-1 h-4 w-4 accent-[#14161a]"
                      />
                      <span className="flex-1">
                        <span className="flex justify-between gap-3">
                          <span className="text-sm font-semibold">{item.name}</span>
                          <span className="tabular text-sm font-semibold">
                            +{formatPriceWithCurrency(item.price)}
                          </span>
                        </span>
                        <span className="block text-xs text-ink-muted">
                          {item.description}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {/* Купівля */}
        <div className="rounded-[4px] border border-line bg-white p-5">
          <div className="flex flex-col gap-1 pb-4 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-ink-muted">Відправимо</span>
              <span className="font-semibold">
                {formatShippingDate(series.productionDays)}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-ink-muted">Пошиття</span>
              <span className="font-semibold">
                {pluralize(series.productionDays, "робочий день", "робочі дні", "робочих днів")}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-ink-muted">Гарантія</span>
              <span className="font-semibold">
                {pluralize(series.warrantyMonths, "місяць", "місяці", "місяців")}
              </span>
            </div>
          </div>

          <Button
            type="button"
            onClick={addToCart}
            size="lg"
            className="w-full"
            variant={added ? "accent" : "primary"}
          >
            {added ? "Додано в кошик" : "Додати в кошик"}
          </Button>

          {added ? (
            <Link
              href="/cart"
              className="mt-3 block text-center text-sm font-semibold text-tan-deep hover:underline"
            >
              Перейти до оформлення →
            </Link>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2 border-t border-line-soft pt-4">
            <Badge tone="ok">Оплата при отриманні</Badge>
            <Badge>Обмін 14 днів</Badge>
            <Badge>Нова пошта</Badge>
          </div>
        </div>
      </div>
    </div>
  );
}
