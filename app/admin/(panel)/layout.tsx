import type { Metadata } from "next";
import Link from "next/link";
import { logout } from "@/app/actions/admin";
import { Container } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Адмінка",
  robots: { index: false, follow: false },
};

const nav = [
  { href: "/admin", label: "Огляд" },
  { href: "/admin/orders", label: "Замовлення", badge: "orders" },
  { href: "/admin/leads", label: "Заявки", badge: "leads" },
  { href: "/admin/reviews", label: "Відгуки", badge: "reviews" },
  { href: "/admin/works", label: "Готові роботи" },
  { href: "/admin/series", label: "Лінійки" },
  { href: "/admin/cars", label: "Авто" },
  { href: "/admin/posts", label: "Блог" },
] as const;

export default async function AdminLayout({
  children,
}: LayoutProps<"/admin">) {
  const session = await requireAdmin();

  const [newOrders, newLeads, pendingReviews] = await Promise.all([
    prisma.order.count({ where: { status: "new" } }),
    prisma.lead.count({ where: { status: "new" } }),
    prisma.review.count({ where: { published: false } }),
  ]);

  const counts: Record<string, number> = {
    orders: newOrders,
    leads: newLeads,
    reviews: pendingReviews,
  };

  return (
    <div className="bg-paper-warm">
      <div className="border-b border-line bg-white">
        <Container className="flex h-16 items-center justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <Link href="/admin" className="font-display text-lg font-extrabold">
              {site.name}
            </Link>
            <span className="text-xs text-ink-muted">панель керування</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/" className="text-ink-muted hover:text-ink">
              На сайт →
            </Link>
            <span className="hidden text-ink-muted sm:inline">{session.email}</span>
            <form action={logout}>
              <button
                type="submit"
                className="rounded-[4px] border border-line px-3 py-1.5 text-sm font-semibold hover:border-ink"
              >
                Вийти
              </button>
            </form>
          </div>
        </Container>
      </div>

      <Container className="grid gap-8 py-8 lg:grid-cols-[200px_1fr]">
        <nav className="lg:sticky lg:top-8 lg:self-start">
          <ul className="flex flex-wrap gap-1 lg:flex-col">
            {nav.map((item) => {
              const count = "badge" in item ? counts[item.badge] : 0;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex items-center justify-between gap-2 rounded-[4px] px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-white hover:text-ink"
                  >
                    {item.label}
                    {count > 0 ? (
                      <span className="tabular flex h-5 min-w-5 items-center justify-center rounded-full bg-tan px-1 text-xs text-white">
                        {count}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0">{children}</div>
      </Container>
    </div>
  );
}
