import type { Metadata } from "next";
import { LeadForm } from "@/components/forms/LeadForm";
import { Breadcrumbs, Container } from "@/components/ui";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Контакти",
  description: `Цех і шоурум: ${site.showroom.city}, ${site.showroom.address}. Телефони, месенджери, графік роботи.`,
  alternates: { canonical: "/contacts" },
};

export default function ContactsPage() {
  return (
    <Container className="pb-16">
      <Breadcrumbs items={[{ href: "/", label: "Головна" }, { label: "Контакти" }]} />

      <header className="max-w-3xl pb-10">
        <h1 className="text-3xl font-extrabold sm:text-4xl">Контакти</h1>
        <p className="mt-4 text-lg text-ink-muted">
          Телефонуйте — на середньому чеку в кілька тисяч гривень нормально спершу
          поговорити з живою людиною. Менеджер знає матеріали й комплектації, а не
          читає з екрана.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_400px]">
        <div className="flex flex-col gap-px overflow-hidden rounded-[4px] border border-line bg-line">
          <div className="bg-white p-6">
            <h2 className="text-lg font-bold">Телефони</h2>
            <div className="mt-3 flex flex-col gap-2">
              {site.phones.map((phone) => (
                <a
                  key={phone.href}
                  href={phone.href}
                  className="font-display text-xl font-bold hover:text-tan-deep"
                >
                  {phone.label}
                </a>
              ))}
            </div>
            <p className="mt-3 text-sm text-ink-muted">{site.schedule}</p>
          </div>

          <div className="bg-white p-6">
            <h2 className="text-lg font-bold">Месенджери</h2>
            <p className="mt-2 text-sm text-ink-muted">
              Зручно надіслати фото салону або запитати про наявність кольору.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <a
                href={site.messengers.viber}
                className="rounded-[4px] border border-line px-4 py-2 text-sm font-semibold hover:border-ink"
              >
                Viber
              </a>
              <a
                href={site.messengers.telegram}
                className="rounded-[4px] border border-line px-4 py-2 text-sm font-semibold hover:border-ink"
              >
                Telegram
              </a>
              <a
                href={`mailto:${site.email}`}
                className="rounded-[4px] border border-line px-4 py-2 text-sm font-semibold hover:border-ink"
              >
                {site.email}
              </a>
            </div>
          </div>

          <div className="bg-white p-6">
            <h2 className="text-lg font-bold">Цех і шоурум</h2>
            <p className="mt-2 text-ink-muted">
              {site.showroom.city}, {site.showroom.address}
            </p>
            <p className="mt-2 text-sm text-ink-muted">
              Виробництво й шоурум за однією адресою. Можна подивитись матеріали
              вживу, побачити готові комплекти на авто та зняти лекала зі свого —
              краще попередньо зателефонувати, щоб майстер був вільний.
            </p>
            <a
              href={site.showroom.mapUrl}
              className="mt-3 inline-block text-sm font-semibold text-tan-deep hover:underline"
            >
              Відкрити на мапі →
            </a>
          </div>

          <div className="bg-white p-6">
            <h2 className="text-lg font-bold">Реквізити</h2>
            <p className="mt-2 text-sm text-ink-muted">
              {site.legalName}. Працюємо з юридичними особами та ФОП: виставляємо
              рахунок, укладаємо договір, надаємо закривні документи. Для автопарків
              — окремі умови й фіксовані ціни на серію комплектів.
            </p>
          </div>
        </div>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <LeadForm
            type="callback"
            title="Замовити дзвінок"
            description="Залиште номер — передзвонимо протягом робочого дня."
            submitLabel="Передзвоніть мені"
            withCar
            withMessage={false}
          />
        </aside>
      </div>
    </Container>
  );
}
