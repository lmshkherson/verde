import "server-only";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

const COOKIE = "admin_session";
const MAX_AGE = 60 * 60 * 12; // 12 годин

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "AUTH_SECRET не заданий або закороткий. Додайте його в .env перед запуском.",
    );
  }
  return new TextEncoder().encode(secret);
}

export type AdminSession = { id: number; email: string; name: string };

export async function verifyCredentials(
  email: string,
  password: string,
): Promise<AdminSession | null> {
  const user = await prisma.adminUser.findUnique({
    where: { email: email.toLowerCase().trim() },
  });
  if (!user) {
    // Порівнюємо з фіктивним хешем, щоб час відповіді не видавав,
    // існує такий email чи ні.
    await bcrypt.compare(password, "$2a$10$invalidinvalidinvalidinvalidinvalidinva");
    return null;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;

  return { id: user.id, email: user.email, name: user.name };
}

export async function createSession(session: AdminSession) {
  const token = await new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secretKey());

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function getSession(): Promise<AdminSession | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secretKey());
    return {
      id: Number(payload.id),
      email: String(payload.email),
      name: String(payload.name),
    };
  } catch {
    return null;
  }
}

/**
 * Викликається на кожній сторінці адмінки та в кожній серверній дії.
 * Серверні дії доступні прямим POST-запитом, тому перевірка в layout
 * сама по собі нічого не захищає.
 */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await getSession();
  if (!session) redirect("/admin/login");
  return session;
}
