/**
 * Вхідний контроль сировини і HACCP.
 *
 * Ідея одна: партія, яку не перевірили, лежить у карантині й не підбирається
 * при списанні. Дозвіл дає не галочка в примітці, а закритий рядок акта
 * вхідного контролю, під яким є документ постачальника.
 */

export const DOC_KINDS: Record<string, string> = {
  quality: 'Посвідчення про якість',
  declaration: 'Декларація виробника про відповідність',
  vet: 'Ветеринарний документ',
  lab: 'Протокол лабораторних досліджень',
  safety: 'Специфікація / паспорт безпечності',
  other: 'Інший документ',
};

export const QUALITY_STATUS: Record<string, string> = {
  quarantine: 'Карантин',
  released: 'Допущено',
  rejected: 'Забраковано',
};

export const VERDICTS: Record<string, string> = {
  pending: 'Не перевірено',
  accepted: 'Прийнято',
  rejected: 'Забраковано',
};

export const INSPECTION_STATUS: Record<string, string> = {
  draft: 'Триває приймання',
  completed: 'Закрито',
  cancelled: 'Скасовано',
};

export const HACCP_KINDS: Record<string, string> = {
  ccp: 'ККТ',
  oprp: 'оПРП',
  prp: 'ПРП',
};

export const HACCP_STAGES: Record<string, string> = {
  receiving: 'Приймання',
  storage: 'Зберігання',
  production: 'Виробництво',
  packaging: 'Пакування',
  shipping: 'Відвантаження',
};

export interface Limits {
  limit_min: number | null;
  limit_max: number | null;
}

/** Точка без числових меж контролюється якісно: «відповідає / не відповідає». */
export function isQualitative(point: Limits): boolean {
  return point.limit_min === null && point.limit_max === null;
}

/** Чи вкладається виміряне значення в межі точки. */
export function withinLimits(point: Limits, value: number): boolean {
  if (point.limit_min !== null && value < Number(point.limit_min)) return false;
  if (point.limit_max !== null && value > Number(point.limit_max)) return false;
  return true;
}

export function limitsLabel(point: Limits & { unit?: string | null }): string {
  const unit = point.unit ? ` ${point.unit}` : '';
  if (isQualitative(point)) return 'відповідає / ні';
  if (point.limit_min !== null && point.limit_max !== null) {
    return `${point.limit_min}…${point.limit_max}${unit}`;
  }
  if (point.limit_min !== null) return `не менше ${point.limit_min}${unit}`;
  return `не більше ${point.limit_max}${unit}`;
}

/** Скільки годин минуло від останнього запису. Порожньо — записів не було. */
export function hoursSince(at: string | Date | null): number | null {
  if (!at) return null;
  return (Date.now() - new Date(at).getTime()) / 3_600_000;
}

export function isOverdue(point: { max_gap_hours: number | null }, lastAt: string | Date | null) {
  if (!point.max_gap_hours) return false;
  const gap = hoursSince(lastAt);
  return gap === null || gap > point.max_gap_hours;
}
