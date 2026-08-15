"use client";

import { useState, useTransition } from "react";
import { createLead } from "@/app/actions/orders";
import { Button } from "@/components/ui";

const inputClass =
  "h-12 w-full rounded-[4px] border border-line bg-white px-3 text-[0.95rem] outline-none transition-colors focus:border-ink";

type Props = {
  type?: "individual" | "callback" | "question";
  title?: string;
  description?: string;
  submitLabel?: string;
  withCar?: boolean;
  withMessage?: boolean;
};

export function LeadForm({
  type = "individual",
  title = "Залишити заявку",
  description = "Передзвонимо протягом робочого дня, уточнимо деталі й назвемо строк.",
  submitLabel = "Відправити заявку",
  withCar = true,
  withMessage = true,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState({
    name: "",
    phone: "",
    carLabel: "",
    message: "",
  });

  function update(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError("");
    startTransition(async () => {
      const result = await createLead({ ...form, type });
      if (result.ok) {
        setDone(true);
        setForm({ name: "", phone: "", carLabel: "", message: "" });
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setFormError(result.error);
    });
  }

  if (done) {
    return (
      <div className="rounded-[4px] border border-line bg-white p-6">
        <h2 className="text-lg font-bold">Заявку прийнято</h2>
        <p className="mt-2 text-ink-muted">
          Передзвонимо протягом робочого дня. Якщо питання термінове — телефонуйте
          самі, ми на звʼязку.
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-4"
          onClick={() => setDone(false)}
        >
          Надіслати ще одну
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-[4px] border border-line bg-white p-6"
    >
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="mt-1 text-sm text-ink-muted">{description}</p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Імʼя *</span>
        <input
          className={inputClass}
          value={form.name}
          onChange={(event) => update("name", event.target.value)}
          autoComplete="name"
          required
        />
        {errors.name ? (
          <span className="text-xs text-sale">{errors.name}</span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Телефон *</span>
        <input
          className={inputClass}
          value={form.phone}
          onChange={(event) => update("phone", event.target.value)}
          placeholder="067 123 45 67"
          inputMode="tel"
          autoComplete="tel"
          required
        />
        {errors.phone ? (
          <span className="text-xs text-sale">{errors.phone}</span>
        ) : null}
      </label>

      {withCar ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Авто</span>
          <input
            className={inputClass}
            value={form.carLabel}
            onChange={(event) => update("carLabel", event.target.value)}
            placeholder="Volkswagen Transporter T6, 2018, 9 місць"
          />
        </label>
      ) : null}

      {withMessage ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Що потрібно</span>
          <textarea
            className="min-h-28 w-full rounded-[4px] border border-line bg-white p-3 text-[0.95rem] outline-none focus:border-ink"
            value={form.message}
            onChange={(event) => update("message", event.target.value)}
            placeholder="Опишіть салон: кількість місць, особливості, бажаний матеріал"
          />
        </label>
      ) : null}

      {formError ? (
        <p className="rounded-[3px] bg-sale/10 px-3 py-2 text-sm text-sale">
          {formError}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Надсилаємо…" : submitLabel}
      </Button>
    </form>
  );
}
