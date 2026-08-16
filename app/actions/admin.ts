"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createSession,
  destroySession,
  requireAdmin,
  verifyCredentials,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validation";

export type FormState = { error?: string; ok?: boolean };

export async function login(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Перевірте email і пароль" };
  }

  const session = await verifyCredentials(parsed.data.email, parsed.data.password);
  if (!session) {
    return { error: "Невірний email або пароль" };
  }

  await createSession(session);
  redirect("/admin");
}

export async function logout() {
  await destroySession();
  redirect("/admin/login");
}

export async function updateOrderStatus(formData: FormData) {
  await requireAdmin();

  const id = Number(formData.get("id"));
  const status = String(formData.get("status"));
  const allowed = ["new", "confirmed", "production", "shipped", "done", "canceled"];
  if (!id || !allowed.includes(status)) return;

  await prisma.order.update({ where: { id }, data: { status } });
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);
}

export async function updateOrderNote(formData: FormData) {
  await requireAdmin();

  const id = Number(formData.get("id"));
  if (!id) return;

  await prisma.order.update({
    where: { id },
    data: { adminNote: String(formData.get("adminNote") ?? "") || null },
  });
  revalidatePath(`/admin/orders/${id}`);
}

export async function toggleReview(formData: FormData) {
  await requireAdmin();

  const id = Number(formData.get("id"));
  if (!id) return;

  const review = await prisma.review.findUnique({ where: { id } });
  if (!review) return;

  await prisma.review.update({
    where: { id },
    data: { published: !review.published },
  });
  revalidatePath("/admin/reviews");
  revalidatePath("/reviews");
}

export async function deleteReview(formData: FormData) {
  await requireAdmin();

  const id = Number(formData.get("id"));
  if (!id) return;

  await prisma.review.delete({ where: { id } });
  revalidatePath("/admin/reviews");
  revalidatePath("/reviews");
}

export async function updateLeadStatus(formData: FormData) {
  await requireAdmin();

  const id = Number(formData.get("id"));
  const status = String(formData.get("status"));
  const allowed = ["new", "in_progress", "done", "spam"];
  if (!id || !allowed.includes(status)) return;

  await prisma.lead.update({ where: { id }, data: { status } });
  revalidatePath("/admin/leads");
}

export async function updateSeries(formData: FormData) {
  await requireAdmin();

  const id = Number(formData.get("id"));
  if (!id) return;

  const productionDays = Number(formData.get("productionDays"));
  const warrantyMonths = Number(formData.get("warrantyMonths"));

  await prisma.series.update({
    where: { id },
    data: {
      productionDays: Math.max(1, Math.round(productionDays || 1)),
      warrantyMonths: Math.max(1, Math.round(warrantyMonths || 12)),
      active: formData.get("active") === "on",
      popular: formData.get("popular") === "on",
      shortDescription: String(formData.get("shortDescription") ?? ""),
      tagline: String(formData.get("tagline") ?? ""),
    },
  });

  // Фіксовані ціни за варіантами комплекту приходять полями price-{seatSetId}
  const seatSets = await prisma.seatSet.findMany();
  for (const seatSet of seatSets) {
    const raw = formData.get(`price-${seatSet.id}`);
    if (raw === null) continue;

    const price = Number(raw);
    const oldPrice = Number(formData.get(`old-${seatSet.id}`)) || 0;

    // Порожнє поле означає «варіант не продаємо» — прибираємо ціну зовсім.
    if (!Number.isFinite(price) || price <= 0) {
      await prisma.seriesPrice.deleteMany({
        where: { seriesId: id, seatSetId: seatSet.id },
      });
      continue;
    }

    await prisma.seriesPrice.upsert({
      where: { seriesId_seatSetId: { seriesId: id, seatSetId: seatSet.id } },
      create: {
        seriesId: id,
        seatSetId: seatSet.id,
        price: Math.round(price),
        oldPrice: Math.max(0, Math.round(oldPrice)),
      },
      update: {
        price: Math.round(price),
        oldPrice: Math.max(0, Math.round(oldPrice)),
      },
    });
  }

  // Ціни й тексти лінійки видно майже на кожній сторінці вітрини.
  revalidatePath("/", "layout");
}

export async function togglePost(formData: FormData) {
  await requireAdmin();

  const id = Number(formData.get("id"));
  if (!id) return;

  const post = await prisma.post.findUnique({ where: { id } });
  if (!post) return;

  await prisma.post.update({
    where: { id },
    data: {
      published: !post.published,
      publishedAt: post.published ? post.publishedAt : new Date(),
    },
  });
  revalidatePath("/admin/posts");
  revalidatePath("/blog");
}

export async function savePost(formData: FormData) {
  await requireAdmin();

  const id = Number(formData.get("id"));
  const data = {
    title: String(formData.get("title") ?? "").trim(),
    slug: String(formData.get("slug") ?? "").trim(),
    excerpt: String(formData.get("excerpt") ?? "").trim(),
    body: String(formData.get("body") ?? ""),
    seoTitle: String(formData.get("seoTitle") ?? "") || null,
    seoDescription: String(formData.get("seoDescription") ?? "") || null,
  };

  if (!data.title || !data.slug) return;

  if (id) {
    await prisma.post.update({ where: { id }, data });
  } else {
    await prisma.post.create({
      data: { ...data, published: false },
    });
  }

  revalidatePath("/admin/posts");
  revalidatePath("/blog");
  redirect("/admin/posts");
}
