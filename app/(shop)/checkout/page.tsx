"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createOrder } from "@/app/actions/orders";
import { useCart } from "@/components/cart/CartProvider";
import {
  Breadcrumbs,
  Button,
  ButtonLink,
  Container,
  EmptyState,
  Price,
} from "@/components/ui";
import { formatPriceWithCurrency, formatShippingDate } from "@/lib/format";
import { deliveryCost, deliveryMethods, paymentMethods } from "@/lib/pricing";
import { site } from "@/lib/site";

const inputClass =
  "h-12 w-full rounded-[4px] border border-line bg-white px-3 text-[0.95rem] outline-none transition-colors focus:border-ink";

export default function CheckoutPage() {
  const router = useRouter();
  const { items, ready, total, clear } = useCart();
  const [pending, startTransition] = useTransition();

  const [form, setForm] = useState({
    customerName: "",
    phone: "",
    email: "",
    city: "",
    warehouse: "",
    address: "",
    comment: "",
  });
  const [deliveryMethod, setDeliveryMethod] = useState<string>(
    deliveryMethods[0].slug,
  );
  const [paymentMethod, setPaymentMethod] = useState<string>(paymentMethods[0].slug);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");

  const method = deliveryMethods.find((item) => item.slug === deliveryMethod);
  const delivery = deliveryCost(
    total,
    deliveryMethod,
    site.promises.freeShippingFrom,
  );
  const maxProductionDays = items.reduce(
    (max, item) => Math.max(max, item.productionDays),
    0,
  );

  function update(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError("");

    startTransition(async () => {
      const result = await createOrder({
        ...form,
        deliveryMethod,
        paymentMethod,
        items: items.map((item) => ({
          seriesId: item.seriesId,
          seriesSlug: item.seriesSlug,
          seriesName: item.seriesName,
          carLabel: item.carLabel,
          colorName: item.colorName,
          seatSetSlug: item.seatSetSlug,
          seatSetName: item.seatSetName,
          options: item.options,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
        })),
      });

      if (result.ok) {
        clear();
        router.push(`/checkout/success?order=${result.orderNumber}`);
        return;
      }

      setErrors(result.fieldErrors ?? {});
      setFormError(result.error);
    });
  }

  if (ready && items.length === 0) {
    return (
      <Container className="pb-16">
        <Breadcrumbs
          items={[{ href: "/", label: "Головна" }, { label: "Оформлення" }]}
        />
        <EmptyState
          title="Немає що оформлювати"
          description="Кошик порожній. Оберіть комплект у каталозі — і повертайтесь."
          action={
            <ButtonLink href="/catalog" className="mt-2">
              До каталогу
            </ButtonLink>
          }
        />
      </Container>
    );
  }

  return (
    <Container className="pb-16">
      <Breadcrumbs
        items={[
          { href: "/", label: "Головна" },
          { href: "/cart", label: "Кошик" },
          { label: "Оформлення" },
        ]}
      />

      <header className="max-w-2xl pb-8">
        <h1 className="text-3xl font-extrabold sm:text-4xl">Оформлення замовлення</h1>
        <p className="mt-2 text-ink-muted">
          Без реєстрації. Заповніть пʼять полів — менеджер передзвонить, щоб
          підтвердити комплектацію авто.
        </p>
      </header>

      <form onSubmit={submit} className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-6">
          <fieldset className="rounded-[4px] border border-line bg-white p-5">
            <legend className="px-2 text-sm font-bold">Контакти</legend>
            <div className="grid gap-4 pt-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Імʼя та прізвище *</span>
                <input
                  className={inputClass}
                  value={form.customerName}
                  onChange={(event) => update("customerName", event.target.value)}
                  autoComplete="name"
                  required
                />
                {errors.customerName ? (
                  <span className="text-xs text-sale">{errors.customerName}</span>
                ) : null}
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Телефон *</span>
                <input
                  className={inputClass}
                  value={form.phone}
                  onChange={(event) => update("phone", event.target.value)}
                  placeholder="067 123 45 67"
                  inputMode="tel"
                  autoComplete="tel"
                  required
                />
                {errors.phone ? (
                  <span className="text-xs text-sale">{errors.phone}</span>
                ) : null}
              </label>

              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-sm font-medium">
                  Email <span className="text-ink-muted">— необовʼязково</span>
                </span>
                <input
                  className={inputClass}
                  type="email"
                  value={form.email}
                  onChange={(event) => update("email", event.target.value)}
                  autoComplete="email"
                />
                {errors.email ? (
                  <span className="text-xs text-sale">{errors.email}</span>
                ) : null}
              </label>
            </div>
          </fieldset>

          <fieldset className="rounded-[4px] border border-line bg-white p-5">
            <legend className="px-2 text-sm font-bold">Доставка</legend>
            <div className="flex flex-col gap-2 pt-2">
              {deliveryMethods.map((item) => (
                <label
                  key={item.slug}
                  className={`flex cursor-pointer items-start gap-3 rounded-[3px] border px-4 py-3 transition-colors ${
                    deliveryMethod === item.slug
                      ? "border-ink bg-paper"
                      : "border-line-soft hover:border-line"
                  }`}
                >
                  <input
                    type="radio"
                    name="delivery"
                    value={item.slug}
                    checked={deliveryMethod === item.slug}
                    onChange={() => setDeliveryMethod(item.slug)}
                    className="mt-1 h-4 w-4 accent-[#14161a]"
                  />
                  <span>
                    <span className="block text-sm font-semibold">{item.label}</span>
                    <span className="block text-xs text-ink-muted">{item.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="grid gap-4 pt-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Місто *</span>
                <input
                  className={inputClass}
                  value={form.city}
                  onChange={(event) => update("city", event.target.value)}
                  autoComplete="address-level2"
                  required
                />
                {errors.city ? (
                  <span className="text-xs text-sale">{errors.city}</span>
                ) : null}
              </label>

              {method?.needsWarehouse ? (
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Відділення</span>
                  <input
                    className={inputClass}
                    value={form.warehouse}
                    onChange={(event) => update("warehouse", event.target.value)}
                    placeholder="№ 12, вул. Прикладна 5"
                  />
                </label>
              ) : deliveryMethod === "courier" ? (
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Адреса</span>
                  <input
                    className={inputClass}
                    value={form.address}
                    onChange={(event) => update("address", event.target.value)}
                    placeholder="вул. Прикладна, 5, кв. 12"
                    autoComplete="street-address"
                  />
                </label>
              ) : null}
            </div>
          </fieldset>

          <fieldset className="rounded-[4px] border border-line bg-white p-5">
            <legend className="px-2 text-sm font-bold">Оплата</legend>
            <div className="flex flex-col gap-2 pt-2">
              {paymentMethods.map((item) => (
                <label
                  key={item.slug}
                  className={`flex cursor-pointer items-start gap-3 rounded-[3px] border px-4 py-3 transition-colors ${
                    paymentMethod === item.slug
                      ? "border-ink bg-paper"
                      : "border-line-soft hover:border-line"
                  }`}
                >
                  <input
                    type="radio"
                    name="payment"
                    value={item.slug}
                    checked={paymentMethod === item.slug}
                    onChange={() => setPaymentMethod(item.slug)}
                    className="mt-1 h-4 w-4 accent-[#14161a]"
                  />
                  <span>
                    <span className="block text-sm font-semibold">{item.label}</span>
                    <span className="block text-xs text-ink-muted">{item.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            <label className="mt-4 flex flex-col gap-1.5">
              <span className="text-sm font-medium">
                Коментар <span className="text-ink-muted">— необовʼязково</span>
              </span>
              <textarea
                className="min-h-24 w-full rounded-[4px] border border-line bg-white p-3 text-[0.95rem] outline-none focus:border-ink"
                value={form.comment}
                onChange={(event) => update("comment", event.target.value)}
                placeholder="Особливості салону, зручний час дзвінка"
              />
            </label>
          </fieldset>
        </div>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="flex flex-col gap-4 rounded-[4px] border border-line bg-white p-5">
            <h2 className="text-lg font-bold">Ваше замовлення</h2>

            <ul className="flex flex-col gap-3 border-b border-line-soft pb-4">
              {items.map((item) => (
                <li key={item.key} className="flex justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="block font-semibold">
                      {item.seriesName} × {item.quantity}
                    </span>
                    <span className="block truncate text-xs text-ink-muted">
                      {item.carLabel} · {item.colorName}
                    </span>
                    {item.seatSetName ? (
                      <span className="block truncate text-xs text-ink-muted">
                        {item.seatSetName}
                      </span>
                    ) : null}
                  </span>
                  <span className="tabular shrink-0 font-semibold">
                    {formatPriceWithCurrency(item.unitPrice * item.quantity)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-ink-muted">Товари</span>
                <span className="tabular font-semibold">
                  {formatPriceWithCurrency(total)}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-ink-muted">Доставка</span>
                <span className="tabular font-semibold">
                  {delivery === 0 ? "Безкоштовно" : formatPriceWithCurrency(delivery)}
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

            <div className="flex items-baseline justify-between gap-3 border-t border-line-soft pt-4">
              <span className="font-semibold">До сплати</span>
              <Price value={total + delivery} size="md" />
            </div>

            {formError ? (
              <p className="rounded-[3px] bg-sale/10 px-3 py-2 text-sm text-sale">
                {formError}
              </p>
            ) : null}

            <Button type="submit" size="lg" className="w-full" disabled={pending}>
              {pending ? "Надсилаємо…" : "Підтвердити замовлення"}
            </Button>

            <p className="text-xs text-ink-muted">
              Натискаючи кнопку, ви погоджуєтесь із{" "}
              <Link href="/warranty" className="underline">
                умовами обміну та повернення
              </Link>
              . Менеджер зателефонує протягом робочого дня.
            </p>
          </div>
        </aside>
      </form>
    </Container>
  );
}
