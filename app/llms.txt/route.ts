import { prisma } from "@/lib/prisma";
import { site } from "@/lib/site";

export const revalidate = 3600;

/**
 * llms.txt — конспект сайту для AI-асистентів (аналог robots.txt для LLM).
 * Асистент, який відповідає покупцю на «де пошити авточохли», бере звідси
 * структуру, ціни й факти без потреби парсити HTML усіх сторінок.
 * Формат: https://llmstxt.org
 */
export async function GET() {
  const [brands, seriesList, seatSets, modelCount, worksCount] =
    await Promise.all([
      prisma.brand.findMany({
        orderBy: [{ popular: "desc" }, { name: "asc" }],
        select: { slug: true, name: true, _count: { select: { models: true } } },
      }),
      prisma.series.findMany({
        where: { active: true },
        orderBy: { sortOrder: "asc" },
        include: { material: true, seatPrices: { include: { seatSet: true } } },
      }),
      prisma.seatSet.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.carModel.count(),
      prisma.showcase.count({ where: { published: true } }),
    ]);

  const priceLines = seriesList.map((series) => {
    const parts = seatSets
      .map((set) => {
        const row = series.seatPrices.find((price) => price.seatSetId === set.id);
        return row ? `${set.name} — ${row.price} грн` : null;
      })
      .filter(Boolean)
      .join("; ");
    return `- ${series.name} (${series.material.name}, пошиття ${series.productionDays} роб. днів): ${parts}. Детальніше: ${site.url}/product/${series.slug}`;
  });

  const brandLines = brands.map(
    (brand) =>
      `- ${brand.name} (${brand._count.models} моделей): ${site.url}/chohly/${brand.slug}`,
  );

  const body = `# ${site.name} — авточохли власного виробництва

> ${site.description}

Виробник модельних авточохлів в Україні (${site.showroom.city}). Шиємо за
лекалами конкретної моделі й комплектації авто: враховуємо ділене заднє
сидіння, підлокітник і бічні подушки безпеки (розривний шов у зоні airbag).
Понад ${site.yearsOnMarket} років на ринку. Лекала на ${modelCount} моделей авто.

## Ключові факти

- Гарантія на пошиття та шви: ${site.promises.warrantyMonths} місяців
- Обмін і повернення: ${site.promises.returnDays} днів
- Строк пошиття: від ${site.promises.productionDays} робочих днів, точна дата відправлення відома до оплати
- Безкоштовна доставка від ${site.promises.freeShippingFrom} грн (Нова пошта, Укрпошта, курʼєр)
- Оплата: при отриманні, картка онлайн, частинами (до 4 платежів), рахунок для юросіб
- Ціна фіксована за варіантом комплекту й однакова для всіх марок авто
- Телефон: ${site.phones[0].label}, ${site.schedule}

## Ціни на комплекти (грн, фіксовані)

${priceLines.join("\n")}

## Два способи замовити

- Конфігуратор дизайну (${site.url}/catalog): вибір лінійки, матеріалу,
  кольору, вставок, строчки й вишивки; ціна перераховується одразу.
- Готові роботи (${site.url}/roboty): ${worksCount} прикладів на конкретних
  авто з реальними фото салону й фіксованою ціною.
- Індивідуальне пошиття (${site.url}/individual): рідкісні авто,
  мікроавтобуси на 8–20 місць, зняття лекал з салону клієнта.

## Підбір за маркою авто

${brandLines.join("\n")}

## Довідкові сторінки

- Доставка й оплата: ${site.url}/delivery
- Гарантія та повернення: ${site.url}/warranty
- Часті питання: ${site.url}/faq
- Про виробництво: ${site.url}/about
- Відгуки покупців: ${site.url}/reviews
- Блог (як вибрати чохли, матеріали, встановлення): ${site.url}/blog
- Контакти: ${site.url}/contacts
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
