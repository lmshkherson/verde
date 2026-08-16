"use client";

import Link from "next/link";
import { useState } from "react";
import { useCart } from "@/components/cart/CartProvider";
import { Badge, Button, Price } from "@/components/ui";
import {
  formatPriceWithCurrency,
  formatShippingDate,
  installment,
  pluralize,
} from "@/lib/format";

type Props = {
  work: {
    slug: string;
    carLabel: string;
    price: number;
    oldPrice: number;
    materialNote: string;
    colorNote: string;
    carModelId: number | null;
    seriesId: number | null;
    seriesName: string | null;
  };
  productionDays: number;
  warrantyMonths: number;
};

export function ShowcaseBuy({ work, productionDays, warrantyMonths }: Props) {
  const { add } = useCart();
  const [added, setAdded] = useState(false);

  function addToCart() {
    add({
      seriesId: work.seriesId ?? 0,
      seriesSlug: work.slug,
      seriesName: work.seriesName ?? "Готова робота",
      carLabel: work.carLabel,
      carModelId: work.carModelId,
      colorName: work.colorNote || "Як на фото",
      colorHex: "#2A2E33",
      colorInsertHex: "#4E545C",
      colorThreadHex: "#8B929B",
      quilting: false,
      options: [],
      unitPrice: work.price,
      quantity: 1,
      productionDays,
    });
    setAdded(true);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[4px] border border-line bg-white p-5">
        <p className="label">Ціна за цей комплект</p>
        <div className="mt-2">
          <Price value={work.price} oldValue={work.oldPrice} size="lg" />
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          або {formatPriceWithCurrency(installment(work.price))} × 4 платежі без
          переплати
        </p>
        <p className="mt-3 border-t border-line-soft pt-3 text-sm text-ink-muted">
          Ціна вже врахована під цей автомобіль і цю комплектацію — рахувати
          нічого не треба.
        </p>
      </div>

      {work.materialNote || work.colorNote ? (
        <dl className="flex flex-col gap-2 rounded-[4px] border border-line bg-white p-5 text-sm">
          {work.materialNote ? (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Матеріал</dt>
              <dd className="text-right font-medium">{work.materialNote}</dd>
            </div>
          ) : null}
          {work.colorNote ? (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Кольори</dt>
              <dd className="text-right font-medium">{work.colorNote}</dd>
            </div>
          ) : null}
          {work.seriesName ? (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Лінійка</dt>
              <dd className="text-right font-medium">{work.seriesName}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <div className="rounded-[4px] border border-line bg-white p-5">
        <div className="flex flex-col gap-1 pb-4 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-ink-muted">Відправимо</span>
            <span className="font-semibold">
              {formatShippingDate(productionDays)}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-ink-muted">Пошиття</span>
            <span className="font-semibold">
              {pluralize(productionDays, "робочий день", "робочі дні", "робочих днів")}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-ink-muted">Гарантія</span>
            <span className="font-semibold">
              {pluralize(warrantyMonths, "місяць", "місяці", "місяців")}
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
          {added ? "Додано в кошик" : "Замовити такий самий"}
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
  );
}
