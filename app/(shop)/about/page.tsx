import type { Metadata } from "next";
import { ButtonLink, Breadcrumbs, Container, SectionHeading } from "@/components/ui";
import { getBrands, getCarTree } from "@/lib/queries";
import { site } from "@/lib/site";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Про виробництво авточохлів",
  description:
    "Власний цех у Києві: база лекал, європейські матеріали, контроль кожного шва. Гарантія 18 місяців на пошиття.",
  alternates: { canonical: "/about" },
};

const principles = [
  {
    title: "Лекала, а не підгонка",
    text: "У базі цеху зберігаються лекала кожної моделі, яку ми шили. Новий комплект ріжеться за файлом, а не підганяється на око — тому другий і сотий комплект на ту саму Octavia сідають однаково.",
  },
  {
    title: "Матеріали з перевірених джерел",
    text: "Екошкіра й алькантара — від європейських постачальників, з паспортом на партію. Ми не міняємо постачальника заради економії 200 гривень на комплекті: саме матеріал визначає, як чохли виглядатимуть через три роки.",
  },
  {
    title: "Безпека важливіша за естетику",
    text: "У зоні бічних подушок безпеки шов прошивається розривною ниткою. Це дорожче й довше, але подушка спрацює штатно. Комплекти без цього шва ми просто не випускаємо.",
  },
  {
    title: "Відповідальність за строк",
    text: "Дата відправлення відома ще до оплати й фіксується в замовленні. Якщо цех не встигає — телефонуємо самі, до того, як ви про це спитаєте.",
  },
];

export default async function AboutPage() {
  const [brands, tree] = await Promise.all([getBrands(), getCarTree()]);
  const modelCount = tree.reduce((sum, brand) => sum + brand.models.length, 0);

  const facts = [
    { value: `${site.yearsOnMarket}+ років`, label: "на ринку України" },
    { value: String(brands.length), label: "марок авто в базі лекал" },
    { value: String(modelCount), label: "моделей з готовими лекалами" },
    {
      value: `${site.promises.warrantyMonths} міс`,
      label: "гарантія на пошиття та шви",
    },
  ];

  return (
    <Container className="pb-16">
      <Breadcrumbs
        items={[{ href: "/", label: "Головна" }, { label: "Виробництво" }]}
      />

      <header className="max-w-3xl pb-10">
        <h1 className="text-3xl font-extrabold sm:text-4xl">
          Ми шиємо чохли самі — і тому відповідаємо за них
        </h1>
        <p className="mt-4 text-lg text-ink-muted">
          {site.name} — це власне виробництво, а не посередник між вами та
          складом. Понад {site.yearsOnMarket} років шиємо авточохли на ринку
          України й контролюємо весь ланцюг: від вибору матеріалу до останнього
          шва. Саме тому можемо дати гарантію {site.promises.warrantyMonths}{" "}
          місяців і назвати точну дату відправлення.
        </p>
      </header>

      <section className="pb-12">
        <dl className="grid gap-px overflow-hidden rounded-[4px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {facts.map((fact) => (
            <div key={fact.label} className="bg-white px-5 py-6">
              <dt className="tabular font-display text-3xl font-extrabold">
                {fact.value}
              </dt>
              <dd className="mt-1 text-sm text-ink-muted">{fact.label}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="pb-12">
        <SectionHeading
          eyebrow="Принципи"
          title="Чотири речі, на яких ми не економимо"
        />
        <div className="grid gap-px overflow-hidden rounded-[4px] border border-line bg-line sm:grid-cols-2">
          {principles.map((item) => (
            <div key={item.title} className="bg-white p-6">
              <h2 className="text-lg font-bold">{item.title}</h2>
              <p className="mt-2 leading-relaxed text-ink-muted">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="pb-12">
        <SectionHeading
          eyebrow="Чесно"
          title="Чого ми не робимо"
          description="Щоб не витрачати ваш час на очікування того, чого не буде."
        />
        <ul className="flex flex-col gap-3">
          {[
            "Не шиємо «за день». Модельний комплект фізично потребує від чотирьох робочих днів — усе швидше означає універсальні чохли зі складу.",
            "Не беремося за комплект, якщо не впевнені в комплектації авто. Краще перепитати двічі, ніж перешивати за свій рахунок.",
            "Не продаємо чужі бренди під виглядом власного виробництва. Усе, що в каталозі, шиється в нашому цеху.",
            "Не ставимо ціну «уточнюйте». Якщо ціна залежить від чогось — ми називаємо від чого й скільки це коштує.",
          ].map((item) => (
            <li
              key={item}
              className="flex gap-3 rounded-[4px] border border-line bg-white p-4"
            >
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 bg-sale" />
              <span className="text-ink-muted">{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-[4px] border border-line bg-ink p-8 text-paper lg:p-10">
        <h2 className="text-2xl font-bold">Приїжджайте подивитись</h2>
        <p className="mt-3 max-w-2xl text-paper/70">
          Шоурум і цех — за однією адресою: {site.showroom.city},{" "}
          {site.showroom.address}. Можна помацати матеріали, побачити готові
          комплекти на реальних авто й одразу зняти лекала зі свого.{" "}
          {site.schedule}.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="/contacts" variant="accent">
            Контакти й мапа
          </ButtonLink>
          <ButtonLink
            href="/catalog"
            variant="outline"
            className="border-paper/30 text-paper hover:bg-paper hover:text-ink"
          >
            Перейти до каталогу
          </ButtonLink>
        </div>
      </section>
    </Container>
  );
}
