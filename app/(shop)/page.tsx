import Link from "next/link";
import { CarPicker } from "@/components/car/CarPicker";
import { SeriesCard } from "@/components/catalog/SeriesCard";
import { SeatPreview } from "@/components/product/SeatPreview";
import { Badge, ButtonLink, Container, SectionHeading } from "@/components/ui";
import { formatDate, pluralize } from "@/lib/format";
import {
  getBodyFactors,
  getBrands,
  getCarTree,
  getPublishedPosts,
  getPublishedReviews,
  getSeriesList,
  priceFor,
} from "@/lib/queries";
import { site } from "@/lib/site";

const promises = [
  {
    title: `Гарантія ${site.promises.warrantyMonths} місяців`,
    text: "На пошиття й шви. Найдовша гарантія на ринку — ми шиємо самі й відповідаємо за кожен комплект.",
  },
  {
    title: "Лекала під комплектацію",
    text: "Питаємо про ділене заднє сидіння, підлокітник і подушки безпеки в спинках. Саме на цьому чохли й сідають криво.",
  },
  {
    title: "Конкретна дата відправлення",
    text: "Не «уточнюйте у менеджера», а день, коли комплект поїде до вас. Показуємо його ще до оформлення.",
  },
  {
    title: `Повернення ${site.promises.returnDays} днів`,
    text: "Якщо комплект не підійшов — обміняємо або повернемо гроші. Доставку обміну беремо на себе.",
  },
];

const process = [
  {
    title: "Заявка й перевірка комплектації",
    text: "Уточнюємо модель, рік і особливості салону. На цьому етапі відсіюються 90% майбутніх проблем із посадкою.",
  },
  {
    title: "Розкрій за лекалами вашої моделі",
    text: "Лекала зберігаються в базі цеху. Матеріал ріжеться під конкретне крісло, а не підганяється на око.",
  },
  {
    title: "Пошиття й контроль",
    text: "Подвійна прострочка навантажених швів, розривна нитка в зоні бічних airbag, перевірка кожного елемента комплекту.",
  },
  {
    title: "Відправлення в обіцяний день",
    text: "Пакуємо, надсилаємо ТТН у месенджер і лишаємось на звʼязку до моменту, поки чохли не стануть на місце.",
  },
];

export default async function HomePage() {
  const [tree, seriesList, factors, brands, reviews, posts] = await Promise.all([
    getCarTree(),
    getSeriesList(),
    getBodyFactors(),
    getBrands(),
    getPublishedReviews(3),
    getPublishedPosts(3),
  ]);

  const modelCount = tree.reduce((sum, brand) => sum + brand.models.length, 0);
  const popularBrands = brands.filter((brand) => brand.popular);
  const showcase = seriesList.find((item) => item.tier === "premium") ?? seriesList[0];
  const showcaseColor = showcase?.colors[0];

  return (
    <>
      {/* ── Перший екран: підбір авто, а не банер ── */}
      <section className="border-b border-line bg-white">
        <Container className="py-10 lg:py-16">
          <div className="grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr]">
            <div>
              <Badge tone="accent">Власне виробництво · {site.showroom.city}</Badge>
              <h1 className="mt-4 text-[2.1rem] font-extrabold leading-[1.05] sm:text-5xl">
                Авточохли за лекалами
                <br />
                саме вашого авто
              </h1>
              <p className="mt-4 max-w-xl text-lg text-ink-muted">
                Шиємо модельні комплекти на {modelCount} моделей авто. Враховуємо
                комплектацію, показуємо точну дату відправлення й даємо гарантію{" "}
                {site.promises.warrantyMonths} місяців.
              </p>

              <div className="mt-7">
                <CarPicker tree={tree} />
              </div>
            </div>

            <div className="relative hidden lg:block">
              {showcaseColor ? (
                <div className="relative mx-auto flex max-w-sm flex-col items-center rounded-[6px] border border-line bg-paper-warm p-8">
                  <SeatPreview
                    hex={showcaseColor.hex}
                    insertHex={showcaseColor.insertHex}
                    threadHex={showcaseColor.threadHex}
                    quilting={showcase.tier === "premium" ? "romb" : "none"}
                    className="h-80 w-auto"
                    title={`Лінійка ${showcase.name}`}
                  />
                  <div className="mt-6 w-full border-t border-line pt-4 text-center">
                    <p className="label">Лінійка {showcase.name}</p>
                    <p className="mt-1 text-sm text-ink-muted">
                      {showcase.tagline}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </Container>
      </section>

      {/* ── Обіцянки ── */}
      <section className="border-b border-line bg-paper-warm">
        <Container className="grid gap-6 py-10 sm:grid-cols-2 lg:grid-cols-4">
          {promises.map((item) => (
            <div key={item.title} className="flex flex-col gap-2">
              <h2 className="text-base font-bold">{item.title}</h2>
              <p className="text-sm leading-relaxed text-ink-muted">{item.text}</p>
            </div>
          ))}
        </Container>
      </section>

      {/* ── Лінійки ── */}
      <section className="py-14">
        <Container>
          <SectionHeading
            eyebrow="Крок 2 — вибір лінійки"
            title="П'ять лінійок під різні бюджети"
            description="Від універсальних чохлів для швидкої заміни до індивідуального пошиття за лекалами, знятими з вашого салону."
            action={
              <ButtonLink href="/catalog" variant="ghost" size="sm">
                Весь каталог
              </ButtonLink>
            }
          />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {seriesList.map((item) => {
              const { price, oldPrice } = priceFor(item, null, factors.byType);
              return (
                <SeriesCard
                  key={item.id}
                  series={item}
                  price={price}
                  oldPrice={oldPrice}
                />
              );
            })}
          </div>
        </Container>
      </section>

      {/* ── Марки авто ── */}
      <section className="border-y border-line bg-white py-14">
        <Container>
          <SectionHeading
            eyebrow="Підбір за маркою"
            title="Лекала на 40 марок"
            description="Оберіть марку, щоб побачити моделі, для яких у нас уже є готові лекала."
            action={
              <ButtonLink href="/chohly" variant="ghost" size="sm">
                Усі марки
              </ButtonLink>
            }
          />
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
            {popularBrands.map((brand) => (
              <Link
                key={brand.slug}
                href={`/chohly/${brand.slug}`}
                className="flex flex-col gap-1 bg-white px-4 py-4 transition-colors hover:bg-paper-warm"
              >
                <span className="font-display text-[0.98rem] font-bold">
                  {brand.name}
                </span>
                <span className="text-xs text-ink-muted">
                  {pluralize(brand._count.models, "модель", "моделі", "моделей")}
                </span>
              </Link>
            ))}
          </div>
        </Container>
      </section>

      {/* ── Як шиємо: справжня послідовність, тому нумерація доречна ── */}
      <section className="py-14">
        <Container>
          <SectionHeading
            eyebrow="Як це працює"
            title="Чотири кроки від заявки до готового комплекту"
          />
          <ol className="grid gap-px overflow-hidden rounded-[4px] border border-line bg-line lg:grid-cols-4">
            {process.map((step, index) => (
              <li key={step.title} className="flex flex-col gap-3 bg-white p-6">
                <span className="tabular font-display text-sm font-bold text-tan">
                  0{index + 1}
                </span>
                <h3 className="text-base font-bold">{step.title}</h3>
                <p className="text-sm leading-relaxed text-ink-muted">
                  {step.text}
                </p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* ── Відгуки ── */}
      <section className="border-y border-line bg-white py-14">
        <Container>
          <SectionHeading
            eyebrow="Відгуки"
            title="З фото, моделлю авто й лінійкою"
            description="Не «дякую, все супер», а конкретика: що замовляли, на яке авто і як тримається."
            action={
              <ButtonLink href="/reviews" variant="ghost" size="sm">
                Усі відгуки
              </ButtonLink>
            }
          />
          <div className="grid gap-5 md:grid-cols-3">
            {reviews.map((review) => (
              <figure
                key={review.id}
                className="flex flex-col gap-3 rounded-[4px] border border-line bg-paper p-5"
              >
                <div className="flex items-center gap-2">
                  <span className="text-tan" aria-label={`Оцінка ${review.rating} з 5`}>
                    {"★".repeat(review.rating)}
                    <span className="text-ink-faint">
                      {"★".repeat(5 - review.rating)}
                    </span>
                  </span>
                </div>
                <blockquote className="text-sm leading-relaxed text-ink-muted">
                  {review.text}
                </blockquote>
                <figcaption className="mt-auto border-t border-line-soft pt-3 text-sm">
                  <span className="font-semibold">{review.author}</span>
                  {review.city ? (
                    <span className="text-ink-muted">, {review.city}</span>
                  ) : null}
                  <span className="block text-xs text-ink-muted">
                    {review.carLabel}
                    {review.series ? ` · ${review.series.name}` : ""}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </Container>
      </section>

      {/* ── Індивідуальне пошиття ── */}
      <section className="py-14">
        <Container>
          <div className="grid items-center gap-8 rounded-[4px] border border-line bg-ink p-8 text-paper lg:grid-cols-[1.3fr_0.7fr] lg:p-12">
            <div>
              <p className="label text-paper/50">Немає вашої моделі в базі?</p>
              <h2 className="mt-3 text-2xl font-bold sm:text-3xl">
                Знімемо лекала з вашого салону
              </h2>
              <p className="mt-3 max-w-xl text-paper/70">
                Рідкісне авто, мікроавтобус на 8–20 місць, переставлені сидіння або
                спецтехніка — шиємо індивідуально. Привозьте авто в цех або надішліть
                фото та заміри.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <ButtonLink href="/individual" variant="accent" size="lg">
                Залишити заявку
              </ButtonLink>
              <a
                href={site.phones[0].href}
                className="text-center text-sm text-paper/70 hover:text-paper"
              >
                або подзвоніть: {site.phones[0].label}
              </a>
            </div>
          </div>
        </Container>
      </section>

      {/* ── Блог ── */}
      <section className="pb-16">
        <Container>
          <SectionHeading
            eyebrow="Корисне"
            title="Розбираємось перед покупкою"
            action={
              <ButtonLink href="/blog" variant="ghost" size="sm">
                Усі статті
              </ButtonLink>
            }
          />
          <div className="grid gap-5 md:grid-cols-3">
            {posts.map((post) => (
              <Link
                key={post.id}
                href={`/blog/${post.slug}`}
                className="flex flex-col gap-2 rounded-[4px] border border-line bg-white p-5 transition-colors hover:border-ink"
              >
                {post.publishedAt ? (
                  <span className="text-xs text-ink-muted">
                    {formatDate(post.publishedAt)}
                  </span>
                ) : null}
                <h3 className="text-base font-bold">{post.title}</h3>
                <p className="text-sm leading-relaxed text-ink-muted">
                  {post.excerpt}
                </p>
              </Link>
            ))}
          </div>
        </Container>
      </section>
    </>
  );
}
