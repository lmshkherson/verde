import type { Metadata } from "next";
import { Breadcrumbs, Container, SectionHeading } from "@/components/ui";
import { formatPriceWithCurrency } from "@/lib/format";
import { deliveryMethods, paymentMethods } from "@/lib/pricing";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Доставка й оплата",
  description:
    "Нова пошта, Укрпошта, курʼєр і самовивіз. Накладений платіж, картка онлайн, оплата частинами від Монобанку та ПриватБанку.",
  alternates: { canonical: "/delivery" },
};

const deliveryDetails: Record<string, string> = {
  nova_poshta_branch:
    "Найпопулярніший варіант. Відправляємо в день, вказаний у замовленні, ТТН надсилаємо в месенджер. Термін — 1–2 дні по Україні.",
  nova_poshta_locker:
    "Зручно, якщо не встигаєте у відділення: посилка чекає в поштоматі цілодобово. Обмеження — габарити комплекту, підходить не для всіх лінійок.",
  ukrposhta:
    "Дешевша доставка для віддалених населених пунктів. Термін — 2–4 дні.",
  courier:
    "Курʼєрська доставка за адресою в межах міста у зручний вам час. Вартість — 150 ₴.",
  pickup: `Самовивіз із цеху: ${site.showroom.city}, ${site.showroom.address}. Можна одразу приміряти комплект і встановити його на місці.`,
};

const paymentDetails: Record<string, string> = {
  cod: "Оплата при отриманні на пошті. Передоплата 500 ₴ підтверджує замовлення й запускає розкрій — вона зараховується в суму замовлення.",
  card_online:
    "Оплата карткою на сайті через захищений платіжний шлюз. Дані картки не потрапляють на наші сервери.",
  installments:
    "Покупка частинами від Монобанку та ПриватБанку: до 4 платежів без переплати й комісії для покупця. Доступно на суму від 1 000 ₴.",
  invoice:
    "Для юридичних осіб і ФОП: виставляємо рахунок, працюємо за договором, надаємо закривні документи.",
};

export default function DeliveryPage() {
  return (
    <Container className="pb-16">
      <Breadcrumbs
        items={[{ href: "/", label: "Головна" }, { label: "Доставка й оплата" }]}
      />

      <header className="max-w-3xl pb-10">
        <h1 className="text-3xl font-extrabold sm:text-4xl">Доставка й оплата</h1>
        <p className="mt-4 text-lg text-ink-muted">
          Відправляємо щодня. Дату відправлення видно ще в картці товару — це
          конкретний день, а не «зателефонуємо й повідомимо». При замовленні від{" "}
          {formatPriceWithCurrency(site.promises.freeShippingFrom)} доставку беремо
          на себе.
        </p>
      </header>

      <section className="pb-12">
        <SectionHeading title="Способи доставки" />
        <div className="flex flex-col gap-px overflow-hidden rounded-[4px] border border-line bg-line">
          {deliveryMethods.map((method) => (
            <div key={method.slug} className="bg-white p-5 sm:flex sm:gap-8">
              <div className="sm:w-64 sm:shrink-0">
                <h2 className="font-bold">{method.label}</h2>
                <p className="text-sm text-ink-muted">{method.hint}</p>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted sm:mt-0">
                {deliveryDetails[method.slug]}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="pb-12">
        <SectionHeading title="Способи оплати" />
        <div className="flex flex-col gap-px overflow-hidden rounded-[4px] border border-line bg-line">
          {paymentMethods.map((method) => (
            <div key={method.slug} className="bg-white p-5 sm:flex sm:gap-8">
              <div className="sm:w-64 sm:shrink-0">
                <h2 className="font-bold">{method.label}</h2>
                <p className="text-sm text-ink-muted">{method.hint}</p>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted sm:mt-0">
                {paymentDetails[method.slug]}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionHeading title="Часті питання" />
        <div className="flex flex-col gap-px overflow-hidden rounded-[4px] border border-line bg-line">
          {[
            {
              q: "Чому потрібна передоплата при накладеному платежі?",
              a: "Модельні чохли шиються під конкретне авто — продати їх іншому покупцю неможливо. Передоплата 500 ₴ підтверджує серйозність замовлення й запускає розкрій. Вона зараховується в суму замовлення.",
            },
            {
              q: "Коли саме відправите замовлення?",
              a: `Дата вказана в картці товару й дублюється в підтвердженні замовлення. Універсальні комплекти йдуть наступного дня, модельні — через ${site.promises.productionDays} робочих днів після підтвердження комплектації.`,
            },
            {
              q: "Чи можна оплатити частинами?",
              a: "Так, від 1 000 ₴ доступна покупка частинами від Монобанку та ПриватБанку — до 4 платежів без переплати й без комісії для вас.",
            },
            {
              q: "Скільки коштує доставка?",
              a: `Від ${formatPriceWithCurrency(site.promises.freeShippingFrom)} — безкоштовно. Нижче цієї суми: пошта 90 ₴, курʼєр 150 ₴, самовивіз завжди безкоштовний.`,
            },
          ].map((item) => (
            <details key={item.q} className="group bg-white p-5">
              <summary className="cursor-pointer list-none font-semibold">
                <span className="flex items-start justify-between gap-4">
                  {item.q}
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-ink-muted transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </span>
              </summary>
              <p className="mt-3 leading-relaxed text-ink-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    </Container>
  );
}
