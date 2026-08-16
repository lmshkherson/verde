import Image from "next/image";
import Link from "next/link";
import { toggleShowcase } from "@/app/actions/showcases";
import { ButtonLink } from "@/components/ui";
import { formatPriceWithCurrency, pluralize } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminWorksPage() {
  const works = await prisma.showcase.findMany({
    orderBy: [{ published: "asc" }, { createdAt: "desc" }],
    include: {
      photos: { orderBy: { sortOrder: "asc" } },
      series: { select: { name: true } },
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Готові роботи</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Другий тип товару: конкретне авто, реальні фото з салону й фіксована
            ціна. Такі картки продають краще за конфігуратор, бо покупець бачить
            результат саме на своїй моделі.
          </p>
        </div>
        <ButtonLink href="/admin/works/new">Додати роботу</ButtonLink>
      </div>

      {works.length === 0 ? (
        <div className="rounded-[4px] border border-dashed border-line bg-white p-8 text-center">
          <h2 className="text-lg font-bold">Робіт поки немає</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
            Додайте першу: оберіть авто, завантажте фото машини й чохлів у салоні,
            вкажіть ціну. Картка одразу зʼявиться на сторінці цієї моделі.
          </p>
          <ButtonLink href="/admin/works/new" className="mt-4">
            Додати роботу
          </ButtonLink>
        </div>
      ) : (
        <div className="flex flex-col gap-px overflow-hidden rounded-[4px] border border-line bg-line">
          {works.map((work) => {
            const cover =
              work.photos.find((photo) => photo.kind === "covers") ??
              work.photos[0];

            return (
              <article
                key={work.id}
                className="flex flex-wrap items-center gap-4 bg-white p-4"
              >
                <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-[3px] bg-paper-warm">
                  {cover ? (
                    <Image
                      src={cover.url}
                      alt={cover.alt}
                      fill
                      sizes="112px"
                      className="object-cover"
                    />
                  ) : (
                    <span className="flex h-full items-center justify-center text-[0.65rem] text-ink-faint">
                      без фото
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <h2 className="font-bold">
                    <Link
                      href={`/admin/works/${work.id}`}
                      className="hover:underline"
                    >
                      {work.carLabel}
                    </Link>
                  </h2>
                  <p className="text-xs text-ink-muted">
                    {work.series ? `${work.series.name} · ` : ""}
                    {pluralize(work.photos.length, "фото", "фото", "фото")} ·
                    /roboty/{work.slug}
                  </p>
                  {work.colorNote ? (
                    <p className="mt-0.5 text-xs text-ink-muted">{work.colorNote}</p>
                  ) : null}
                </div>

                <p className="tabular shrink-0 font-display font-bold">
                  {formatPriceWithCurrency(work.price)}
                </p>

                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-[3px] px-2 py-1 text-xs font-semibold ${
                      work.published
                        ? "bg-ok-soft text-ok"
                        : "bg-paper-warm text-ink-muted"
                    }`}
                  >
                    {work.published ? "На сайті" : "Чернетка"}
                  </span>
                  <form action={toggleShowcase}>
                    <input type="hidden" name="id" value={work.id} />
                    <button
                      type="submit"
                      className="h-9 rounded-[4px] border border-line px-3 text-sm font-semibold hover:border-ink"
                    >
                      {work.published ? "Зняти" : "Опублікувати"}
                    </button>
                  </form>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
