import Link from "next/link";
import { togglePost } from "@/app/actions/admin";
import { ButtonLink } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminPostsPage() {
  const posts = await prisma.post.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Блог</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Статті забирають інформаційні запити й ведуть на підбір авто.
          </p>
        </div>
        <ButtonLink href="/admin/posts/new" size="sm">
          Нова стаття
        </ButtonLink>
      </div>

      {posts.length === 0 ? (
        <p className="rounded-[4px] border border-line bg-white p-6 text-sm text-ink-muted">
          Статей поки немає.
        </p>
      ) : (
        <div className="flex flex-col gap-px overflow-hidden rounded-[4px] border border-line bg-line">
          {posts.map((post) => (
            <article
              key={post.id}
              className="flex flex-wrap items-start justify-between gap-3 bg-white p-5"
            >
              <div className="min-w-0">
                <h2 className="font-bold">
                  <Link
                    href={`/admin/posts/${post.id}`}
                    className="hover:underline"
                  >
                    {post.title}
                  </Link>
                </h2>
                <p className="text-xs text-ink-muted">
                  /blog/{post.slug}
                  {post.publishedAt ? ` · ${formatDate(post.publishedAt)}` : ""}
                </p>
                <p className="mt-1 text-sm text-ink-muted">{post.excerpt}</p>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`rounded-[3px] px-2 py-1 text-xs font-semibold ${
                    post.published ? "bg-ok-soft text-ok" : "bg-paper-warm text-ink-muted"
                  }`}
                >
                  {post.published ? "Опубліковано" : "Чернетка"}
                </span>
                <form action={togglePost}>
                  <input type="hidden" name="id" value={post.id} />
                  <button
                    type="submit"
                    className="h-9 rounded-[4px] border border-line px-3 text-sm font-semibold hover:border-ink"
                  >
                    {post.published ? "Зняти" : "Опублікувати"}
                  </button>
                </form>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
