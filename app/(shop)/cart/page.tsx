"use client";

import Link from "next/link";
import { useCart } from "@/components/cart/CartProvider";
import { SeatPreview } from "@/components/product/SeatPreview";
import {
  Breadcrumbs,
  Button,
  ButtonLink,
  Container,
  EmptyState,
  Price,
} from "@/components/ui";
import {
  formatPriceWithCurrency,
  formatShippingDate,
  pluralize,
} from "@/lib/format";
import { site } from "@/lib/site";

export default function CartPage() {
  const { items, ready, remove, setQuantity, total } = useCart();

  const freeFrom = site.promises.freeShippingFrom;
  const toFreeShipping = Math.max(freeFrom - total, 0);
  const maxProductionDays = items.reduce(
    (max, item) => Math.max(max, item.productionDays),
    0,
  );

  return (
    <Container className="pb-16">
      <Breadcrumbs items={[{ href: "/", label: "Головна" }, { label: "Кошик" }]} />
      <h1 className="pb-8 text-3xl font-extrabold sm:text-4xl">Кошик</h1>

      {!ready ? (
        <p className="text-ink-muted">Завантажуємо…</p>
      ) : items.length === 0 ? (
        <EmptyState
          title="У кошику поки порожньо"
          description="Оберіть авто в підборі — покажемо комплекти, лекала яких у нас уже є, і точні ціни для вашої моделі."
          action={
            <ButtonLink href="/catalog" className="mt-2">
              Перейти до каталогу
            </ButtonLink>
          }
        />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
          <ul className="flex flex-col gap-px overflow-hidden rounded-[4px] border border-line bg-line">
            {items.map((item) => (
              <li
                key={item.key}
                className="flex flex-col gap-4 bg-white p-5 sm:flex-row"
              >
                <div className="flex w-full shrink-0 items-center justify-center rounded-[3px] bg-paper-warm p-3 sm:w-32">
                  <SeatPreview
                    hex={item.colorHex}
                    insertHex={item.colorInsertHex}
                    threadHex={item.colorThreadHex}
                    quilting={item.quilting ? "romb" : "none"}
                    className="h-28 w-auto"
                    title={`${item.seriesName}, ${item.colorName}`}
                  />
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="font-bold">
                        <Link
                          href={`/product/${item.seriesSlug}`}
                          className="hover:text-tan-deep"
                        >
                          Чохли {item.seriesName}
                        </Link>
                      </h2>
                      <p className="text-sm text-ink-muted">{item.carLabel}</p>
                      <p className="text-sm text-ink-muted">
                        Колір: {item.colorName}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(item.key)}
                      className="text-sm text-ink-muted underline hover:text-sale"
                    >
                      Видалити
                    </button>
                  </div>

                  {item.options.length > 0 ? (
                    <ul className="flex flex-col gap-0.5 text-sm text-ink-muted">
                      {item.options.map((option) => (
                        <li key={option.slug}>
                          + {option.name} ({formatPriceWithCurrency(option.price)})
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label="Зменшити кількість"
                        onClick={() => setQuantity(item.key, item.quantity - 1)}
                        className="h-9 w-9 rounded-[3px] border border-line text-lg leading-none hover:border-ink"
                      >
                        −
                      </button>
                      <span className="tabular w-8 text-center font-semibold">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label="Збільшити кількість"
                        onClick={() => setQuantity(item.key, item.quantity + 1)}
                        className="h-9 w-9 rounded-[3px] border border-line text-lg leading-none hover:border-ink"
                      >
                        +
                      </button>
                    </div>
                    <Price value={item.unitPrice * item.quantity} />
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <aside className="lg:sticky lg:top-28 lg:self-start">
            <div className="flex flex-col gap-4 rounded-[4px] border border-line bg-white p-5">
              <h2 className="text-lg font-bold">Разом</h2>

              <div className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-ink-muted">
                    {pluralize(items.length, "товар", "товари", "товарів")}
                  </span>
                  <span className="tabular font-semibold">
                    {formatPriceWithCurrency(total)}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-ink-muted">Доставка</span>
                  <span className="font-semibold">
                    {toFreeShipping === 0 ? "Безкоштовно" : "за тарифом перевізника"}
                  </span>
                </div>
                {maxProductionDays > 0 ? (
                  <div className="flex justify-between gap-3">
                    <span className="text-ink-muted">Відправимо</span>
                    <span className="font-semibold">
                      {formatShippingDate(maxProductionDays)}
                    </span>
                  </div>
                ) : null}
              </div>

              {toFreeShipping > 0 ? (
                <p className="rounded-[3px] bg-tan-soft px-3 py-2 text-xs text-tan-deep">
                  Додайте товарів на {formatPriceWithCurrency(toFreeShipping)} — і
                  доставку візьмемо на себе.
                </p>
              ) : null}

              <div className="border-t border-line-soft pt-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold">До сплати</span>
                  <Price value={total} size="md" />
                </div>
              </div>

              <ButtonLink href="/checkout" size="lg" className="w-full">
                Оформити замовлення
              </ButtonLink>

              <Button
                variant="quiet"
                size="sm"
                className="w-full"
                onClick={() => window.history.back()}
              >
                Продовжити покупки
              </Button>
            </div>
          </aside>
        </div>
      )}
    </Container>
  );
}
