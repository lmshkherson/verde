import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteShowcase, deleteShowcasePhoto } from "@/app/actions/showcases";
import { ShowcaseForm } from "@/components/admin/ShowcaseForm";
import { prisma } from "@/lib/prisma";
import { getCarTree } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function AdminShowcaseEditPage(
  props: PageProps<"/admin/works/[id]">,
) {
  const { id } = await props.params;
  const search = await props.searchParams;
  const isNew = id === "new";

  const [showcase, tree, seriesOptions, models] = await Promise.all([
    isNew
      ? null
      : prisma.showcase.findUnique({
          where: { id: Number(id) },
          include: {
            photos: { orderBy: { sortOrder: "asc" } },
            carModel: { include: { brand: true } },
          },
        }),
    getCarTree(),
    prisma.series.findMany({
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    prisma.carModel.findMany({
      select: { id: true, slug: true, brand: { select: { slug: true } } },
    }),
  ]);

  if (!isNew && !showcase) notFound();

  // Форма працює зі slug-ами, а в базу треба покласти id моделі.
  const modelIds = Object.fromEntries(
    models.map((model) => [`${model.brand.slug}/${model.slug}`, model.id]),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/works" className="text-sm text-ink-muted hover:text-ink">
            ← До списку робіт
          </Link>
          <h1 className="mt-2 text-2xl font-bold">
            {isNew ? "Нова готова робота" : showcase?.carLabel}
          </h1>
          {showcase ? (
            <p className="mt-1 text-sm text-ink-muted">
              Сторінка на сайті:{" "}
              <Link
                href={`/roboty/${showcase.slug}`}
                className="font-semibold hover:underline"
              >
                /roboty/{showcase.slug}
              </Link>
            </p>
          ) : null}
        </div>

        {showcase ? (
          <form action={deleteShowcase}>
            <input type="hidden" name="id" value={showcase.id} />
            <button
              type="submit"
              className="h-10 rounded-[4px] border border-line px-4 text-sm font-semibold text-sale hover:border-sale"
            >
              Видалити картку
            </button>
          </form>
        ) : null}
      </div>

      <ShowcaseForm
        showcase={showcase}
        tree={tree}
        modelIds={modelIds}
        initialBrand={showcase?.carModel?.brand.slug ?? ""}
        initialModel={showcase?.carModel?.slug ?? ""}
        seriesOptions={seriesOptions}
        deletePhotoAction={deleteShowcasePhoto}
        saved={search.saved === "1"}
      />
    </div>
  );
}
