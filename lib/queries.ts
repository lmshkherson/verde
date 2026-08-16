import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { availableSeatSets } from "@/lib/pricing";

/** Підписи типів кузова для каталогу. На ціну кузов не впливає. */
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
      seatPrices: true,
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
      seatPrices: true,
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

export const getSeatSets = cache(async () => {
  return prisma.seatSet.findMany({ orderBy: { sortOrder: "asc" } });
});

export type SeatSetRow = Awaited<ReturnType<typeof getSeatSets>>[number];

type PricedSeries = {
  id: number;
  seatPrices: { seatSetId: number; price: number; oldPrice: number }[];
};

/** Ціна лінійки за конкретним варіантом комплекту. */
export function priceForSeatSet(series: PricedSeries, seatSetId: number) {
  const row = series.seatPrices.find((item) => item.seatSetId === seatSetId);
  return { price: row?.price ?? 0, oldPrice: row?.oldPrice ?? 0 };
}

/**
 * Найдешевший варіант серед доступних для авто — саме він показується
 * у каталозі як «від N ₴».
 */
export function priceFrom(
  series: PricedSeries,
  sets: SeatSetRow[],
  car: { seats: number; bodyType: string } | null,
) {
  const allowed = availableSeatSets(sets, car);
  const allowedIds = new Set(allowed.map((item) => item.id));
  const rows = series.seatPrices.filter((item) => allowedIds.has(item.seatSetId));
  if (rows.length === 0) return { price: 0, oldPrice: 0 };

  const cheapest = rows.reduce((min, item) => (item.price < min.price ? item : min));
  return { price: cheapest.price, oldPrice: cheapest.oldPrice };
}

/** Найдешевша ціна серед кількох лінійок — для сторінки марки. */
export function cheapestOf(
  list: PricedSeries[],
  sets: SeatSetRow[],
  car: { seats: number; bodyType: string } | null,
) {
  const prices = list
    .map((item) => priceFrom(item, sets, car).price)
    .filter((price) => price > 0);
  return prices.length ? Math.min(...prices) : 0;
}
