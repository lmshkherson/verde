import { FaqJsonLd } from "@/components/seo/JsonLd";
import { formatPriceWithCurrency, pluralize } from "@/lib/format";
import { site } from "@/lib/site";

type Series = {
  name: string;
  productionDays: number;
  seatPrices: { seatSetId: number; price: number }[];
};

type SeatSet = { id: number; slug: string; name: string };

type Model = {
  name: string;
  splitRearSeat: boolean;
  rearArmrest: boolean;
  airbagInBackrest: boolean;
};

/**
 * Питання-відповіді під конкретну модель авто. Це не декорація: саме такі
 * формулювання покупці ставлять пошуку й AI-асистентам («скільки коштують
 * чохли на камрі»), і саме в такому вигляді — коротке питання, конкретна
 * відповідь із цифрами — їх найлегше процитувати у видачі.
 * Відповіді генеруються з бази, тому не розходяться з прайсом.
 */
export function ModelFaq({
  brandName,
  model,
  seriesList,
  sets,
}: {
  brandName: string;
  model: Model;
  seriesList: Series[];
  sets: SeatSet[];
}) {
  const carName = `${brandName} ${model.name}`;
  const fullSet = sets.find((set) => set.slug === "full-5") ?? sets[0];

  const fullPrices = seriesList
    .map((series) =>
      series.seatPrices.find((price) => price.seatSetId === fullSet?.id)?.price,
    )
    .filter((price): price is number => Boolean(price));
  const minPrice = fullPrices.length ? Math.min(...fullPrices) : 0;
  const maxPrice = fullPrices.length ? Math.max(...fullPrices) : 0;

  const maxDays = Math.max(...seriesList.map((series) => series.productionDays));
  const minDays = Math.min(...seriesList.map((series) => series.productionDays));

  const faq = [
    {
      q: `Скільки коштують авточохли на ${carName}?`,
      a: `Повний комплект на 5 місць коштує від ${formatPriceWithCurrency(minPrice)} до ${formatPriceWithCurrency(maxPrice)} залежно від лінійки та матеріалу. Комплект лише на передні сидіння — дешевший. Ціна фіксована й не залежить від марки авто; вишивка логотипа та інші опції оплачуються окремо.`,
    },
    {
      q: `Як швидко пошиють чохли на ${carName}?`,
      a: `Пошиття займає ${minDays === maxDays ? pluralize(maxDays, "робочий день", "робочі дні", "робочих днів") : `від ${minDays} до ${maxDays} робочих днів`} залежно від лінійки. Точна дата відправлення показується в картці комплекту ще до оформлення замовлення.`,
    },
    {
      q: `Чи підійдуть чохли під комплектацію мого ${carName}?`,
      a: `Так, лекала ${carName} уже в базі виробництва й враховують ${model.splitRearSeat ? "ділене заднє сидіння" : "суцільне заднє сидіння"}${model.rearArmrest ? ", задній підлокітник" : ""}${model.airbagInBackrest ? " і бічні подушки безпеки в спинках — у цій зоні шиється розривний шов, щоб airbag спрацював штатно" : ""}. Перед розкроєм менеджер уточнює комплектацію.`,
    },
    {
      q: `Яка гарантія на чохли для ${carName}?`,
      a: `Гарантія ${site.promises.warrantyMonths} місяців на пошиття та шви. Протягом ${site.promises.returnDays} днів комплект можна обміняти або повернути, якщо він не був у використанні. Доставка по Україні Новою поштою, при замовленні від ${formatPriceWithCurrency(site.promises.freeShippingFrom)} — безкоштовна.`,
    },
  ];

  return (
    <section className="mt-12">
      <FaqJsonLd items={faq} />
      <h2 className="pb-4 text-xl font-bold">
        Часті питання про чохли на {carName}
      </h2>
      <div className="flex flex-col gap-px overflow-hidden rounded-[4px] border border-line bg-line">
        {faq.map((item) => (
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
  );
}
