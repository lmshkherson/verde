import { z } from "zod";

/** Український номер у будь-якому звичному записі → +380XXXXXXXXX. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("380")) return `+${digits}`;
  if (digits.length === 10 && digits.startsWith("0")) return `+38${digits}`;
  if (digits.length === 9) return `+380${digits}`;
  return null;
}

const phoneSchema = z
  .string()
  .min(1, "Вкажіть телефон")
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({
        code: "custom",
        message: "Телефон має бути у форматі 0XX XXX XX XX",
      });
      return z.NEVER;
    }
    return normalized;
  });

export const orderItemSchema = z.object({
  seriesId: z.number().int().positive(),
  seriesName: z.string().min(1),
  carLabel: z.string().min(1),
  colorName: z.string().min(1),
  options: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      price: z.number().int().nonnegative(),
    }),
  ),
  unitPrice: z.number().int().positive(),
  quantity: z.number().int().min(1).max(20),
});

export const orderSchema = z.object({
  customerName: z.string().min(2, "Вкажіть імʼя"),
  phone: phoneSchema,
  email: z
    .union([z.string().email("Перевірте адресу пошти"), z.literal("")])
    .optional(),
  deliveryMethod: z.string().min(1, "Оберіть спосіб доставки"),
  city: z.string().min(2, "Вкажіть місто"),
  warehouse: z.string().optional(),
  address: z.string().optional(),
  paymentMethod: z.string().min(1, "Оберіть спосіб оплати"),
  comment: z.string().max(1000).optional(),
  items: z.array(orderItemSchema).min(1, "Кошик порожній"),
});

export type OrderInput = z.infer<typeof orderSchema>;

export const leadSchema = z.object({
  type: z.enum(["individual", "callback", "question"]).default("individual"),
  name: z.string().min(2, "Вкажіть імʼя"),
  phone: phoneSchema,
  carLabel: z.string().max(200).optional(),
  message: z.string().max(2000).optional(),
});

export const reviewSchema = z.object({
  author: z.string().min(2, "Вкажіть імʼя"),
  city: z.string().max(100).optional(),
  carLabel: z.string().min(2, "Вкажіть авто"),
  rating: z.coerce.number().int().min(1).max(5),
  text: z.string().min(20, "Розкажіть трохи детальніше — від 20 символів"),
});

// На вході не перевіряємо довжину пароля: користувач має бачити «невірний
// email або пароль», а не підказку про формат.
export const loginSchema = z.object({
  email: z.string().email("Перевірте адресу пошти"),
  password: z.string().min(1, "Введіть пароль"),
});
