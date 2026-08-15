import type { Metadata } from "next";
import { LeadForm } from "@/components/forms/LeadForm";
import { Breadcrumbs, Container, SectionHeading } from "@/components/ui";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Індивідуальне пошиття авточохлів за лекалами вашого салону",
  description:
    "Шиємо чохли для рідкісних авто, мікроавтобусів на 8–20 місць, спецтехніки та переобладнаних салонів. Знімаємо лекала з вашого автомобіля.",
  alternates: { canonical: "/individual" },
};

const cases = [
  {
    title: "Рідкісні та старі авто",
    text: "Моделі, яких немає в базі жодного магазину: класика, ретро, авто зі США й Японії з нестандартними кріслами.",
  },
  {
    title: "Мікроавтобуси на 8–20 місць",
    text: "Sprinter, Transporter, Ducato, Crafter у пасажирських версіях. Рахуємо комплект під конкретну кількість і розташування рядів.",
  },
  {
    title: "Переобладнані салони",
    text: "Переставлені або замінені сидіння, зняті ряди, встановлені крісла від іншого авто.",
  },
  {
    title: "Автопарки й таксі",
    text: "Однаковий комплект на весь парк за договором, з вишивкою логотипа компанії та фіксованою ціною.",
  },
];

const steps = [
  {
    title: "Заявка й попередній розрахунок",
    text: "Ви описуєте авто та надсилаєте фото салону. Ми називаємо орієнтовну вилку ціни й строк — до жодних витрат з вашого боку.",
  },
  {
    title: "Зняття лекал",
    text: "Привозите авто в цех на 1–2 години або, для складних салонів, лишаєте його на день. Для інших міст — надсилаємо шаблон замірів.",
  },
  {
    title: "Погодження макета",
    text: "Обираєте матеріал, кольори, схему стьобання й вишивку. Показуємо макет до розкрою — після нього зміни вже неможливі.",
  },
  {
    title: "Пошиття та встановлення",
    text: "Шиємо комплект і ставимо його в цеху. Для іногородніх пакуємо з інструкцією та відео встановлення.",
  },
];

export default function IndividualPage() {
  return (
    <Container className="pb-16">
      <Breadcrumbs
        items={[{ href: "/", label: "Головна" }, { label: "Індивідуальне пошиття" }]}
      />

      <div className="grid gap-10 lg:grid-cols-[1fr_400px]">
        <div>
          <header className="max-w-2xl pb-8">
            <h1 className="text-3xl font-extrabold sm:text-4xl">
              Індивідуальне пошиття за лекалами вашого салону
            </h1>
            <p className="mt-4 text-lg text-ink-muted">
              Коли моделі немає в базі, салон переобладнаний або сидінь більше
              пʼяти — працюємо індивідуально. Знімаємо лекала безпосередньо з
              вашого автомобіля, тому комплект сідає так само точно, як модельний.
            </p>
            <p className="mt-3 text-ink-muted">
              Вартість — від {site.promises.freeShippingFrom * 3} ₴ залежно від
              кількості сидінь і матеріалу. Строк — від 14 робочих днів.
            </p>
          </header>

          <section className="pb-10">
            <SectionHeading title="З чим до нас приходять" />
            <div className="grid gap-px overflow-hidden rounded-[4px] border border-line bg-line sm:grid-cols-2">
              {cases.map((item) => (
                <div key={item.title} className="bg-white p-5">
                  <h3 className="text-base font-bold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                    {item.text}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <SectionHeading
              title="Як проходить робота"
              description="Чотири етапи. Гроші беремо тільки після погодження макета."
            />
            <ol className="flex flex-col gap-px overflow-hidden rounded-[4px] border border-line bg-line">
              {steps.map((step, index) => (
                <li
                  key={step.title}
                  className="grid gap-3 bg-white p-5 sm:grid-cols-[3rem_1fr]"
                >
                  <span className="tabular font-display text-sm font-bold text-tan">
                    0{index + 1}
                  </span>
                  <div>
                    <h3 className="text-base font-bold">{step.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                      {step.text}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <LeadForm
            type="individual"
            title="Розрахувати індивідуальне пошиття"
            description="Опишіть авто — передзвонимо й назвемо ціну та строк."
            submitLabel="Отримати розрахунок"
          />
          <div className="mt-4 rounded-[4px] border border-line bg-white p-5 text-sm">
            <p className="font-semibold">Або звʼяжіться напряму</p>
            <div className="mt-2 flex flex-col gap-1">
              {site.phones.map((phone) => (
                <a key={phone.href} href={phone.href} className="font-semibold">
                  {phone.label}
                </a>
              ))}
              <span className="text-ink-muted">{site.schedule}</span>
            </div>
          </div>
        </aside>
      </div>
    </Container>
  );
}
