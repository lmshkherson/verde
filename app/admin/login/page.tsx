"use client";

import { useState, useTransition } from "react";
import { login } from "@/app/actions/admin";
import { Button } from "@/components/ui";
import { site } from "@/lib/site";

export default function AdminLoginPage() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  // Поля контрольовані навмисно: React 19 скидає форму після серверної дії,
  // і після помилки користувач мусив би вводити email заново.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    const formData = new FormData();
    formData.set("email", email);
    formData.set("password", password);

    startTransition(async () => {
      const result = await login({}, formData);
      if (result?.error) {
        setError(result.error);
        setPassword("");
      }
    });
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <form
        onSubmit={submit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-[4px] border border-line bg-white p-6"
      >
        <div>
          <p className="label">{site.name}</p>
          <h1 className="mt-1 text-2xl font-bold">Вхід в адмінку</h1>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="username"
            className="h-12 w-full rounded-[4px] border border-line px-3 outline-none focus:border-ink"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Пароль</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoComplete="current-password"
            className="h-12 w-full rounded-[4px] border border-line px-3 outline-none focus:border-ink"
          />
        </label>

        {error ? (
          <p className="rounded-[3px] bg-sale/10 px-3 py-2 text-sm text-sale">
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Перевіряємо…" : "Увійти"}
        </Button>
      </form>
    </div>
  );
}
