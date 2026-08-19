'use client';

import { useActionState } from 'react';
import { login } from '@/app/actions/auth';
import { Alert, Button, Field, inputClass } from '@/components/ui';

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, {});

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Робоча пошта">
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          className={inputClass}
          placeholder="ivan@v-verde.ua"
        />
      </Field>
      <Field label="Пароль">
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </Field>
      {state.error && <Alert tone="red">{state.error}</Alert>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Заходимо…' : 'Увійти'}
      </Button>
    </form>
  );
}
