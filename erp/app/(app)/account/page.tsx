import { changeOwnPassword } from '@/app/actions/users';
import { ActionForm } from '@/components/action-form';
import { Card, Field, PageHeader, inputClass } from '@/components/ui';
import { requireSession, ROLE_LABELS } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Єдина сторінка, доступна будь-якій ролі: власний профіль і пароль. */
export default async function AccountPage() {
  const session = await requireSession();

  return (
    <>
      <PageHeader
        title="Мій акаунт"
        subtitle={`${session.name} · ${ROLE_LABELS[session.role]}`}
      />

      <div className="max-w-md">
        <Card title="Зміна пароля">
          <ActionForm action={changeOwnPassword} submitLabel="Змінити пароль">
            <Field label="Поточний пароль">
              <input name="current_password" type="password" required className={inputClass} />
            </Field>
            <Field label="Новий пароль" hint="від 12 символів">
              <input name="new_password" type="password" required className={inputClass} />
            </Field>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
