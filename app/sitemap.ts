import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { site } from "@/lib/site";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [brands, models, series, posts, works] = await Promise.all([
    prisma.brand.findMany({ select: { slug: true } }),
    prisma.carModel.findMany({
      select: { slug: true, brand: { select: { slug: true } } },
    }),
    prisma.series.findMany({
      where: { active: true },
      select: { slug: true },
    }),
    prisma.post.findMany({
      where: { published: true },
      select: { slug: true, publishedAt: true },
    }),
    prisma.showcase.findMany({
      where: { published: true },
      select: { slug: true, updatedAt: true },
    }),
  ]);

  const staticPages = [
    { path: "", priority: 1 },
    { path: "/catalog", priority: 0.9 },
    { path: "/roboty", priority: 0.9 },
    { path: "/chohly", priority: 0.9 },
    { path: "/individual", priority: 0.7 },
    { path: "/about", priority: 0.6 },
    { path: "/delivery", priority: 0.6 },
    { path: "/warranty", priority: 0.6 },
    { path: "/reviews", priority: 0.6 },
    { path: "/blog", priority: 0.6 },
    { path: "/contacts", priority: 0.5 },
  ];

  return [
    ...staticPages.map((page) => ({
      url: `${site.url}${page.path}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: page.priority,
    })),
    ...series.map((item) => ({
      url: `${site.url}/product/${item.slug}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...brands.map((brand) => ({
      url: `${site.url}/chohly/${brand.slug}`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    // Ядро органічного трафіку: сторінка під кожну модель авто
    ...models.map((model) => ({
      url: `${site.url}/chohly/${model.brand.slug}/${model.slug}`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    // Готові роботи — сторінки з реальними фото, для пошуку цінні
    ...works.map((work) => ({
      url: `${site.url}/roboty/${work.slug}`,
      lastModified: work.updatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    ...posts.map((post) => ({
      url: `${site.url}/blog/${post.slug}`,
      lastModified: post.publishedAt ?? new Date(),
      changeFrequency: "yearly" as const,
      priority: 0.5,
    })),
  ];
}
