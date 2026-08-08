import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export type Role = 'owner' | 'sales' | 'production' | 'warehouse';

export interface Session {
  uid: string;
  name: string;
  role: Role;
  exp: number;
}

const COOKIE = 'verde_session';
const MAX_AGE_SEC = 60 * 60 * 12;

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Власник',
  sales: 'Менеджер із продажу',
  production: 'Технолог',
  warehouse: 'Комірник',
};

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET не заданий');
  return s;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function serialize(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function deserialize(raw: string): Session | null {
  const [payload, mac] = raw.split('.');
  if (!payload || !mac) return null;

  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
    return session.exp > Date.now() / 1000 ? session : null;
  } catch {
    return null;
  }
}

export async function createSession(user: { id: string; full_name: string; role: Role }) {
  const session: Session = {
    uid: user.id,
    name: user.full_name,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC,
  };
  const store = await cookies();
  store.set(COOKIE, serialize(session), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SEC,
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  return raw ? deserialize(raw) : null;
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

/**
 * Пускає далі лише вказані ролі. Власник бачить усе, тож завжди у списку.
 */
export async function requireRole(...roles: Role[]): Promise<Session> {
  const session = await requireSession();
  if (session.role !== 'owner' && !roles.includes(session.role)) redirect('/?denied=1');
  return session;
}

export function canAccess(role: Role, section: Section): boolean {
  return role === 'owner' || SECTION_ROLES[section].includes(role);
}

export type Section =
  | 'dashboard'
  | 'stock'
  | 'production'
  | 'sales'
  | 'purchasing'
  | 'catalog'
  | 'reports';

// Ролі навмисно вузькі: комірник не бачить маржі, менеджер не закриває варки.
// Власнику доступне все — його перевіряють окремо, у canAccess і requireRole.
export const SECTION_ROLES: Record<Section, Role[]> = {
  dashboard: ['owner', 'sales', 'production', 'warehouse'],
  stock: ['warehouse', 'production', 'sales'],
  production: ['production'],
  sales: ['sales'],
  purchasing: ['warehouse'],
  catalog: ['production', 'sales'],
  reports: [],
};
