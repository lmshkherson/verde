"use server";

import { prisma } from "@/lib/prisma";
import { deliveryCost } from "@/lib/pricing";
import { site } from "@/lib/site";
import { leadSchema, orderSchema, reviewSchema } from "@/lib/validation";

export type ActionResult =
  | { ok: true; orderNumber?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

function flatten(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}

/** Номер замовлення виду 260815-0042: дата + порядковий номер за день. */
async function nextOrderNumber(): Promise<string> {
  const now = new Date();
  const prefix = [
    String(now.getFullYear()).slice(2),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");

  const todayCount = await prisma.order.count({
    where: { number: { startsWith: prefix } },
  });
  return `${prefix}-${String(todayCount + 1).padStart(4, "0")}`;
}

export async function createOrder(input: unknown): Promise<ActionResult> {
  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Перевірте заповнені поля",
      fieldErrors: flatten(parsed.error),
    };
  }

  const data = parsed.data;

  const seriesIds = [...new Set(data.items.map((item) => item.seriesId))];
  const seriesRows = await prisma.series.findMany({
    where: { id: { in: seriesIds } },
    include: { seatPrices: { include: { seatSet: true } }, material: true },
  });
  const seriesById = new Map(seriesRows.map((row) => [row.id, row]));

  const addOnRows = await prisma.addOn.findMany({ where: { active: true } });
  const addOnBySlug = new Map(addOnRows.map((row) => [row.slug, row]));

  const materials = await prisma.material.findMany();
  const maxMaterialDelta = Math.max(...materials.map((row) => row.surcharge), 0);

  const items = [];
  for (const item of data.items) {
    // Готова робота: ціна береться з її картки, а не з прайсу лінійки.
    if (item.seatSetSlug === "showcase") {
      const work = await prisma.showcase.findUnique({
        where: { slug: item.seriesSlug },
      });
      if (!work || !work.published) {
        return {
          ok: false,
          error: "Ця робота більше недоступна. Оновіть сторінку.",
        };
      }
      items.push({
        seriesId: work.seriesId,
        showcaseSlug: work.slug,
        seriesName: item.seriesName,
        carLabel: item.carLabel,
        colorName: item.colorName,
        seatSetSlug: item.seatSetSlug,
        seatSetName: item.seatSetName,
        optionsJson: "[]",
        unitPrice: work.price,
        quantity: item.quantity,
        total: work.price * item.quantity,
      });
      continue;
    }

    const series = seriesById.get(item.seriesId);
    if (!series) {
      return { ok: false, error: "Один із товарів більше недоступний" };
    }

    const priceRow = series.seatPrices.find(
      (row) => row.seatSet.slug === item.seatSetSlug,
    );
    if (!priceRow) {
      return {
        ok: false,
        error: "Варіант комплекту більше недоступний. Оновіть сторінку.",
      };
    }

    // Опції рахуємо строго за прайсом з бази.
    const validOptions = item.options.filter((option) =>
      addOnBySlug.has(option.slug),
    );
    const optionsTotal = validOptions.reduce(
      (sum, option) => sum + (addOnBySlug.get(option.slug)?.price ?? 0),
      0,
    );

    // Ціна = фіксована ціна варіанта + доплати за матеріал і кольори.
    // Перевіряємо, що клієнт не вийшов за межу можливих доплат.
    const baseMaterial = materials.find((row) => row.id === series.materialId);
    const maxExtra =
      maxMaterialDelta - (baseMaterial?.surcharge ?? 0) + 600; // 600 — стеля доплат за рідкісні кольори
    const claimedExtra = item.unitPrice - optionsTotal - priceRow.price;

    if (claimedExtra < -(baseMaterial?.surcharge ?? 0) || claimedExtra > maxExtra) {
      return {
        ok: false,
        error: "Ціна товару змінилась. Оновіть сторінку й повторіть замовлення.",
      };
    }

    const unitPrice = priceRow.price + claimedExtra + optionsTotal;
    items.push({
      seriesId: series.id,
      showcaseSlug: null,
      seriesName: item.seriesName,
      carLabel: item.carLabel,
      colorName: item.colorName,
      seatSetSlug: item.seatSetSlug,
      seatSetName: item.seatSetName,
      optionsJson: JSON.stringify(validOptions),
      unitPrice,
      quantity: item.quantity,
      total: unitPrice * item.quantity,
    });
  }

  const itemsTotal = items.reduce((sum, item) => sum + item.total, 0);
  const delivery = deliveryCost(
    itemsTotal,
    data.deliveryMethod,
    site.promises.freeShippingFrom,
  );

  try {
    const order = await prisma.order.create({
      data: {
        number: await nextOrderNumber(),
        customerName: data.customerName,
        phone: data.phone,
        email: data.email || null,
        deliveryMethod: data.deliveryMethod,
        city: data.city,
        warehouse: data.warehouse || null,
        address: data.address || null,
        paymentMethod: data.paymentMethod,
        comment: data.comment || null,
        itemsTotal,
        deliveryCost: delivery,
        total: itemsTotal + delivery,
        items: { create: items },
      },
    });

    return { ok: true, orderNumber: order.number };
  } catch {
    return {
      ok: false,
      error: "Не вдалося зберегти замовлення. Спробуйте ще раз або подзвоніть нам.",
    };
  }
}

export async function createLead(input: unknown): Promise<ActionResult> {
  const parsed = leadSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Перевірте заповнені поля",
      fieldErrors: flatten(parsed.error),
    };
  }

  await prisma.lead.create({
    data: {
      type: parsed.data.type,
      name: parsed.data.name,
      phone: parsed.data.phone,
      carLabel: parsed.data.carLabel || null,
      message: parsed.data.message || null,
    },
  });

  return { ok: true };
}

export async function createReview(input: unknown): Promise<ActionResult> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Перевірте заповнені поля",
      fieldErrors: flatten(parsed.error),
    };
  }

  // Відгук потрапляє в чергу на модерацію, а не одразу на сайт.
  await prisma.review.create({
    data: {
      author: parsed.data.author,
      city: parsed.data.city || null,
      carLabel: parsed.data.carLabel,
      rating: parsed.data.rating,
      text: parsed.data.text,
      published: false,
    },
  });

  return { ok: true };
}
