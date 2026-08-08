import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { LoginForm } from './login-form';

export default async function LoginPage() {
  if (await getSession()) redirect('/');

  return (
    <main className="flex min-h-dvh items-center justify-center bg-emerald-950 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-3xl font-black tracking-wide text-white">
            VERDE <span className="rounded-lg bg-emerald-400 px-2 text-emerald-950">ERP</span>
          </div>
          <p className="mt-2 text-sm text-emerald-200/70">
            Виробництво · Склад · Закупівлі · Продажі
          </p>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-xl">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
