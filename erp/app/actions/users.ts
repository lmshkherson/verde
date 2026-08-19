'use server';

import { revalidatePath } from 'next/cache';
import { transaction } from '@/lib/db';
import { type ActionState, str, strOrNull, toMessage } from '@/lib/action-state';
import { hashPassword, verifyPassword } from '@/lib/password.mjs';
import { requireRole, requireSession } from '@/lib/session';

/**
 * Керування користувачами. Досі додати комірника в бойову базу можна було
 * лише SQL-запитом — для системи, яку віддають людям, це блокер.
 *
 * Усе тут доступне лише власнику; єдиний виняток — зміна власного пароля.
 */

const ROLES = ['owner', 'sales', 'production', 'warehouse'];

// Та сама межа, що й у бойовій ініціалізації: пароль відкриває доступ до
// грошей компанії, коротким він бути не може.
const MIN_PASSWORD = 12;

export async function createUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole();
  const email = str(formData, 'email').toLowerCase();
  const name = str(formData, 'full_name');
  const role = str(formData, 'role');
  const password = str(formData, 'password');

  if (!email.includes('@')) return { error: 'Вкажіть email — він є логіном' };
  if (!name) return { error: 'Вкажіть ПІБ' };
  if (!ROLES.includes(role)) return { error: 'Оберіть роль' };
  if (password.length < MIN_PASSWORD) {
    return { error: `Пароль закороткий — потрібно від ${MIN_PASSWORD} символів` };
  }

  try {
    await transaction(async (c) =>
      c.query(
        `insert into app_users (email, full_name, role, position, password_hash, default_entity_id)
         values ($1, $2, $3, $4, $5, (select id from legal_entities where is_default))`,
        [email, name, role, strOrNull(formData, 'position'), await hashPassword(password)],
      ),
    );
  } catch (err) {
    const message = toMessage(err);
    return {
      error: message.includes('app_users_email_key')
        ? `Користувач ${email} вже існує`
        : message,
    };
  }

  revalidatePath('/users');
  return { ok: 'Користувача створено — передайте пароль особисто, не поштою' };
}

export async function updateUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole();
  const id = str(formData, 'user_id');
  const name = str(formData, 'full_name');
  const role = str(formData, 'role');

  if (!id) return { error: 'Не вказано користувача' };
  if (!name) return { error: 'Вкажіть ПІБ' };
  if (!ROLES.includes(role)) return { error: 'Оберіть роль' };

  try {
    await transaction(async (c) => {
      // Забрати роль в останнього власника означає замкнути систему зсередини:
      // нікому буде керувати користувачами.
      if (role !== 'owner') {
        const { rows } = await c.query<{ n: number }>(
          `select count(*)::int as n from app_users
            where role = 'owner' and is_active and id <> $1`,
          [id],
        );
        if (rows[0].n === 0) {
          throw new Error('Це єдиний активний власник — спершу призначте власником когось іншого');
        }
      }
      if (id === session.uid && role !== 'owner') {
        throw new Error('Знизити роль самому собі не можна — це має зробити інший власник');
      }
      await c.query(
        'update app_users set full_name = $2, role = $3, position = $4 where id = $1',
        [id, name, role, strOrNull(formData, 'position')],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/users');
  return { ok: 'Збережено' };
}

export async function setUserActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole();
  const id = str(formData, 'user_id');
  const active = str(formData, 'active') === 'true';

  try {
    await transaction(async (c) => {
      if (!active) {
        if (id === session.uid) {
          throw new Error('Деактивувати самого себе не можна');
        }
        const { rows } = await c.query<{ n: number }>(
          `select count(*)::int as n from app_users
            where role = 'owner' and is_active and id <> $1`,
          [id],
        );
        const { rows: target } = await c.query<{ role: string }>(
          'select role from app_users where id = $1',
          [id],
        );
        if (target[0]?.role === 'owner' && rows[0].n === 0) {
          throw new Error('Це єдиний активний власник — його деактивація замкнула б систему');
        }
      }
      await c.query('update app_users set is_active = $2 where id = $1', [id, active]);
      await c.query(
        `insert into audit_log (user_id, action, entity, entity_id, details)
         values ($1, $2, 'app_user', $3, '{}'::jsonb)`,
        [session.uid, active ? 'activate' : 'deactivate', id],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/users');
  return { ok: active ? 'Користувача активовано' : 'Користувача деактивовано' };
}

/**
 * Скидання пароля іншому користувачеві. Свій пароль власник теж може змінити
 * тут, але для всіх інших є changeOwnPassword зі старим паролем.
 */
export async function resetPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole();
  const id = str(formData, 'user_id');
  const password = str(formData, 'password');

  if (password.length < MIN_PASSWORD) {
    return { error: `Пароль закороткий — потрібно від ${MIN_PASSWORD} символів` };
  }

  try {
    await transaction(async (c) => {
      await c.query('update app_users set password_hash = $2 where id = $1', [
        id,
        await hashPassword(password),
      ]);
      await c.query(
        `insert into audit_log (user_id, action, entity, entity_id, details)
         values ($1, 'reset_password', 'app_user', $2, '{}'::jsonb)`,
        [session.uid, id],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/users');
  return { ok: 'Пароль змінено — передайте його особисто' };
}

/** Зміна власного пароля: старий пароль обов'язковий, і це не формальність. */
export async function changeOwnPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const current = str(formData, 'current_password');
  const next = str(formData, 'new_password');

  if (next.length < MIN_PASSWORD) {
    return { error: `Новий пароль закороткий — потрібно від ${MIN_PASSWORD} символів` };
  }

  try {
    await transaction(async (c) => {
      const { rows } = await c.query<{ password_hash: string }>(
        'select password_hash from app_users where id = $1',
        [session.uid],
      );
      if (!rows[0] || !(await verifyPassword(current, rows[0].password_hash))) {
        throw new Error('Поточний пароль не підходить');
      }
      await c.query('update app_users set password_hash = $2 where id = $1', [
        session.uid,
        await hashPassword(next),
      ]);
      await c.query(
        // Той самий uid двома параметрами: user_id — uuid, entity_id — text,
        // і повторне $1 у різних типах Postgres відхиляє.
        `insert into audit_log (user_id, action, entity, entity_id, details)
         values ($1, 'change_password', 'app_user', $2, '{}'::jsonb)`,
        [session.uid, session.uid],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  return { ok: 'Пароль змінено' };
}
