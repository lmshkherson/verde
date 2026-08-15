"use client";

import { useState, useTransition } from "react";
import { createReview } from "@/app/actions/orders";
import { Button } from "@/components/ui";

const inputClass =
  "h-12 w-full rounded-[4px] border border-line bg-white px-3 text-[0.95rem] outline-none transition-colors focus:border-ink";

export function ReviewForm() {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [rating, setRating] = useState(5);
  const [form, setForm] = useState({
    author: "",
    city: "",
    carLabel: "",
    text: "",
  });

  function update(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError("");
    startTransition(async () => {
      const result = await createReview({ ...form, rating });
      if (result.ok) {
        setDone(true);
        setForm({ author: "", city: "", carLabel: "", text: "" });
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setFormError(result.error);
    });
  }

  if (done) {
    return (
      <div className="rounded-[4px] border border-line bg-white p-6">
        <h2 className="text-lg font-bold">Дякуємо за відгук</h2>
        <p className="mt-2 text-ink-muted">
          Опублікуємо його після перевірки — зазвичай протягом робочого дня. Ми не
          видаляємо критику: якщо щось пішло не так, це побачать усі.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-[4px] border border-line bg-white p-6"
    >
      <div>
        <h2 className="text-lg font-bold">Залишити відгук</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Напишіть, яке авто й яку лінійку брали — такий відгук справді допомагає
          іншим покупцям.
        </p>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium">Оцінка</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setRating(value)}
              aria-label={`Оцінка ${value} з 5`}
              aria-pressed={rating === value}
              className={`text-2xl leading-none transition-colors ${
                value <= rating ? "text-tan" : "text-ink-faint hover:text-tan/60"
              }`}
            >
              ★
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Імʼя *</span>
          <input
            className={inputClass}
            value={form.author}
            onChange={(event) => update("author", event.target.value)}
            required
          />
          {errors.author ? (
            <span className="text-xs text-sale">{errors.author}</span>
          ) : null}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Місто</span>
          <input
            className={inputClass}
            value={form.city}
            onChange={(event) => update("city", event.target.value)}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Авто *</span>
        <input
          className={inputClass}
          value={form.carLabel}
          onChange={(event) => update("carLabel", event.target.value)}
          placeholder="Škoda Octavia A7, 2016"
          required
        />
        {errors.carLabel ? (
          <span className="text-xs text-sale">{errors.carLabel}</span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Відгук *</span>
        <textarea
          className="min-h-32 w-full rounded-[4px] border border-line bg-white p-3 text-[0.95rem] outline-none focus:border-ink"
          value={form.text}
          onChange={(event) => update("text", event.target.value)}
          placeholder="Як сіли чохли, скільки чекали, що сподобалось і що ні"
          required
        />
        {errors.text ? (
          <span className="text-xs text-sale">{errors.text}</span>
        ) : null}
      </label>

      {formError ? (
        <p className="rounded-[3px] bg-sale/10 px-3 py-2 text-sm text-sale">
          {formError}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Надсилаємо…" : "Опублікувати відгук"}
      </Button>
    </form>
  );
}
