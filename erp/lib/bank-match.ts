/**
 * Підказки контрагента за назвою з виписки — чисті рядкові функції без
 * серверних залежностей, бо потрібні й у клієнтському компоненті рядка.
 */

export function normalizeName(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/["'«»„“]/g, '')
    .replace(/\b(тов|пп|фоп|пат|прат|ат|тзов|ооо|фізична особа-підприємець)\b/g, '')
    .replace(/[^a-zа-яїієґ0-9]+/gu, ' ')
    .trim();
}

/**
 * Підказка «схоже на цього контрагента» за назвою з виписки.
 *
 * Використовується лише для попереднього вибору у формі: автоматичне
 * рознесення за назвою заборонене навмисно, бо «ТОВ Фора» і «ТОВ Фора Плюс» —
 * різні платники, а помилка тут псує дебіторку.
 */
export function suggestByName(
  name: string | null,
  candidates: { id: string; name: string }[],
): string | null {
  if (!name) return null;
  const needle = normalizeName(name);
  if (needle.length < 4) return null;

  const hit = candidates.find((c) => {
    const other = normalizeName(c.name);
    return other.length >= 4 && (other.includes(needle) || needle.includes(other));
  });
  return hit?.id ?? null;
}
