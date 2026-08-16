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

export type PaletteColor = {
  id: number;
  slug: string;
  name: string;
  hex: string;
  surcharge: number;
};

export type MaterialOption = {
  id: number;
  slug: string;
  name: string;
  shortName: string;
  wearYears: number;
  surcharge: number;
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
    materialId: number;
    allowCustomColors: boolean;
  };
  colors: ConfiguratorColor[];
  addOns: ConfiguratorAddOn[];
  materials: MaterialOption[];
  materialColors: PaletteColor[];
  threadColors: PaletteColor[];
  /** Ціна вишивки логотипа береться з опцій, щоб не задвоювати прайс */
  logoAddOnSlug: string;
  bodyFactor: number;
  overridePrice: number | null;
  car: {
    label: string;
    carModelId: number;
    brandSlug: string;
    modelSlug: string;
  } | null;
};

type Mode = "preset" | "custom";

export function ProductConfigurator({
  series,
  colors,
  addOns,
  materials,
  materialColors,
  threadColors,
  logoAddOnSlug,
  bodyFactor,
  overridePrice,
  car,
}: Props) {
  const { add } = useCart();

  const [mode, setMode] = useState<Mode>("preset");
  const [presetId, setPresetId] = useState(colors[0]?.id ?? 0);
  const [materialId, setMaterialId] = useState(series.materialId);

  const [mainId, setMainId] = useState(materialColors[0]?.id ?? 0);
  const [insertId, setInsertId] = useState(materialColors[1]?.id ?? 0);
  const [threadId, setThreadId] = useState(threadColors[0]?.id ?? 0);
  const [logoId, setLogoId] = useState<number | null>(null);

  const [selectedAddOns, setSelectedAddOns] = useState<number[]>([]);
  const [added, setAdded] = useState(false);

  const preset = colors.find((item) => item.id === presetId) ?? colors[0];
  const material = materials.find((item) => item.id === materialId);
  const baseMaterial = materials.find((item) => item.id === series.materialId);
  const main = materialColors.find((item) => item.id === mainId);
  const insert = materialColors.find((item) => item.id === insertId);
  const thread = threadColors.find((item) => item.id === threadId);
  const logo = threadColors.find((item) => item.id === logoId);

  const logoAddOn = addOns.find((item) => item.slug === logoAddOnSlug);
  const custom = mode === "custom" && series.allowCustomColors;

  // Різниця між обраним матеріалом і базовим для лінійки: можна як доплатити
  // за апгрейд, так і здешевити комплект, обравши простіший матеріал.
  const materialDelta = custom
    ? (material?.surcharge ?? 0) - (baseMaterial?.surcharge ?? 0)
    : 0;

  const colorSurcharge = custom
    ? (main?.surcharge ?? 0) + (insert?.surcharge ?? 0)
    : (preset?.surcharge ?? 0);

  const basePrice = useMemo(
    () =>
      calcPrice({
        basePrice: series.basePrice + materialDelta,
        bodyFactor,
        colorSurcharge,
        overridePrice,
      }),
    [series.basePrice, materialDelta, bodyFactor, colorSurcharge, overridePrice],
  );

  const oldPrice = useMemo(
    () => calcOldPrice({ oldPrice: series.oldPrice, bodyFactor }),
    [series.oldPrice, bodyFactor],
  );

  // Вишивка — це та сама опція з прайсу, просто вибирається кольором нитки.
  const effectiveAddOns = useMemo(() => {
    if (!custom || !logo || !logoAddOn) return selectedAddOns;
    return selectedAddOns.includes(logoAddOn.id)
      ? selectedAddOns
      : [...selectedAddOns, logoAddOn.id];
  }, [custom, logo, logoAddOn, selectedAddOns]);

  const addOnsTotal = addOns
    .filter((item) => effectiveAddOns.includes(item.id))
    .reduce((sum, item) => sum + item.price, 0);

  const total = basePrice + addOnsTotal;

  const view = custom
    ? {
        hex: main?.hex ?? "#17191C",
        insertHex: insert?.hex ?? "",
        threadHex: thread?.hex ?? "#EFEBE3",
        logoHex: logo?.hex,
        name: [main?.name, insert && insert.id !== main?.id ? `вставки ${insert.name.toLowerCase()}` : null, thread ? `${thread.name.toLowerCase()} строчка` : null, logo ? `вишивка ${logo.name.toLowerCase()}` : null]
          .filter(Boolean)
          .join(", "),
      }
    : {
        hex: preset?.hex ?? "#17191C",
        insertHex: preset?.insertHex ?? "",
        threadHex: preset?.threadHex ?? "#EFEBE3",
        logoHex: undefined,
        name: preset?.name ?? "",
      };

  function toggleAddOn(id: number) {
    setSelectedAddOns((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
    setAdded(false);
  }

  function addToCart() {
    add({
      seriesId: series.id,
      seriesSlug: series.slug,
      seriesName: custom
        ? `${series.name}, ${material?.shortName ?? ""}`.trim()
        : series.name,
      carLabel: car?.label ?? "Універсальний комплект",
      carModelId: car?.carModelId ?? null,
      colorName: view.name,
      colorHex: view.hex,
      colorInsertHex: view.insertHex,
      colorThreadHex: view.threadHex,
      quilting: series.tier === "premium",
      options: addOns
        .filter((item) => effectiveAddOns.includes(item.id))
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
      {/* Липка колонка: конфігуратор справа вищий, і без цього під
          зображенням лишалась порожнеча на пів екрана. */}
      <div className="flex flex-col gap-4 lg:sticky lg:top-28 lg:self-start">
        <div className="flex items-center justify-center rounded-[4px] border border-line bg-paper-warm p-8">
          <SeatPreview
            hex={view.hex}
            insertHex={view.insertHex}
            threadHex={view.threadHex}
            logoHex={view.logoHex}
            quilting={series.tier === "premium" ? "romb" : "none"}
            className="h-[380px] w-auto"
            title={`${series.name}, ${view.name}`}
          />
        </div>

        <div className="rounded-[4px] border border-line bg-white p-4">
          <p className="text-sm font-semibold">{view.name}</p>
          <p className="mt-1 text-sm text-ink-muted">
            Так виглядає обране поєднання. Схема показує реальні кольори
            матеріалів зі складу — фотозйомку конкретно вашої моделі надішлемо в
            месенджер перед розкроєм.
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
            <Price
              value={total}
              oldValue={oldPrice > basePrice ? oldPrice + addOnsTotal : 0}
              size="lg"
            />
            <p className="mt-1 text-sm text-ink-muted">
              або {formatPriceWithCurrency(installment(total))} × 4 платежі без
              переплати
            </p>
          </div>
        </div>

        {/* Перемикач режимів */}
        {series.allowCustomColors && colors.length > 0 ? (
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-line bg-line">
            <button
              type="button"
              onClick={() => {
                setMode("preset");
                setAdded(false);
              }}
              aria-pressed={!custom}
              className={`px-4 py-3 text-sm font-semibold transition-colors ${
                !custom ? "bg-ink text-paper" : "bg-white text-ink-muted hover:text-ink"
              }`}
            >
              Готові поєднання
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("custom");
                setAdded(false);
              }}
              aria-pressed={custom}
              className={`px-4 py-3 text-sm font-semibold transition-colors ${
                custom ? "bg-ink text-paper" : "bg-white text-ink-muted hover:text-ink"
              }`}
            >
              Зібрати свій варіант
            </button>
          </div>
        ) : null}

        {!custom ? (
          <div className="rounded-[4px] border border-line bg-white p-5">
            <div className="flex items-center justify-between pb-3">
              <h2 className="text-sm font-bold">Колір комплекту</h2>
              <span className="text-sm text-ink-muted">{preset?.name}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {colors.map((item) => (
                <Swatch
                  key={item.id}
                  hex={item.hex}
                  insertHex={item.insertHex}
                  threadHex={item.threadHex}
                  name={item.name}
                  surcharge={item.surcharge}
                  selected={item.id === presetId}
                  onSelect={() => {
                    setPresetId(item.id);
                    setAdded(false);
                  }}
                />
              ))}
            </div>
            {preset?.surcharge ? (
              <p className="mt-3 text-xs text-ink-muted">
                Колір «{preset.name}» — доплата{" "}
                {formatPriceWithCurrency(preset.surcharge)}: рідкісний матеріал під
                замовлення.
              </p>
            ) : null}
          </div>
        ) : (
          <>
            {/* Матеріал */}
            <div className="rounded-[4px] border border-line bg-white p-5">
              <h2 className="pb-3 text-sm font-bold">Матеріал</h2>
              <div className="flex flex-col gap-2">
                {materials.map((item) => {
                  const delta = item.surcharge - (baseMaterial?.surcharge ?? 0);
                  return (
                    <label
                      key={item.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-[3px] border px-3 py-2.5 transition-colors ${
                        item.id === materialId
                          ? "border-ink bg-paper"
                          : "border-line-soft hover:border-line"
                      }`}
                    >
                      <input
                        type="radio"
                        name="material"
                        checked={item.id === materialId}
                        onChange={() => {
                          setMaterialId(item.id);
                          setAdded(false);
                        }}
                        className="mt-1 h-4 w-4 accent-[#14161a]"
                      />
                      <span className="flex-1">
                        <span className="flex justify-between gap-3">
                          <span className="text-sm font-semibold">{item.name}</span>
                          <span className="tabular text-sm font-semibold">
                            {delta === 0
                              ? "у ціні"
                              : delta > 0
                                ? `+${formatPriceWithCurrency(delta)}`
                                : `−${formatPriceWithCurrency(Math.abs(delta))}`}
                          </span>
                        </span>
                        <span className="block text-xs text-ink-muted">
                          ресурс{" "}
                          {pluralize(item.wearYears, "рік", "роки", "років")}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Кольори */}
            <div className="flex flex-col gap-4 rounded-[4px] border border-line bg-white p-5">
              <ColorRow
                title="Основний колір"
                value={main?.name}
                options={materialColors}
                selectedId={mainId}
                onSelect={(id) => {
                  if (id === null) return;
                  setMainId(id);
                  setAdded(false);
                }}
              />
              <ColorRow
                title="Колір вставок"
                value={insert?.name}
                options={materialColors}
                selectedId={insertId}
                onSelect={(id) => {
                  if (id === null) return;
                  setInsertId(id);
                  setAdded(false);
                }}
              />
              <ColorRow
                title="Колір строчки"
                value={thread?.name}
                options={threadColors}
                selectedId={threadId}
                onSelect={(id) => {
                  if (id === null) return;
                  setThreadId(id);
                  setAdded(false);
                }}
              />
              <ColorRow
                title="Вишивка логотипа"
                value={logo ? logo.name : "Без вишивки"}
                options={threadColors}
                selectedId={logoId}
                allowNone
                onSelect={(id) => {
                  setLogoId(id);
                  setAdded(false);
                }}
                note={
                  logoAddOn
                    ? `Вишивка логотипа марки на підголівниках — ${formatPriceWithCurrency(logoAddOn.price)}`
                    : undefined
                }
              />
            </div>
          </>
        )}

        {/* Опції */}
        {addOns.length > 0 ? (
          <div className="rounded-[4px] border border-line bg-white p-5">
            <h2 className="pb-3 text-sm font-bold">Додати до комплекту</h2>
            <ul className="flex flex-col gap-2">
              {addOns.map((item) => {
                const auto = custom && logo && logoAddOn?.id === item.id;
                const checked = effectiveAddOns.includes(item.id);
                return (
                  <li key={item.id}>
                    <label
                      className={`flex items-start gap-3 rounded-[3px] border border-line-soft px-3 py-2.5 transition-colors ${
                        auto ? "opacity-70" : "cursor-pointer hover:border-line"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={Boolean(auto)}
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
                          {auto ? "Додано разом із вишивкою" : item.description}
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
                {pluralize(
                  series.productionDays,
                  "робочий день",
                  "робочі дні",
                  "робочих днів",
                )}
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

function Swatch({
  hex,
  insertHex,
  threadHex,
  name,
  surcharge,
  selected,
  onSelect,
}: {
  hex: string;
  insertHex?: string;
  threadHex?: string;
  name: string;
  surcharge?: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={
        surcharge
          ? `${name} (+${formatPriceWithCurrency(surcharge)})`
          : name
      }
      className={`relative h-12 w-12 overflow-hidden rounded-[3px] border-2 transition-colors ${
        selected ? "border-ink" : "border-line hover:border-ink-faint"
      }`}
    >
      <span className="sr-only">{name}</span>
      <span className="absolute inset-0" style={{ background: hex }} />
      {insertHex ? (
        <span
          className="absolute inset-y-0 right-0 w-1/2"
          style={{ background: insertHex }}
        />
      ) : null}
      {threadHex ? (
        <span
          className="absolute inset-x-1 bottom-1 h-px"
          style={{ background: threadHex }}
        />
      ) : null}
    </button>
  );
}

function ColorRow({
  title,
  value,
  options,
  selectedId,
  onSelect,
  allowNone,
  note,
}: {
  title: string;
  value?: string;
  options: PaletteColor[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  allowNone?: boolean;
  note?: string;
}) {
  return (
    <div className="border-b border-line-soft pb-4 last:border-0 last:pb-0">
      <div className="flex items-center justify-between pb-2">
        <h3 className="text-sm font-bold">{title}</h3>
        <span className="text-sm text-ink-muted">{value}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {allowNone ? (
          <button
            type="button"
            onClick={() => onSelect(null)}
            aria-pressed={selectedId === null}
            className={`h-9 rounded-[3px] border-2 px-3 text-xs font-semibold transition-colors ${
              selectedId === null
                ? "border-ink text-ink"
                : "border-line text-ink-muted hover:border-ink-faint"
            }`}
          >
            Без вишивки
          </button>
        ) : null}
        {options.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-pressed={item.id === selectedId}
            title={
              item.surcharge
                ? `${item.name} (+${formatPriceWithCurrency(item.surcharge)})`
                : item.name
            }
            className={`h-9 w-9 rounded-[3px] border-2 transition-colors ${
              item.id === selectedId
                ? "border-ink"
                : "border-line hover:border-ink-faint"
            }`}
            style={{ background: item.hex }}
          >
            <span className="sr-only">{item.name}</span>
          </button>
        ))}
      </div>
      {note ? <p className="mt-2 text-xs text-ink-muted">{note}</p> : null}
    </div>
  );
}
