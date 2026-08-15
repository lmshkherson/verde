import Link from "next/link";
import { formatDateTime, formatPriceWithCurrency } from "@/lib/format";
import { orderStatuses } from "@/lib/pricing";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [orders, monthOrders, monthRevenue, newLeads, pendingReviews, latest] =
    await Promise.all([
      prisma.order.count(),
      prisma.order.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.order.aggregate({
        _sum: { total: true },
        where: {
          createdAt: { gte: monthStart },
          status: { notIn: ["canceled"] },
        },
      }),
      prisma.lead.count({ where: { status: "new" } }),
      prisma.review.count({ where: { published: false } }),
      prisma.order.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { items: true },
      }),
    ]);

  const revenue = monthRevenue._sum.total ?? 0;
  const average = monthOrders > 0 ? Math.round(revenue / monthOrders) : 0;

  const cards = [
    { label: "Замовлень за місяць", value: String(monthOrders) },
    { label: "Виторг за місяць", value: formatPriceWithCurrency(revenue) },
    { label: "Середній чек", value: formatPriceWithCurrency(average) },
    { label: "Замовлень усього", value: String(orders) },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">Огляд</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Дані за поточний місяць. Скасовані замовлення у виторг не входять.
        </p>
      </div>

      <dl className="grid gap-px overflow-hidden rounded-[4px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="bg-white px-5 py-4">
            <dt className="text-xs text-ink-muted">{card.label}</dt>
            <dd className="tabular mt-1 font-display text-2xl font-extrabold">
              {card.value}
            </dd>
          </div>
        ))}
      </dl>

      {newLeads > 0 || pendingReviews > 0 ? (
        <div className="flex flex-wrap gap-3">
          {newLeads > 0 ? (
            <Link
              href="/admin/leads"
              className="rounded-[4px] border border-tan bg-tan-soft px-4 py-3 text-sm font-semibold text-tan-deep"
            >
              {newLeads} нових заявок чекають на дзвінок →
            </Link>
          ) : null}
          {pendingReviews > 0 ? (
            <Link
              href="/admin/reviews"
              className="rounded-[4px] border border-line bg-white px-4 py-3 text-sm font-semibold"
            >
              {pendingReviews} відгуків на модерації →
            </Link>
          ) : null}
        </div>
      ) : null}

      <section>
        <div className="flex items-center justify-between pb-3">
          <h2 className="text-lg font-bold">Останні замовлення</h2>
          <Link href="/admin/orders" className="text-sm font-semibold hover:underline">
            Усі замовлення →
          </Link>
        </div>

        {latest.length === 0 ? (
          <p className="rounded-[4px] border border-line bg-white p-6 text-sm text-ink-muted">
            Замовлень поки немає.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-[4px] border border-line bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line bg-paper-warm text-left">
                  <th className="px-4 py-3 font-semibold">Номер</th>
                  <th className="px-4 py-3 font-semibold">Клієнт</th>
                  <th className="px-4 py-3 font-semibold">Товарів</th>
                  <th className="px-4 py-3 font-semibold">Сума</th>
                  <th className="px-4 py-3 font-semibold">Статус</th>
                  <th className="px-4 py-3 font-semibold">Дата</th>
                </tr>
              </thead>
              <tbody>
                {latest.map((order) => {
                  const status = orderStatuses[order.status];
                  return (
                    <tr key={order.id} className="border-b border-line-soft last:border-0">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className="tabular font-semibold hover:underline"
                        >
                          {order.number}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="block">{order.customerName}</span>
                        <span className="tabular text-xs text-ink-muted">
                          {order.phone}
                        </span>
                      </td>
                      <td className="tabular px-4 py-3">{order.items.length}</td>
                      <td className="tabular px-4 py-3 font-semibold">
                        {formatPriceWithCurrency(order.total)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-[3px] px-2 py-1 text-xs font-semibold ${status?.tone ?? ""}`}
                        >
                          {status?.label ?? order.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-muted">
                        {formatDateTime(order.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
