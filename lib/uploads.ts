import "server-only";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Зберігання завантажених фото.
 *
 * Файли лягають у public/uploads і віддаються статикою. Це працює на VPS
 * зі звичайним диском. Якщо колись переїдемо на serverless-хостинг, де диск
 * не зберігається між запитами, треба буде замінити saveUpload на S3 —
 * решта коду про сховище не знає.
 */

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const PUBLIC_PREFIX = "/uploads";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
]);

export type UploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export async function saveUpload(file: File): Promise<UploadResult> {
  if (!file || file.size === 0) {
    return { ok: false, error: "Файл порожній" };
  }

  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      error: `Файл ${file.name} важчий за 8 МБ. Стисніть його або зменшіть роздільність.`,
    };
  }

  const extension = ALLOWED.get(file.type);
  if (!extension) {
    return {
      ok: false,
      error: `Формат ${file.type || "невідомий"} не підтримується. Потрібен JPG, PNG, WebP або AVIF.`,
    };
  }

  // Імʼя генеруємо самі: імена з телефона бувають з кирилицею й пробілами,
  // а ще однакові файли перезаписували б одне одного.
  const name = `${randomUUID()}.${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, name), buffer);

  return { ok: true, url: `${PUBLIC_PREFIX}/${name}` };
}

/** Видаляє файл з диска. Помилку глушимо: запис у базі важливіший за файл. */
export async function removeUpload(url: string): Promise<void> {
  if (!url.startsWith(`${PUBLIC_PREFIX}/`)) return;

  const name = path.basename(url);
  try {
    await unlink(path.join(UPLOAD_DIR, name));
  } catch {
    // Файлу вже немає — нічого страшного.
  }
}
