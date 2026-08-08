'use client';

import { useActionState } from 'react';
import type { ReactNode } from 'react';
import type { ActionState } from '@/lib/action-state';
import { Alert, Button } from './ui';

/**
 * Форма, прив'язана до серверної дії: сама показує помилку чи підтвердження
 * і блокує кнопку, доки операція виконується. Це рятує від подвійних списань,
 * коли на складі нетерпляче тицяють кнопку двічі.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  variant = 'primary',
  className = '',
  hideSuccess = false,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  submitLabel: string;
  variant?: 'primary' | 'ghost' | 'danger';
  className?: string;
  hideSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className={`space-y-3 ${className}`}>
      {children}
      {state.error && <Alert tone="red">{state.error}</Alert>}
      {state.ok && !hideSuccess && <Alert tone="green">{state.ok}</Alert>}
      <Button type="submit" variant={variant} disabled={pending}>
        {pending ? 'Виконується…' : submitLabel}
      </Button>
    </form>
  );
}
