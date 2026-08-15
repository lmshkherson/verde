import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, Container } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { getPublishedPosts } from "@/lib/queries";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Блог про авточохли",
  description:
    "Як вибрати чохли, чим відрізняються матеріали, як встановити комплект самостійно. Без води й реклами.",
  alternates: { canonical: "/blog" },
};

export default async function BlogPage() {
  const posts = await getPublishedPosts();

  return (
    <Container className="pb-16">
      <Breadcrumbs items={[{ href: "/", label: "Головна" }, { label: "Блог" }]} />

      <header className="max-w-3xl pb-10">
        <h1 className="text-3xl font-extrabold sm:text-4xl">Блог</h1>
        <p className="mt-4 text-lg text-ink-muted">
          Розбираємо те, про що найчастіше питають до покупки. Пишемо як є — навіть
          коли відповідь «вам це не потрібно».
        </p>
      </header>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => (
          <article
            key={post.id}
            className="flex flex-col gap-3 rounded-[4px] border border-line bg-white p-6 transition-colors hover:border-ink"
          >
            {post.publishedAt ? (
              <time
                dateTime={post.publishedAt.toISOString()}
                className="text-xs text-ink-muted"
              >
                {formatDate(post.publishedAt)}
              </time>
            ) : null}
            <h2 className="text-lg font-bold">
              <Link href={`/blog/${post.slug}`} className="hover:text-tan-deep">
                {post.title}
              </Link>
            </h2>
            <p className="text-sm leading-relaxed text-ink-muted">{post.excerpt}</p>
            <Link
              href={`/blog/${post.slug}`}
              className="mt-auto text-sm font-semibold text-tan-deep hover:underline"
            >
              Читати →
            </Link>
          </article>
        ))}
      </div>
    </Container>
  );
}
