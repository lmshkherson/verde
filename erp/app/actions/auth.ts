'use server';

import { redirect } from 'next/navigation';
import { queryOne } from '@/lib/db';
import { verifyPassword } from '@/lib/password.mjs';
import { createSession, destroySession, type EntityRef, type Role } from '@/lib/session';

export interface AuthState {
  error?: string;
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) return { error: 'Введіть пошту й пароль' };

  const user = await queryOne<{
    id: string;
    full_name: string;
    role: Role;
    password_hash: string;
    is_active: boolean;
    default_entity_id: string | null;
  }>(
    `select id, full_name, role, password_hash, is_active, default_entity_id
       from app_users where lower(email) = lower($1)`,
    [email],
  );

  // Одна й та сама відповідь на невідому пошту й хибний пароль — щоб не можна було
  // перебором з'ясувати, які акаунти існують.
  if (!user || !user.is_active || !(await verifyPassword(password, user.password_hash))) {
    return { error: 'Невірна пошта або пароль' };
  }

  // Стартуємо в юрособі за замовчуванням; перемкнути можна в шапці.
  const entity = await queryOne<EntityRef>(
    `select id, short_name, is_vat_payer
       from legal_entities
      where is_active and (id = $1 or $1 is null)
      order by (id = $1) desc, is_default desc, short_name
      limit 1`,
    [user.default_entity_id],
  );
  if (!entity) return { error: 'Не налаштовано жодної юридичної особи' };

  await createSession(user, entity);
  redirect('/');
}

export async function logout() {
  await destroySession();
  redirect('/login');
}
