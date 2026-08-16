"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { removeUpload, saveUpload } from "@/lib/uploads";

export type ShowcaseFormState = { error?: string; ok?: boolean };

/** Транслітерація в URL: «Škoda Octavia A7 2018» → «skoda-octavia-a7-2018». */
const translit: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh",
  з: "z", и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m", н: "n",
  о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia", ы: "y", э: "e", ъ: "",
  š: "s", č: "c", ž: "z", ó: "o", á: "a", é: "e", í: "i", ú: "u", ü: "u",
  ö: "o", ä: "a", ß: "ss",
};

// Не експортуємо: у модулі з "use server" всі експорти мають бути async.
function slugify(input: string): string {
  return input
    .toLowerCase()
    .split("")
    .map((char) => translit[char] ?? char)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

async function uniqueSlug(base: string, ignoreId?: number): Promise<string> {
  const root = base || "robota";
  let candidate = root;
  let counter = 2;

  for (;;) {
    const existing = await prisma.showcase.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing || existing.id === ignoreId) return candidate;
    candidate = `${root}-${counter}`;
    counter += 1;
  }
}

export async function saveShowcase(
  _prev: ShowcaseFormState,
  formData: FormData,
): Promise<ShowcaseFormState> {
  await requireAdmin();

  const id = Number(formData.get("id")) || 0;
  const carLabel = String(formData.get("carLabel") ?? "").trim();
  const price = Number(formData.get("price"));

  if (!carLabel) {
    return { error: "Вкажіть автомобіль — це заголовок картки" };
  }
  if (!Number.isFinite(price) || price <= 0) {
    return { error: "Вкажіть ціну більшу за нуль" };
  }

  const carModelId = Number(formData.get("carModelId")) || null;
  const seriesId = Number(formData.get("seriesId")) || null;
  const yearValue = Number(formData.get("year"));
  const year = Number.isFinite(yearValue) && yearValue > 1950 ? yearValue : null;

  const title =
    String(formData.get("title") ?? "").trim() || `Авточохли на ${carLabel}`;

  const data = {
    carModelId,
    carLabel,
    year,
    seriesId,
    title,
    description: String(formData.get("description") ?? "").trim(),
    materialNote: String(formData.get("materialNote") ?? "").trim(),
    colorNote: String(formData.get("colorNote") ?? "").trim(),
    price: Math.round(price),
    oldPrice: Math.max(0, Math.round(Number(formData.get("oldPrice")) || 0)),
    published: formData.get("published") === "on",
    featured: formData.get("featured") === "on",
    seoTitle: String(formData.get("seoTitle") ?? "").trim() || null,
    seoDescription: String(formData.get("seoDescription") ?? "").trim() || null,
  };

  const showcase = id
    ? await prisma.showcase.update({ where: { id }, data })
    : await prisma.showcase.create({
        data: { ...data, slug: await uniqueSlug(slugify(carLabel)) },
      });

  // Фото приходять двома окремими полями: авто і чохли в салоні.
  const carPhotos = formData.getAll("carPhotos").filter(isFile);
  const coverPhotos = formData.getAll("coverPhotos").filter(isFile);

  const failures: string[] = [];
  let order = await nextPhotoOrder(showcase.id);

  for (const [kind, files] of [
    ["car", carPhotos],
    ["covers", coverPhotos],
  ] as const) {
    for (const file of files) {
      const result = await saveUpload(file);
      if (!result.ok) {
        failures.push(result.error);
        continue;
      }
      await prisma.showcasePhoto.create({
        data: {
          showcaseId: showcase.id,
          url: result.url,
          kind,
          alt: `${kind === "car" ? "Автомобіль" : "Авточохли"} — ${carLabel}`,
          sortOrder: order,
        },
      });
      order += 10;
    }
  }

  await revalidateShowcase(showcase.id);

  if (failures.length > 0) {
    // Картку зберегли, тому не втрачаємо введене — повідомляємо лише про фото.
    return {
      error: `Картку збережено, але частина фото не завантажилась: ${failures.join(" ")}`,
    };
  }

  redirect(`/admin/works/${showcase.id}?saved=1`);
}

function isFile(value: FormDataEntryValue): value is File {
  return value instanceof File && value.size > 0;
}

/**
 * Скидає кеш усіх сторінок, де видно роботу. Сторінку моделі авто треба
 * скидати окремо за точним шляхом: вона рендериться заздалегідь, і без цього
 * нова робота зʼявляється на ній лише після закінчення revalidate.
 */
async function revalidateShowcase(showcaseId: number) {
  const showcase = await prisma.showcase.findUnique({
    where: { id: showcaseId },
    select: {
      slug: true,
      carModel: { select: { slug: true, brand: { select: { slug: true } } } },
    },
  });

  revalidatePath("/admin/works");
  revalidatePath("/roboty");
  revalidatePath("/");

  if (showcase) {
    revalidatePath(`/roboty/${showcase.slug}`);
    if (showcase.carModel) {
      revalidatePath(
        `/chohly/${showcase.carModel.brand.slug}/${showcase.carModel.slug}`,
      );
    }
  }
}

async function nextPhotoOrder(showcaseId: number): Promise<number> {
  const last = await prisma.showcasePhoto.findFirst({
    where: { showcaseId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  return (last?.sortOrder ?? 0) + 10;
}

export async function deleteShowcasePhoto(formData: FormData) {
  await requireAdmin();

  const id = Number(formData.get("photoId"));
  if (!id) return;

  const photo = await prisma.showcasePhoto.findUnique({ where: { id } });
  if (!photo) return;

  await prisma.showcasePhoto.delete({ where: { id } });
  await removeUpload(photo.url);

  revalidatePath(`/admin/works/${photo.showcaseId}`);
  revalidatePath("/roboty");
}

export async function toggleShowcase(formData: FormData) {
  await requireAdmin();

  const id = Number(formData.get("id"));
  if (!id) return;

  const showcase = await prisma.showcase.findUnique({ where: { id } });
  if (!showcase) return;

  await prisma.showcase.update({
    where: { id },
    data: { published: !showcase.published },
  });

  await revalidateShowcase(id);
}

export async function deleteShowcase(formData: FormData) {
  await requireAdmin();

  const id = Number(formData.get("id"));
  if (!id) return;

  const photos = await prisma.showcasePhoto.findMany({
    where: { showcaseId: id },
  });

  // Шляхи збираємо до видалення — після нього звʼязку з авто вже не буде.
  await revalidateShowcase(id);

  await prisma.showcase.delete({ where: { id } });
  for (const photo of photos) await removeUpload(photo.url);

  revalidatePath("/admin/works");
  revalidatePath("/roboty");
  redirect("/admin/works");
}
