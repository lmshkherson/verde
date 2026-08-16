import Link from "next/link";
import { Container } from "@/components/ui";
import { site } from "@/lib/site";

const columns = [
  {
    title: "Каталог",
    links: [
      { href: "/roboty", label: "Готові роботи з фото" },
      { href: "/catalog", label: "Усі лінійки" },
      { href: "/catalog?tier=eco", label: "Чохли з екошкіри" },
      { href: "/catalog?tier=premium", label: "Преміум з алькантарою" },
      { href: "/catalog?tier=universal", label: "Універсальні чохли" },
      { href: "/chohly", label: "Підбір за маркою авто" },
      { href: "/individual", label: "Індивідуальне пошиття" },
    ],
  },
  {
    title: "Покупцям",
    links: [
      { href: "/delivery", label: "Доставка й оплата" },
      { href: "/warranty", label: "Гарантія та повернення" },
      { href: "/faq", label: "Часті питання" },
      { href: "/reviews", label: "Відгуки" },
      { href: "/blog", label: "Блог" },
      { href: "/contacts", label: "Контакти" },
    ],
  },
  {
    title: "Компанія",
    links: [
      { href: "/about", label: "Про виробництво" },
      { href: "/individual", label: "Для автопарків і таксі" },
      { href: "/contacts", label: "Шоурум у Києві" },
    ],
  },
];

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-20 bg-ink text-paper">
      <Container className="py-14">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="flex flex-col gap-4">
            <span className="font-display text-2xl font-extrabold">
              {site.name}
            </span>
            <p className="max-w-xs text-sm text-paper/60">{site.description}</p>
            <div className="flex flex-col gap-1 text-sm">
              {site.phones.map((phone) => (
                <a key={phone.href} href={phone.href} className="font-semibold">
                  {phone.label}
                </a>
              ))}
              <a href={`mailto:${site.email}`} className="text-paper/60">
                {site.email}
              </a>
            </div>
          </div>

          {columns.map((column) => (
            <div key={column.title} className="flex flex-col gap-3">
              <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-paper/50">
                {column.title}
              </h3>
              <ul className="flex flex-col gap-2 text-sm">
                {column.links.map((link) => (
                  <li key={`${link.href}-${link.label}`}>
                    <Link href={link.href} className="text-paper/80 hover:text-paper">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-paper/15 pt-6 text-xs text-paper/50 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {site.legalName}. Виробництво авточохлів, {site.showroom.city}.
          </p>
          <p>
            Гарантія {site.promises.warrantyMonths} місяців · Повернення{" "}
            {site.promises.returnDays} днів
          </p>
        </div>
      </Container>
    </footer>
  );
}
