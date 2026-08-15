import Link from "next/link";
import { formatDateTime, formatPriceWithCurrency } from "@/lib/format";
import { orderStatuses } from "@/lib/pricing";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage(
  props: PageProps<"/admin/orders">,
) {
  const search = await props.searchParams;
  const status = typeof search.status === "string" ? search.status : undefined;

  const orders = await prisma.order.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    include: { items: true },
    take: 100,
  });

  const counts = await prisma.order.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const countByStatus = new Map(
    counts.map((row) => [row.status, row._count._all]),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Замовлення</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Показуємо останні 100. Клікніть на номер, щоб відкрити картку.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/admin/orders"
          className={`rounded-[4px] border px-3 py-1.5 text-sm font-medium ${
            !status ? "border-ink bg-white" : "border-line text-ink-muted"
          }`}
        >
          Усі
        </Link>
        {Object.entries(orderStatuses).map(([slug, item]) => (
          <Link
            key={slug}
            href={`/admin/orders?status=${slug}`}
            className={`rounded-[4px] border px-3 py-1.5 text-sm font-medium ${
              status === slug ? "border-ink bg-white" : "border-line text-ink-muted"
            }`}
          >
            {item.label}
            {countByStatus.get(slug) ? (
              <span className="tabular ml-1.5 text-xs text-ink-faint">
                {countByStatus.get(slug)}
              </span>
            ) : null}
          </Link>
        ))}
      </div>

      {orders.length === 0 ? (
        <p className="rounded-[4px] border border-line bg-white p-6 text-sm text-ink-muted">
          Замовлень із цим статусом немає.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[4px] border border-line bg-white">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line bg-paper-warm text-left">
                <th className="px-4 py-3 font-semibold">Номер</th>
                <th className="px-4 py-3 font-semibold">Клієнт</th>
                <th className="px-4 py-3 font-semibold">Товари</th>
                <th className="px-4 py-3 font-semibold">Доставка</th>
                <th className="px-4 py-3 font-semibold">Сума</th>
                <th className="px-4 py-3 font-semibold">Статус</th>
                <th className="px-4 py-3 font-semibold">Дата</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const badge = orderStatuses[order.status];
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
                    <td className="px-4 py-3 text-xs text-ink-muted">
                      {order.items
                        .map((item) => `${item.seriesName} · ${item.carLabel}`)
                        .join("; ")}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-muted">
                      {order.city}
                      {order.warehouse ? `, ${order.warehouse}` : ""}
                    </td>
                    <td className="tabular px-4 py-3 font-semibold">
                      {formatPriceWithCurrency(order.total)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-[3px] px-2 py-1 text-xs font-semibold ${badge?.tone ?? ""}`}
                      >
                        {badge?.label ?? order.status}
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
    </div>
  );
}
