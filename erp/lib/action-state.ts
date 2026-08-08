export interface ActionState {
  error?: string;
  ok?: string;
}

export const initialActionState: ActionState = {};

/** Дістає зрозумілий користувачеві текст помилки, не показуючи внутрішній стек. */
export function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Не вдалося виконати операцію';
}

export function num(formData: FormData, key: string, fallback = 0): number {
  const raw = String(formData.get(key) ?? '').replace(',', '.').trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim();
}

export function strOrNull(formData: FormData, key: string): string | null {
  const value = str(formData, key);
  return value === '' ? null : value;
}
