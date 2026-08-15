import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client";
import { brands, bodyTypes } from "./data/cars";
import { addOns, materials, posts, reviews, series } from "./data/catalog";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./dev.db",
});
const prisma = new PrismaClient({ adapter });

function slugifyTitle(brand: string, model: string) {
  return `Авточохли на ${brand} ${model}`;
}

async function main() {
  console.log("Очищаю таблиці…");
  // Порядок важливий: спершу залежні записи, потім батьківські.
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.review.deleteMany();
  await prisma.modelPrice.deleteMany();
  await prisma.seriesColor.deleteMany();
  await prisma.seriesImage.deleteMany();
  await prisma.series.deleteMany();
  await prisma.material.deleteMany();
  await prisma.carModel.deleteMany();
  await prisma.brand.deleteMany();
  await prisma.bodyFactor.deleteMany();
  await prisma.addOn.deleteMany();
  await prisma.post.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.adminUser.deleteMany();

  console.log("Типи кузова…");
  for (const body of bodyTypes) {
    await prisma.bodyFactor.create({
      data: {
        bodyType: body.slug,
        label: body.label,
        factor: body.factor,
        sortOrder: body.sortOrder,
      },
    });
  }

  console.log("Марки та моделі авто…");
  let modelCount = 0;
  for (const [index, brand] of brands.entries()) {
    const created = await prisma.brand.create({
      data: {
        slug: brand.slug,
        name: brand.name,
        country: brand.country,
        popular: brand.popular ?? false,
        sortOrder: brand.popular ? index : 100 + index,
        seoTitle: `Авточохли на ${brand.name} — модельні чохли на сидіння`,
        seoDescription: `Модельні авточохли на ${brand.name} за лекалами вашої моделі. Екошкіра, жакард, алькантара. Гарантія 18 місяців, доставка по Україні.`,
        intro: `Шиємо чохли на ${brand.name} за лекалами конкретної моделі й року випуску. Враховуємо ділене заднє сидіння, підлокітник і подушки безпеки в спинках.`,
      },
    });

    for (const [
      slug,
      name,
      bodyType,
      yearFrom,
      yearTo,
      popular,
      splitRear,
      armrest,
      airbag,
    ] of brand.models) {
      await prisma.carModel.create({
        data: {
          brandId: created.id,
          slug,
          name,
          bodyType,
          yearFrom,
          yearTo: yearTo === 0 ? null : yearTo,
          popular: popular === 1,
          splitRearSeat: splitRear === 1,
          rearArmrest: armrest === 1,
          airbagInBackrest: airbag === 1,
          seats: bodyType === "van" ? 8 : bodyType === "minivan" ? 7 : 5,
          seoTitle: `${slugifyTitle(brand.name, name)} — купити модельні чохли`,
          seoDescription: `Авточохли на ${brand.name} ${name} ${yearFrom}${
            yearTo === 0 ? "+" : `–${yearTo}`
          }. Модельні лекала, екошкіра та жакард, гарантія 18 місяців, пошиття 5 днів.`,
        },
      });
      modelCount += 1;
    }
  }

  console.log("Матеріали…");
  const materialIds = new Map<string, number>();
  for (const material of materials) {
    const created = await prisma.material.create({ data: material });
    materialIds.set(material.slug, created.id);
  }

  console.log("Лінійки чохлів…");
  for (const item of series) {
    const materialId = materialIds.get(item.material);
    if (!materialId) throw new Error(`Немає матеріалу ${item.material}`);

    await prisma.series.create({
      data: {
        slug: item.slug,
        name: item.name,
        tagline: item.tagline,
        tier: item.tier,
        materialId,
        shortDescription: item.shortDescription,
        description: item.description,
        featuresJson: JSON.stringify(item.features),
        includesJson: JSON.stringify(item.includes),
        basePrice: item.basePrice,
        oldPrice: item.oldPrice,
        warrantyMonths: item.warrantyMonths,
        productionDays: item.productionDays,
        popular: item.popular,
        sortOrder: item.sortOrder,
        seoTitle: `Авточохли ${item.name} — ${item.tagline}`,
        seoDescription: item.shortDescription,
        colors: {
          create: item.colors.map((color, i) => ({
            slug: color.slug,
            name: color.name,
            hex: color.hex,
            insertHex: color.insertHex ?? "",
            threadHex: color.threadHex,
            surcharge: color.surcharge ?? 0,
            sortOrder: (i + 1) * 10,
          })),
        },
      },
    });
  }

  console.log("Додаткові опції…");
  for (const addOn of addOns) {
    await prisma.addOn.create({ data: addOn });
  }

  console.log("Відгуки…");
  for (const review of reviews) {
    const target = await prisma.series.findUnique({
      where: { slug: review.seriesSlug },
    });
    await prisma.review.create({
      data: {
        author: review.author,
        city: review.city,
        carLabel: review.carLabel,
        seriesId: target?.id,
        rating: review.rating,
        text: review.text,
        published: true,
      },
    });
  }

  console.log("Статті блогу…");
  for (const post of posts) {
    await prisma.post.create({
      data: {
        slug: post.slug,
        title: post.title,
        excerpt: post.excerpt,
        body: post.body,
        published: post.published,
        publishedAt: post.published ? new Date() : null,
        seoTitle: post.title,
        seoDescription: post.excerpt,
      },
    });
  }

  console.log("Адміністратор…");
  const email = process.env.ADMIN_EMAIL ?? "admin@example.com";
  const password = process.env.ADMIN_PASSWORD ?? "admin12345";
  await prisma.adminUser.create({
    data: {
      email,
      name: "Адміністратор",
      passwordHash: await bcrypt.hash(password, 10),
    },
  });

  console.log(
    `\nГотово: ${brands.length} марок, ${modelCount} моделей, ${series.length} лінійок, ${reviews.length} відгуків, ${posts.length} статей.`,
  );
  console.log(`Вхід в адмінку: ${email} / ${password}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
