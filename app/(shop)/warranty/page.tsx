import type { Metadata } from "next";
import { Breadcrumbs, ButtonLink, Container, SectionHeading } from "@/components/ui";
import { pluralize } from "@/lib/format";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Гарантія, обмін і повернення",
  description:
    "Гарантія 18 місяців на пошиття та шви. Обмін і повернення протягом 14 днів. Що покриває гарантія, а що ні — без дрібного шрифту.",
  alternates: { canonical: "/warranty" },
};

const covered = [
  "Розходження шва при нормальній експлуатації",
  "Обрив або розпускання нитки",
  "Дефект кріплень, гачків, затяжок і замків",
  "Помилка в лекалах з нашого боку — коли комплект не сідає на підтверджену комплектацію",
  "Розшарування або тріскання матеріалу раніше заявленого ресурсу",
  "Невідповідність кольору погодженому макету",
];

const notCovered = [
  "Механічні пошкодження: порізи, пропали, розриви від гострих предметів",
  "Наслідки чищення агресивною хімією або розчинниками",
  "Природне вигоряння матеріалу після заявленого ресурсу",
  "Пошкодження через неправильне встановлення, якщо ставили не ми",
  "Зміна комплектації авто після пошиття комплекту",
];

export default function WarrantyPage() {
  return (
    <Container className="pb-16">
      <Breadcrumbs
        items={[{ href: "/", label: "Головна" }, { label: "Гарантія та повернення" }]}
      />

      <header className="max-w-3xl pb-10">
        <h1 className="text-3xl font-extrabold sm:text-4xl">
          Гарантія {pluralize(site.promises.warrantyMonths, "місяць", "місяці", "місяців")}{" "}
          і повернення {site.promises.returnDays} днів
        </h1>
        <p className="mt-4 text-lg text-ink-muted">
          Ми шиємо чохли самі, тому не перекладаємо відповідальність на
          постачальника. Якщо проблема з нашого боку — ремонтуємо або перешиваємо
          за свій рахунок, включно з доставкою в обидві сторони.
        </p>
      </header>

      <section className="grid gap-6 pb-12 lg:grid-cols-2">
        <div className="rounded-[4px] border border-line bg-white p-6">
          <h2 className="text-xl font-bold text-ok">Гарантія покриває</h2>
          <ul className="mt-4 flex flex-col gap-2.5">
            {covered.map((item) => (
              <li key={item} className="flex gap-3 text-ink-muted">
                <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 bg-ok" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-[4px] border border-line bg-white p-6">
          <h2 className="text-xl font-bold text-sale">Гарантія не покриває</h2>
          <ul className="mt-4 flex flex-col gap-2.5">
            {notCovered.map((item) => (
              <li key={item} className="flex gap-3 text-ink-muted">
                <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 bg-sale" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="pb-12">
        <SectionHeading
          title="Обмін і повернення"
          description="Стандартні 14 днів за законом про захист прав споживачів — і трохи більше від нас."
        />
        <div className="flex flex-col gap-px overflow-hidden rounded-[4px] border border-line bg-line">
          {[
            {
              title: "Не підійшов колір або матеріал",
              text: `Протягом ${site.promises.returnDays} днів обміняємо на іншу лінійку чи колір, якщо комплект не був у використанні та збережено пакування. Різницю в ціні доплачуєте або повертаємо.`,
            },
            {
              title: "Комплект не сів на авто",
              text: "Якщо помилка в лекалах наша — перешиваємо за свій рахунок і забираємо доставку на себе. Якщо комплектацію було вказано неточно при замовленні — коригуємо комплект за собівартістю матеріалу.",
            },
            {
              title: "Повернення коштів",
              text: "Повертаємо на ту саму картку або реквізити протягом 3 робочих днів після отримання комплекту назад. Індивідуальне пошиття поверненню не підлягає — це прописано в договорі до початку робіт.",
            },
          ].map((item) => (
            <div key={item.title} className="bg-white p-5">
              <h3 className="font-bold">{item.title}</h3>
              <p className="mt-2 leading-relaxed text-ink-muted">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[4px] border border-line bg-white p-6">
        <h2 className="text-xl font-bold">Як звернутись по гарантії</h2>
        <p className="mt-2 max-w-2xl text-ink-muted">
          Зателефонуйте або напишіть у месенджер, назвіть номер замовлення й
          надішліть фото проблеми. Відповідь даємо того ж робочого дня, рішення —
          протягом трьох. Ніяких експертиз за ваш рахунок ми не вимагаємо.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <ButtonLink href="/contacts">Контакти</ButtonLink>
          <a
            href={site.phones[0].href}
            className="text-sm font-semibold text-tan-deep hover:underline"
          >
            {site.phones[0].label}
          </a>
        </div>
      </section>
    </Container>
  );
}
