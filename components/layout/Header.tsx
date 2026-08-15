"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useCart } from "@/components/cart/CartProvider";
import { Container } from "@/components/ui";
import { site } from "@/lib/site";

const nav = [
  { href: "/catalog", label: "Каталог" },
  { href: "/chohly", label: "Марки авто" },
  { href: "/individual", label: "Індивідуальне пошиття" },
  { href: "/about", label: "Виробництво" },
  { href: "/reviews", label: "Відгуки" },
  { href: "/delivery", label: "Доставка й оплата" },
];

export function Header() {
  const pathname = usePathname();
  const { count, ready } = useCart();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-paper/95 backdrop-blur">
      <div className="hidden bg-ink text-paper lg:block">
        <Container className="flex h-9 items-center justify-between text-xs">
          <p className="text-paper/70">
            Гарантія {site.promises.warrantyMonths} місяців · Пошиття{" "}
            {site.promises.productionDays} робочих днів · Повернення{" "}
            {site.promises.returnDays} днів
          </p>
          <div className="flex items-center gap-4">
            <span className="text-paper/70">{site.schedule}</span>
            <a href={site.phones[0].href} className="font-semibold">
              {site.phones[0].label}
            </a>
          </div>
        </Container>
      </div>

      <Container>
        <div className="flex h-16 items-center justify-between gap-4 lg:h-20">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="font-display text-2xl font-extrabold tracking-tight">
              {site.name}
            </span>
            <span className="hidden text-xs text-ink-muted sm:block">
              {site.tagline}
            </span>
          </Link>

          <nav className="hidden items-center gap-6 lg:flex">
            {nav.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`text-sm font-medium transition-colors ${
                    active ? "text-ink" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <a
              href={site.phones[0].href}
              className="hidden text-sm font-semibold sm:block lg:hidden"
            >
              {site.phones[0].label}
            </a>

            <Link
              href="/cart"
              className="relative flex h-11 items-center gap-2 rounded-[4px] border border-line px-4 text-sm font-semibold hover:border-ink"
            >
              Кошик
              {ready && count > 0 ? (
                <span className="tabular flex h-5 min-w-5 items-center justify-center rounded-full bg-tan px-1 text-xs text-white">
                  {count}
                </span>
              ) : null}
            </Link>

            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-label={open ? "Закрити меню" : "Відкрити меню"}
              className="flex h-11 w-11 items-center justify-center rounded-[4px] border border-line lg:hidden"
            >
              <span className="sr-only">Меню</span>
              <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">
                {open ? (
                  <path
                    d="M2 2 L16 12 M16 2 L2 12"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                ) : (
                  <path
                    d="M0 1h18M0 7h18M0 13h18"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                )}
              </svg>
            </button>
          </div>
        </div>
      </Container>

      {open ? (
        <div className="border-t border-line bg-paper lg:hidden">
          <Container className="flex flex-col py-2">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                // Меню закриваємо тут, а не ефектом на зміну маршруту:
                // інакше воно лишається розгорнутим поверх нової сторінки.
                onClick={() => setOpen(false)}
                className="border-b border-line-soft py-3 text-[0.95rem] font-medium last:border-0"
              >
                {item.label}
              </Link>
            ))}
            <div className="flex flex-col gap-1 py-3 text-sm">
              {site.phones.map((phone) => (
                <a key={phone.href} href={phone.href} className="font-semibold">
                  {phone.label}
                </a>
              ))}
              <span className="text-ink-muted">{site.schedule}</span>
            </div>
          </Container>
        </div>
      ) : null}
    </header>
  );
}
