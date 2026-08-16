"use client";

import Image from "next/image";
import { useActionState, useEffect, useMemo, useState } from "react";
import {
  saveShowcase,
  type ShowcaseFormState,
} from "@/app/actions/showcases";
import { Button } from "@/components/ui";
import type { CarTree } from "@/lib/queries";

type Photo = {
  id: number;
  url: string;
  kind: string;
  alt: string;
};

type Showcase = {
  id: number;
  carModelId: number | null;
  carLabel: string;
  year: number | null;
  seriesId: number | null;
  title: string;
  description: string;
  materialNote: string;
  colorNote: string;
  price: number;
  oldPrice: number;
  published: boolean;
  featured: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  photos: Photo[];
};

type Props = {
  showcase: Showcase | null;
  tree: CarTree;
  /** id моделі в базі → щоб привʼязати роботу до сторінки авто */
  modelIds: Record<string, number>;
  /** Марка й модель збереженої роботи, щоб селекти не були порожні */
  initialBrand?: string;
  initialModel?: string;
  seriesOptions: { id: number; name: string }[];
  deletePhotoAction: (formData: FormData) => void;
  saved?: boolean;
};

const inputClass =
  "h-11 w-full rounded-[4px] border border-line px-3 text-sm outline-none focus:border-ink";
const initialState: ShowcaseFormState = {};

export function ShowcaseForm({
  showcase,
  tree,
  modelIds,
  initialBrand = "",
  initialModel = "",
  seriesOptions,
  deletePhotoAction,
  saved,
}: Props) {
  const [state, formAction, pending] = useActionState(saveShowcase, initialState);

  const [brandSlug, setBrandSlug] = useState(initialBrand);
  const [modelSlug, setModelSlug] = useState(initialModel);
  const [year, setYear] = useState(showcase?.year ? String(showcase.year) : "");
  const [carLabel, setCarLabel] = useState(showcase?.carLabel ?? "");
  // Поки менеджер не правив підпис руками, тримаємо його синхронним із вибором.
  const [labelTouched, setLabelTouched] = useState(Boolean(showcase));

  const [carFiles, setCarFiles] = useState<File[]>([]);
  const [coverFiles, setCoverFiles] = useState<File[]>([]);

  const brand = useMemo(
    () => tree.find((item) => item.slug === brandSlug),
    [tree, brandSlug],
  );
  const model = useMemo(
    () => brand?.models.find((item) => item.slug === modelSlug),
    [brand, modelSlug],
  );

  /** Поки менеджер не правив підпис руками, збираємо його з вибору авто. */
  function syncLabel(nextBrandSlug: string, nextModelSlug: string, nextYear: string) {
    if (labelTouched) return;
    const nextBrand = tree.find((item) => item.slug === nextBrandSlug);
    const nextModel = nextBrand?.models.find((item) => item.slug === nextModelSlug);
    if (!nextBrand || !nextModel) return;
    setCarLabel(
      `${nextBrand.name} ${nextModel.name}${nextYear ? `, ${nextYear}` : ""}`,
    );
  }

  const carModelId =
    brand && model ? (modelIds[`${brand.slug}/${model.slug}`] ?? "") : (showcase?.carModelId ?? "");

  const years = useMemo(() => {
    const to = model?.yearTo ?? new Date().getFullYear();
    const from = model?.yearFrom ?? 1995;
    const list: number[] = [];
    for (let value = to; value >= from; value -= 1) list.push(value);
    return list;
  }, [model]);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {showcase ? <input type="hidden" name="id" value={showcase.id} /> : null}
      <input type="hidden" name="carModelId" value={carModelId} />

      {saved && !state.error ? (
        <p className="rounded-[4px] bg-ok-soft px-4 py-3 text-sm font-semibold text-ok">
          Картку збережено.
        </p>
      ) : null}
      {state.error ? (
        <p className="rounded-[4px] bg-sale/10 px-4 py-3 text-sm text-sale">
          {state.error}
        </p>
      ) : null}

      {/* ── Авто ── */}
      <section className="rounded-[4px] border border-line bg-white p-5">
        <h2 className="pb-1 text-lg font-bold">Автомобіль</h2>
        <p className="pb-4 text-sm text-ink-muted">
          Оберіть марку й модель — робота зʼявиться на сторінці цього авто.
          Підпис підставиться сам, але його можна виправити.
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-muted">Марка</span>
            <select
              className={inputClass}
              value={brandSlug}
              onChange={(event) => {
                setBrandSlug(event.target.value);
                setModelSlug("");
                syncLabel(event.target.value, "", year);
              }}
            >
              <option value="">Не привʼязувати</option>
              {tree.map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-muted">Модель</span>
            <select
              className={inputClass}
              value={modelSlug}
              disabled={!brand}
              onChange={(event) => {
                setModelSlug(event.target.value);
                syncLabel(brandSlug, event.target.value, year);
              }}
            >
              <option value="">{brand ? "Оберіть модель" : "Спершу марка"}</option>
              {brand?.models.map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-muted">Рік</span>
            <select
              className={inputClass}
              name="year"
              value={year}
              onChange={(event) => {
                setYear(event.target.value);
                syncLabel(brandSlug, modelSlug, event.target.value);
              }}
            >
              <option value="">Не вказувати</option>
              {years.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-4 flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-muted">
            Підпис авто — він стане заголовком картки *
          </span>
          <input
            className={inputClass}
            name="carLabel"
            value={carLabel}
            onChange={(event) => {
              setCarLabel(event.target.value);
              setLabelTouched(true);
            }}
            placeholder="Škoda Octavia A7, 2018"
            required
          />
        </label>
      </section>

      {/* ── Фото ── */}
      <section className="rounded-[4px] border border-line bg-white p-5">
        <h2 className="pb-1 text-lg font-bold">Фотографії</h2>
        <p className="pb-4 text-sm text-ink-muted">
          Можна вибрати кілька файлів одразу. JPG, PNG, WebP або AVIF, до 8 МБ
          кожен. Перше фото чохлів стає обкладинкою картки.
        </p>

        {showcase && showcase.photos.length > 0 ? (
          <div className="pb-5">
            <h3 className="pb-2 text-sm font-semibold">Уже завантажені</h3>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {showcase.photos.map((photo) => (
                <li
                  key={photo.id}
                  className="overflow-hidden rounded-[4px] border border-line"
                >
                  <div className="relative aspect-4/3 bg-paper-warm">
                    <Image
                      src={photo.url}
                      alt={photo.alt}
                      fill
                      sizes="200px"
                      className="object-cover"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                    <span className="text-[0.7rem] text-ink-muted">
                      {photo.kind === "car" ? "Авто" : "Чохли"}
                    </span>
                    <button
                      type="submit"
                      formAction={deletePhotoAction}
                      formNoValidate
                      name="photoId"
                      value={photo.id}
                      className="text-[0.7rem] font-semibold text-sale hover:underline"
                    >
                      Видалити
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FileField
            label="Фото автомобіля"
            hint="Загальний вигляд авто, щоб покупець упізнав свою модель"
            name="carPhotos"
            files={carFiles}
            onChange={setCarFiles}
          />
          <FileField
            label="Фото чохлів у салоні"
            hint="Головні знімки: передні, задні, крупний план шва"
            name="coverPhotos"
            files={coverFiles}
            onChange={setCoverFiles}
          />
        </div>
      </section>

      {/* ── Ціна й опис ── */}
      <section className="rounded-[4px] border border-line bg-white p-5">
        <h2 className="pb-4 text-lg font-bold">Ціна й опис</h2>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-muted">Ціна, ₴ *</span>
            <input
              className={inputClass}
              name="price"
              type="number"
              min={1}
              defaultValue={showcase?.price ?? ""}
              required
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-muted">
              Стара ціна, ₴ (0 — не показувати)
            </span>
            <input
              className={inputClass}
              name="oldPrice"
              type="number"
              min={0}
              defaultValue={showcase?.oldPrice ?? 0}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-muted">Лінійка</span>
            <select
              className={inputClass}
              name="seriesId"
              defaultValue={showcase?.seriesId ?? ""}
            >
              <option value="">Не вказувати</option>
              {seriesOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 sm:col-span-3">
            <span className="text-xs font-medium text-ink-muted">
              Заголовок картки — якщо порожньо, буде «Авточохли на {carLabel || "…"}»
            </span>
            <input
              className={inputClass}
              name="title"
              defaultValue={showcase?.title ?? ""}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-muted">
              Матеріал — як напишемо в картці
            </span>
            <input
              className={inputClass}
              name="materialNote"
              defaultValue={showcase?.materialNote ?? ""}
              placeholder="Екошкіра преміум + алькантара"
            />
          </label>

          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-xs font-medium text-ink-muted">
              Кольори та строчка
            </span>
            <input
              className={inputClass}
              name="colorNote"
              defaultValue={showcase?.colorNote ?? ""}
              placeholder="Чорний, вставки коньяк, біла строчка, вишивка логотипа"
            />
          </label>

          <label className="flex flex-col gap-1.5 sm:col-span-3">
            <span className="text-xs font-medium text-ink-muted">Опис роботи</span>
            <textarea
              className="min-h-32 w-full rounded-[4px] border border-line p-3 text-sm outline-none focus:border-ink"
              name="description"
              defaultValue={showcase?.description ?? ""}
              placeholder="Що робили, які були особливості салону, скільки зайняло"
            />
          </label>
        </div>
      </section>

      {/* ── SEO й публікація ── */}
      <section className="rounded-[4px] border border-line bg-white p-5">
        <h2 className="pb-4 text-lg font-bold">Публікація</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-muted">SEO-заголовок</span>
            <input
              className={inputClass}
              name="seoTitle"
              defaultValue={showcase?.seoTitle ?? ""}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-muted">SEO-опис</span>
            <input
              className={inputClass}
              name="seoDescription"
              defaultValue={showcase?.seoDescription ?? ""}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-5 border-t border-line-soft pt-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="published"
              defaultChecked={showcase?.published ?? false}
              className="h-4 w-4 accent-[#14161a]"
            />
            Опублікувати на сайті
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="featured"
              defaultChecked={showcase?.featured ?? false}
              className="h-4 w-4 accent-[#14161a]"
            />
            Показувати на головній
          </label>
          <Button type="submit" size="lg" className="ml-auto" disabled={pending}>
            {pending ? "Зберігаємо…" : "Зберегти картку"}
          </Button>
        </div>
      </section>
    </form>
  );
}

function FileField({
  label,
  hint,
  name,
  files,
  onChange,
}: {
  label: string;
  hint: string;
  name: string;
  files: File[];
  onChange: (files: File[]) => void;
}) {
  // Прев'ю виводимо прямо з обраних файлів, а ефект лише звільняє посилання.
  const previews = useMemo(
    () => files.map((file) => URL.createObjectURL(file)),
    [files],
  );

  useEffect(
    () => () => {
      for (const url of previews) URL.revokeObjectURL(url);
    },
    [previews],
  );

  return (
    <div className="flex flex-col gap-2 rounded-[4px] border border-dashed border-line p-4">
      <span className="text-sm font-semibold">{label}</span>
      <span className="text-xs text-ink-muted">{hint}</span>
      <input
        type="file"
        name={name}
        accept="image/jpeg,image/png,image/webp,image/avif"
        multiple
        onChange={(event) => onChange(Array.from(event.target.files ?? []))}
        className="mt-1 text-sm file:mr-3 file:rounded-[4px] file:border file:border-line file:bg-paper file:px-3 file:py-1.5 file:text-sm file:font-semibold"
      />

      {previews.length > 0 ? (
        <ul className="mt-2 grid grid-cols-3 gap-2">
          {previews.map((url, index) => (
            <li
              key={url}
              className="relative aspect-4/3 overflow-hidden rounded-[3px] border border-line"
            >
              {/* Локальний blob — next/image тут не потрібен і не працює */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Обране фото ${index + 1}`}
                className="h-full w-full object-cover"
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
