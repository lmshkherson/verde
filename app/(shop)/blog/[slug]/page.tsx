import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs, ButtonLink, Container } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown";
import { prisma } from "@/lib/prisma";
import { getPostBySlug, getPublishedPosts } from "@/lib/queries";

export const revalidate = 300;

export async function generateStaticParams() {
  const posts = await prisma.post.findMany({
    where: { published: true },
    select: { slug: true },
  });
  return posts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata(
  props: PageProps<"/blog/[slug]">,
): Promise<Metadata> {
  const { slug } = await props.params;
  const post = await getPostBySlug(slug);
  if (!post) return {};
  return {
    title: post.seoTitle ?? post.title,
    description: post.seoDescription ?? post.excerpt,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: { type: "article", title: post.title, description: post.excerpt },
  };
}

export default async function PostPage(props: PageProps<"/blog/[slug]">) {
  const { slug } = await props.params;
  const post = await getPostBySlug(slug);

  if (!post || !post.published) notFound();

  const others = (await getPublishedPosts()).filter((item) => item.slug !== slug);

  return (
    <Container className="pb-16">
      <Breadcrumbs
        items={[
          { href: "/", label: "Головна" },
          { href: "/blog", label: "Блог" },
          { label: post.title },
        ]}
      />

      <article className="mx-auto max-w-[68ch]">
        <header className="pb-6">
          {post.publishedAt ? (
            <time
              dateTime={post.publishedAt.toISOString()}
              className="text-sm text-ink-muted"
            >
              {formatDate(post.publishedAt)}
            </time>
          ) : null}
          <h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">{post.title}</h1>
          <p className="mt-4 text-lg text-ink-muted">{post.excerpt}</p>
        </header>

        <div className="border-t border-line pt-6 text-ink-muted">
          {renderMarkdown(post.body)}
        </div>

        <div className="mt-10 rounded-[4px] border border-line bg-white p-6">
          <h2 className="text-lg font-bold">Підібрати чохли на своє авто</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Оберіть марку й модель — покажемо комплекти з готовими лекалами та
            точні ціни під ваш тип кузова.
          </p>
          <ButtonLink href="/chohly" className="mt-4">
            До підбору за авто
          </ButtonLink>
        </div>
      </article>

      {others.length > 0 ? (
        <section className="mx-auto mt-12 max-w-[68ch]">
          <h2 className="pb-4 text-xl font-bold">Читати далі</h2>
          <div className="flex flex-col gap-px overflow-hidden rounded-[4px] border border-line bg-line">
            {others.map((item) => (
              <Link
                key={item.id}
                href={`/blog/${item.slug}`}
                className="bg-white p-5 transition-colors hover:bg-paper-warm"
              >
                <h3 className="font-bold">{item.title}</h3>
                <p className="mt-1 text-sm text-ink-muted">{item.excerpt}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </Container>
  );
}
