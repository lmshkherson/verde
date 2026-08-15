import Link from "next/link";
import { notFound } from "next/navigation";
import { savePost } from "@/app/actions/admin";
import { Button } from "@/components/ui";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const inputClass =
  "h-11 w-full rounded-[4px] border border-line px-3 text-sm outline-none focus:border-ink";

export default async function AdminPostEditPage(
  props: PageProps<"/admin/posts/[id]">,
) {
  const { id } = await props.params;
  const isNew = id === "new";

  const post = isNew
    ? null
    : await prisma.post.findUnique({ where: { id: Number(id) } });

  if (!isNew && !post) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/posts" className="text-sm text-ink-muted hover:text-ink">
          ← До списку статей
        </Link>
        <h1 className="mt-2 text-2xl font-bold">
          {isNew ? "Нова стаття" : "Редагування статті"}
        </h1>
      </div>

      <form
        action={savePost}
        className="flex flex-col gap-4 rounded-[4px] border border-line bg-white p-5"
      >
        {post ? <input type="hidden" name="id" value={post.id} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-muted">Заголовок *</span>
            <input
              className={inputClass}
              name="title"
              defaultValue={post?.title ?? ""}
              required
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-muted">
              URL (латиницею, через дефіс) *
            </span>
            <input
              className={inputClass}
              name="slug"
              defaultValue={post?.slug ?? ""}
              pattern="[a-z0-9\-]+"
              required
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-muted">
            Короткий опис — показується в списку статей і у видачі
          </span>
          <textarea
            className="min-h-20 w-full rounded-[4px] border border-line p-3 text-sm outline-none focus:border-ink"
            name="excerpt"
            defaultValue={post?.excerpt ?? ""}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-muted">
            Текст статті. Підтримується розмітка: ## заголовок, ### підзаголовок,
            **жирний**, списки через дефіс
          </span>
          <textarea
            className="min-h-[420px] w-full rounded-[4px] border border-line p-3 font-mono text-sm outline-none focus:border-ink"
            name="body"
            defaultValue={post?.body ?? ""}
          />
        </label>

        <div className="grid gap-4 border-t border-line-soft pt-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-muted">SEO-заголовок</span>
            <input
              className={inputClass}
              name="seoTitle"
              defaultValue={post?.seoTitle ?? ""}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-muted">SEO-опис</span>
            <input
              className={inputClass}
              name="seoDescription"
              defaultValue={post?.seoDescription ?? ""}
            />
          </label>
        </div>

        <div className="flex items-center gap-3 border-t border-line-soft pt-4">
          <Button type="submit">Зберегти</Button>
          {post && !post.published ? (
            <span className="text-sm text-ink-muted">
              Стаття — чернетка. Опублікувати можна зі списку статей.
            </span>
          ) : null}
        </div>
      </form>
    </div>
  );
}
