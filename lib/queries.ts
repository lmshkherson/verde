import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { calcOldPrice, calcPrice } from "@/lib/pricing";

/** Коефіцієнти кузова тягнемо один раз на рендер — вони потрібні майже всюди. */
export const getBodyFactors = cache(async () => {
  const rows = await prisma.bodyFactor.findMany({ orderBy: { sortOrder: "asc" } });
  const byType = new Map(rows.map((row) => [row.bodyType, row]));
  return { rows, byType };
});

export const getBrands = cache(async () => {
  return prisma.brand.findMany({
    orderBy: [{ popular: "desc" }, { name: "asc" }],
    include: { _count: { select: { models: true } } },
  });
});

/**
 * Компактне дерево «марка → моделі» для селектора авто.
 * Віддаємо цілком (десятки кілобайт), щоб вибір працював без запитів на сервер:
 * підбір — головний елемент сторінки, він не має чекати мережу.
 */
export const getCarTree = cache(async () => {
  const brands = await prisma.brand.findMany({
    orderBy: [{ popular: "desc" }, { name: "asc" }],
    select: {
      slug: true,
      name: true,
      popular: true,
      models: {
        orderBy: [{ popular: "desc" }, { name: "asc" }],
        select: {
          slug: true,
          name: true,
          bodyType: true,
          yearFrom: true,
          yearTo: true,
        },
      },
    },
  });
  return brands.filter((brand) => brand.models.length > 0);
});

export type CarTree = Awaited<ReturnType<typeof getCarTree>>;

export const getBrandBySlug = cache(async (slug: string) => {
  return prisma.brand.findUnique({
    where: { slug },
    include: {
      models: { orderBy: [{ popular: "desc" }, { name: "asc" }] },
    },
  });
});

export const getCarModel = cache(async (brandSlug: string, modelSlug: string) => {
  const brand = await prisma.brand.findUnique({ where: { slug: brandSlug } });
  if (!brand) return null;
  const model = await prisma.carModel.findUnique({
    where: { brandId_slug: { brandId: brand.id, slug: modelSlug } },
  });
  if (!model) return null;
  return { brand, model };
});

export const getSeriesList = cache(async () => {
  return prisma.series.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
    include: {
      material: true,
      colors: { orderBy: { sortOrder: "asc" } },
      _count: { select: { reviews: { where: { published: true } } } },
    },
  });
});

export const getSeriesBySlug = cache(async (slug: string) => {
  return prisma.series.findUnique({
    where: { slug },
    include: {
      material: true,
      colors: { orderBy: { sortOrder: "asc" } },
      images: { orderBy: { sortOrder: "asc" } },
      reviews: {
        where: { published: true },
        orderBy: { createdAt: "desc" },
        take: 6,
      },
    },
  });
});

export const getAddOns = cache(async () => {
  return prisma.addOn.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });
});

export const getPublishedReviews = cache(async (take?: number) => {
  return prisma.review.findMany({
    where: { published: true },
    orderBy: { createdAt: "desc" },
    take,
    include: { series: { select: { name: true, slug: true } } },
  });
});

export const getPublishedPosts = cache(async (take?: number) => {
  return prisma.post.findMany({
    where: { published: true },
    orderBy: { publishedAt: "desc" },
    take,
  });
});

export const getPostBySlug = cache(async (slug: string) => {
  return prisma.post.findUnique({ where: { slug } });
});

/** Ручні перевизначення ціни для конкретної моделі авто. */
export const getModelPrices = cache(async (carModelId: number) => {
  const rows = await prisma.modelPrice.findMany({ where: { carModelId } });
  return new Map(rows.map((row) => [row.seriesId, row.price]));
});

type SeriesLike = {
  id: number;
  basePrice: number;
  oldPrice: number;
};

/** Ціна лінійки під конкретний кузов — з урахуванням ручних перевизначень. */
export function priceFor(
  series: SeriesLike,
  bodyType: string | null,
  factors: Awaited<ReturnType<typeof getBodyFactors>>["byType"],
  overrides?: Map<number, number>,
) {
  const factor = bodyType ? (factors.get(bodyType)?.factor ?? 1) : 1;
  const price = calcPrice({
    basePrice: series.basePrice,
    bodyFactor: factor,
    overridePrice: overrides?.get(series.id) ?? null,
  });
  const oldPrice = calcOldPrice({ oldPrice: series.oldPrice, bodyFactor: factor });
  return { price, oldPrice: oldPrice > price ? oldPrice : 0, factor };
}

/** Найдешевша лінійка — для блоків «від N ₴». */
export function priceFrom(
  list: SeriesLike[],
  bodyType: string | null,
  factors: Awaited<ReturnType<typeof getBodyFactors>>["byType"],
  overrides?: Map<number, number>,
) {
  const prices = list.map((item) => priceFor(item, bodyType, factors, overrides).price);
  return prices.length ? Math.min(...prices) : 0;
}
