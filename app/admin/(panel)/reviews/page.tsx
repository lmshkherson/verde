import { deleteReview, toggleReview } from "@/app/actions/admin";
import { formatDateTime } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminReviewsPage() {
  const reviews = await prisma.review.findMany({
    orderBy: [{ published: "asc" }, { createdAt: "desc" }],
    include: { series: { select: { name: true } } },
    take: 200,
  });

  const pending = reviews.filter((review) => !review.published).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Відгуки</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {pending > 0
            ? `${pending} на модерації. Публікуємо і критику теж — видаляємо тільки спам.`
            : "Усі відгуки опубліковані."}
        </p>
      </div>

      {reviews.length === 0 ? (
        <p className="rounded-[4px] border border-line bg-white p-6 text-sm text-ink-muted">
          Відгуків поки немає.
        </p>
      ) : (
        <div className="flex flex-col gap-px overflow-hidden rounded-[4px] border border-line bg-line">
          {reviews.map((review) => (
            <article key={review.id} className="bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {review.author}
                    {review.city ? (
                      <span className="font-normal text-ink-muted">
                        , {review.city}
                      </span>
                    ) : null}
                    <span className="ml-2 text-tan">
                      {"★".repeat(review.rating)}
                    </span>
                  </p>
                  <p className="text-xs text-ink-muted">
                    {review.carLabel}
                    {review.series ? ` · ${review.series.name}` : ""} ·{" "}
                    {formatDateTime(review.createdAt)}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-[3px] px-2 py-1 text-xs font-semibold ${
                      review.published
                        ? "bg-ok-soft text-ok"
                        : "bg-tan-soft text-tan-deep"
                    }`}
                  >
                    {review.published ? "Опубліковано" : "На модерації"}
                  </span>
                  <form action={toggleReview}>
                    <input type="hidden" name="id" value={review.id} />
                    <button
                      type="submit"
                      className="h-9 rounded-[4px] border border-line px-3 text-sm font-semibold hover:border-ink"
                    >
                      {review.published ? "Приховати" : "Опублікувати"}
                    </button>
                  </form>
                  <form action={deleteReview}>
                    <input type="hidden" name="id" value={review.id} />
                    <button
                      type="submit"
                      className="h-9 rounded-[4px] border border-line px-3 text-sm font-semibold text-sale hover:border-sale"
                    >
                      Видалити
                    </button>
                  </form>
                </div>
              </div>

              <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                {review.text}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
