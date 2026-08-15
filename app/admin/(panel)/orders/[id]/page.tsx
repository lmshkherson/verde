import Link from "next/link";
import { notFound } from "next/navigation";
import { updateOrderNote, updateOrderStatus } from "@/app/actions/admin";
import { Button } from "@/components/ui";
import { formatDateTime, formatPriceWithCurrency } from "@/lib/format";
import { deliveryMethods, orderStatuses, paymentMethods } from "@/lib/pricing";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminOrderPage(
  props: PageProps<"/admin/orders/[id]">,
) {
  const { id } = await props.params;
  const order = await prisma.order.findUnique({
    where: { id: Number(id) },
    include: { items: true },
  });

  if (!order) notFound();

  const delivery = deliveryMethods.find(
    (item) => item.slug === order.deliveryMethod,
  );
  const payment = paymentMethods.find((item) => item.slug === order.paymentMethod);
  const badge = orderStatuses[order.status];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/orders" className="text-sm text-ink-muted hover:text-ink">
          ← До списку замовлень
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="tabular text-2xl font-bold">Замовлення {order.number}</h1>
          <span
            className={`rounded-[3px] px-2 py-1 text-xs font-semibold ${badge?.tone ?? ""}`}
          >
            {badge?.label ?? order.status}
          </span>
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          Створене {formatDateTime(order.createdAt)}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          <section className="rounded-[4px] border border-line bg-white p-5">
            <h2 className="pb-3 text-lg font-bold">Склад замовлення</h2>
            <ul className="flex flex-col gap-3">
              {order.items.map((item) => {
                const options = JSON.parse(item.optionsJson) as {
                  name: string;
                  price: number;
                }[];
                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap justify-between gap-3 border-b border-line-soft pb-3 last:border-0 last:pb-0"
                  >
                    <div>
                      <p className="font-semibold">
                        {item.seriesName} × {item.quantity}
                      </p>
                      <p className="text-sm text-ink-muted">{item.carLabel}</p>
                      <p className="text-sm text-ink-muted">
                        Колір: {item.colorName}
                      </p>
                      {options.length > 0 ? (
                        <ul className="mt-1 text-xs text-ink-muted">
                          {options.map((option) => (
                            <li key={option.name}>
                              + {option.name} ({formatPriceWithCurrency(option.price)})
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    <p className="tabular font-semibold">
                      {formatPriceWithCurrency(item.total)}
                    </p>
                  </li>
                );
              })}
            </ul>

            <dl className="mt-4 flex flex-col gap-1 border-t border-line pt-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-muted">Товари</dt>
                <dd className="tabular">{formatPriceWithCurrency(order.itemsTotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">Доставка</dt>
                <dd className="tabular">
                  {order.deliveryCost === 0
                    ? "Безкоштовно"
                    : formatPriceWithCurrency(order.deliveryCost)}
                </dd>
              </div>
              <div className="flex justify-between text-base font-bold">
                <dt>Разом</dt>
                <dd className="tabular">{formatPriceWithCurrency(order.total)}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-[4px] border border-line bg-white p-5">
            <h2 className="pb-3 text-lg font-bold">Нотатка менеджера</h2>
            <form action={updateOrderNote} className="flex flex-col gap-3">
              <input type="hidden" name="id" value={order.id} />
              <textarea
                name="adminNote"
                defaultValue={order.adminNote ?? ""}
                placeholder="Уточнена комплектація, домовленості з клієнтом, нюанси пошиття"
                className="min-h-28 w-full rounded-[4px] border border-line p-3 text-sm outline-none focus:border-ink"
              />
              <Button type="submit" size="sm" variant="ghost" className="self-start">
                Зберегти нотатку
              </Button>
            </form>
          </section>
        </div>

        <aside className="flex flex-col gap-6">
          <section className="rounded-[4px] border border-line bg-white p-5">
            <h2 className="pb-3 text-lg font-bold">Статус</h2>
            <form action={updateOrderStatus} className="flex flex-col gap-3">
              <input type="hidden" name="id" value={order.id} />
              <select
                name="status"
                defaultValue={order.status}
                className="h-11 w-full rounded-[4px] border border-line px-3 text-sm outline-none focus:border-ink"
              >
                {Object.entries(orderStatuses).map(([slug, item]) => (
                  <option key={slug} value={slug}>
                    {item.label}
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm">
                Оновити статус
              </Button>
            </form>
          </section>

          <section className="rounded-[4px] border border-line bg-white p-5">
            <h2 className="pb-3 text-lg font-bold">Клієнт</h2>
            <dl className="flex flex-col gap-2 text-sm">
              <div>
                <dt className="text-xs text-ink-muted">Імʼя</dt>
                <dd className="font-medium">{order.customerName}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">Телефон</dt>
                <dd className="tabular font-medium">
                  <a href={`tel:${order.phone}`} className="hover:underline">
                    {order.phone}
                  </a>
                </dd>
              </div>
              {order.email ? (
                <div>
                  <dt className="text-xs text-ink-muted">Email</dt>
                  <dd className="font-medium">{order.email}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-xs text-ink-muted">Доставка</dt>
                <dd className="font-medium">
                  {delivery?.label ?? order.deliveryMethod}
                </dd>
                <dd className="text-ink-muted">
                  {order.city}
                  {order.warehouse ? `, ${order.warehouse}` : ""}
                  {order.address ? `, ${order.address}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">Оплата</dt>
                <dd className="font-medium">{payment?.label ?? order.paymentMethod}</dd>
              </div>
              {order.comment ? (
                <div>
                  <dt className="text-xs text-ink-muted">Коментар клієнта</dt>
                  <dd className="text-ink-muted">{order.comment}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
