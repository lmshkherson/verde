import { createUser, resetPassword, setUserActive, updateUser } from '@/app/actions/users';
import { ActionForm } from '@/components/action-form';
import {
  Badge,
  Card,
  Cell,
  Empty,
  Field,
  PageHeader,
  Row,
  Table,
  inputClass,
} from '@/components/ui';
import { query } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { requireRole, ROLE_LABELS, type Role } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const session = await requireRole();

  const users = await query<{
    id: string;
    email: string;
    full_name: string;
    role: Role;
    position: string | null;
    is_active: boolean;
    is_demo: boolean;
    created_at: string;
  }>(
    `select id, email, full_name, role, position, is_active, is_demo, created_at
       from app_users
      order by is_active desc, role, full_name`,
  );

  const demoActive = users.filter((u) => u.is_demo && u.is_active).length;

  return (
    <>
      <PageHeader
        title="Користувачі"
        subtitle="Роль визначає, які розділи видно: комірник не бачить маржі, менеджер не закриває варки"
      />

      {demoActive > 0 && (
        <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          У системі {demoActive} активних демо-акаунтів зі спільним відомим паролем. Перед
          реальною роботою деактивуйте їх — кнопка у кожному рядку.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card title="Список">
          {users.length === 0 ? (
            <Empty>Користувачів немає</Empty>
          ) : (
            <div className="space-y-3">
              {users.map((u) => (
                <div key={u.id} className="rounded-xl border border-emerald-900/10 p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-emerald-950">{u.full_name}</span>
                      <span className="ml-2 text-sm text-emerald-800/60">{u.email}</span>
                      {u.is_demo && (
                        <Badge tone="amber">
                          <span className="ml-1">демо</span>
                        </Badge>
                      )}
                      {u.id === session.uid && (
                        <span className="ml-2 text-xs text-emerald-800/50">(це ви)</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={u.is_active ? 'green' : 'gray'}>
                        {u.is_active ? 'Активний' : 'Деактивований'}
                      </Badge>
                      <span className="text-xs text-emerald-800/50">з {fmtDate(u.created_at)}</span>
                    </div>
                  </div>

                  <ActionForm action={updateUser} submitLabel="Зберегти" variant="ghost" hideSuccess>
                    <input type="hidden" name="user_id" value={u.id} />
                    <div className="grid gap-2 sm:grid-cols-3">
                      <input name="full_name" defaultValue={u.full_name} className={inputClass} />
                      <select name="role" defaultValue={u.role} className={inputClass}>
                        {Object.entries(ROLE_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                      <input
                        name="position"
                        defaultValue={u.position ?? ''}
                        placeholder="Посада для документів"
                        className={inputClass}
                      />
                    </div>
                  </ActionForm>

                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <ActionForm
                      action={resetPassword}
                      submitLabel="Скинути пароль"
                      variant="ghost"
                      hideSuccess
                      className="flex flex-1 items-end gap-2 !space-y-0"
                    >
                      <input type="hidden" name="user_id" value={u.id} />
                      <input
                        name="password"
                        type="password"
                        placeholder="Новий пароль, від 12 символів"
                        className={`${inputClass} flex-1`}
                      />
                    </ActionForm>
                    {u.id !== session.uid && (
                      <ActionForm
                        action={setUserActive}
                        submitLabel={u.is_active ? 'Деактивувати' : 'Активувати'}
                        variant={u.is_active ? 'danger' : 'ghost'}
                        hideSuccess
                      >
                        <input type="hidden" name="user_id" value={u.id} />
                        <input type="hidden" name="active" value={String(!u.is_active)} />
                      </ActionForm>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Новий користувач">
          <p className="mb-3 text-sm text-emerald-800/70">
            Email є логіном. Пароль передавайте особисто — не поштою й не в месенджері разом із
            логіном.
          </p>
          <ActionForm action={createUser} submitLabel="Створити">
            <Field label="Email">
              <input name="email" type="email" required className={inputClass} />
            </Field>
            <Field label="ПІБ">
              <input name="full_name" required className={inputClass} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Роль">
                <select name="role" className={inputClass} defaultValue="warehouse">
                  {Object.entries(ROLE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Посада" hint="друкується в документах">
                <input name="position" className={inputClass} />
              </Field>
            </div>
            <Field label="Пароль" hint="від 12 символів">
              <input name="password" type="password" required className={inputClass} />
            </Field>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
