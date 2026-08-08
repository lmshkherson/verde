'use server';

import { redirect } from 'next/navigation';
import { queryOne } from '@/lib/db';
import { verifyPassword } from '@/lib/password.mjs';
import { createSession, destroySession, type Role } from '@/lib/session';

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
  }>('select id, full_name, role, password_hash, is_active from app_users where lower(email) = lower($1)', [
    email,
  ]);

  // Одна й та сама відповідь на невідому пошту й хибний пароль — щоб не можна було
  // перебором з'ясувати, які акаунти існують.
  if (!user || !user.is_active || !(await verifyPassword(password, user.password_hash))) {
    return { error: 'Невірна пошта або пароль' };
  }

  await createSession(user);
  redirect('/');
}

export async function logout() {
  await destroySession();
  redirect('/login');
}
