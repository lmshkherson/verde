import type { Metadata } from "next";
import Link from "next/link";
import { ReviewForm } from "@/components/forms/ReviewForm";
import { Breadcrumbs, Container } from "@/components/ui";
import { formatDate, pluralize } from "@/lib/format";
import { getPublishedReviews } from "@/lib/queries";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Відгуки покупців",
  description:
    "Відгуки про авточохли з вказаною моделлю авто й лінійкою. Публікуємо і критику теж.",
  alternates: { canonical: "/reviews" },
};

export default async function ReviewsPage() {
  const reviews = await getPublishedReviews();

  const average =
    reviews.length > 0
      ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
      : 0;

  return (
    <Container className="pb-16">
      <Breadcrumbs items={[{ href: "/", label: "Головна" }, { label: "Відгуки" }]} />

      <header className="max-w-3xl pb-10">
        <h1 className="text-3xl font-extrabold sm:text-4xl">Відгуки покупців</h1>
        <p className="mt-4 text-lg text-ink-muted">
          Кожен відгук — з моделлю авто й лінійкою чохлів. Ми не видаляємо
          негативні: якщо десь помилились, це має бачити наступний покупець.
        </p>
        {reviews.length > 0 ? (
          <p className="mt-4 flex items-center gap-3">
            <span className="tabular font-display text-3xl font-extrabold">
              {average.toFixed(1)}
            </span>
            <span className="text-tan text-lg" aria-hidden="true">
              {"★".repeat(Math.round(average))}
            </span>
            <span className="text-sm text-ink-muted">
              {pluralize(reviews.length, "відгук", "відгуки", "відгуків")}
            </span>
          </p>
        ) : null}
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_400px]">
        <div className="flex flex-col gap-px overflow-hidden rounded-[4px] border border-line bg-line">
          {reviews.map((review) => (
            <article key={review.id} className="bg-white p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-bold">
                    {review.author}
                    {review.city ? (
                      <span className="font-normal text-ink-muted">
                        , {review.city}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm text-ink-muted">
                    {review.carLabel}
                    {review.series ? (
                      <>
                        {" · "}
                        <Link
                          href={`/product/${review.series.slug}`}
                          className="hover:text-ink hover:underline"
                        >
                          {review.series.name}
                        </Link>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className="text-tan"
                    aria-label={`Оцінка ${review.rating} з 5`}
                  >
                    {"★".repeat(review.rating)}
                    <span className="text-ink-faint">
                      {"★".repeat(5 - review.rating)}
                    </span>
                  </span>
                  <p className="text-xs text-ink-muted">
                    {formatDate(review.createdAt)}
                  </p>
                </div>
              </div>
              <p className="mt-3 leading-relaxed text-ink-muted">{review.text}</p>
            </article>
          ))}
        </div>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <ReviewForm />
        </aside>
      </div>
    </Container>
  );
}
