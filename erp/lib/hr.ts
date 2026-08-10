/**
 * Кадрові розрахунки: середньоденна, відпускні, лікарняні, пропорція окладу.
 *
 * Правила спрощені свідомо й чесно:
 *
 *  - середньоденна для відпускних — за Порядком № 100: заробіток за останні
 *    12 місяців, поділений на 365 календарних днів. Святкові дні з дільника
 *    не виключаються — на час воєнного стану їх немає. Якщо історії
 *    нарахувань менше як 12 місяців, береться те, що є, а зовсім без
 *    історії — оклад × 12 / 365;
 *  - лікарняні рахуються з тієї самої середньоденної. Порядок № 1266
 *    формально має власний розрахунок, але для окладної зарплати без премій
 *    результат збігається, а тримати два майже однакові розрахунки — плодити
 *    розбіжності;
 *  - перші 5 календарних днів лікарняного оплачує підприємство, з 6-го — ПФУ
 *    напряму працівникові. Частина фонду зберігається довідково й у витрати
 *    підприємства не входить;
 *  - оклад за місяць пропорційний відпрацьованим робочим дням (пн–пт).
 */

/** Відсоток лікарняних за страховим стажем — ст. 24 ЗУ № 1105-XIV. */
export function sickPercent(insuranceYears: number): number {
  if (insuranceYears < 3) return 50;
  if (insuranceYears < 5) return 60;
  if (insuranceYears < 8) return 70;
  return 100;
}

export const ABSENCE_KINDS: Record<string, string> = {
  vacation: 'Щорічна відпустка',
  sick: 'Лікарняний',
  unpaid: 'Відпустка за свій рахунок',
};

export const PROPERTY_KINDS: Record<string, string> = {
  uniform: 'Спецодяг / форма',
  equipment: 'Техніка й обладнання',
  access: 'Перепустка / ключі',
  document: 'Документ',
  other: 'Інше',
};

const DAY_MS = 86_400_000;

const toUtc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Календарних днів включно з обома межами. */
export function calendarDays(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS) + 1;
}

/** Робочих днів (пн–пт) у місяці періоду YYYY-MM. */
export function workdaysInMonth(period: string): number {
  const [y, m] = period.split('-').map(Number);
  let count = 0;
  for (let day = 1; day <= new Date(Date.UTC(y, m, 0)).getUTCDate(); day += 1) {
    const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}

export interface AbsenceRange {
  kind: string;
  date_from: string;
  date_to: string;
}

/** Скільки днів відсутності припадає на місяць — календарних і робочих. */
export function absenceDaysInMonth(
  absence: AbsenceRange,
  period: string,
): { calendar: number; workdays: number } {
  const [y, m] = period.split('-').map(Number);
  const monthStart = Date.UTC(y, m - 1, 1);
  const monthEnd = Date.UTC(y, m, 0);
  const from = Math.max(toUtc(absence.date_from), monthStart);
  const to = Math.min(toUtc(absence.date_to), monthEnd);
  if (from > to) return { calendar: 0, workdays: 0 };

  let calendar = 0;
  let workdays = 0;
  for (let t = from; t <= to; t += DAY_MS) {
    calendar += 1;
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) workdays += 1;
  }
  return { calendar, workdays };
}

/**
 * Лікарняний: скільки з його днів у цьому місяці оплачує підприємство.
 * Перші 5 календарних днів хвороби — роботодавець, далі ПФУ; якщо лікарняний
 * почався в попередньому місяці, частина «перших п'яти» вже витрачена.
 */
export function sickEmployerDaysInMonth(absence: AbsenceRange, period: string): number {
  const [y, m] = period.split('-').map(Number);
  const monthStart = Date.UTC(y, m - 1, 1);
  const employerEnd = toUtc(absence.date_from) + 4 * DAY_MS;
  const from = Math.max(toUtc(absence.date_from), monthStart);
  const to = Math.min(toUtc(absence.date_to), Date.UTC(y, m, 0), employerEnd);
  return from > to ? 0 : Math.round((to - from) / DAY_MS) + 1;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Середньоденна за Порядком № 100: заробіток за 12 місяців / 365.
 * `earnings12m` — сума нарахувань з історії; якщо історія коротша за рік,
 * місяці, що бракують, добираються з окладу — інакше новачок мав би
 * середньоденну в кілька разів нижчу за реальну.
 */
export function avgDailyPay(earnings12m: number, monthsInHistory: number, monthlySalary: number): number {
  const missingMonths = Math.max(0, 12 - monthsInHistory);
  return round2((earnings12m + missingMonths * monthlySalary) / 365);
}

export interface AbsenceForPayroll extends AbsenceRange {
  avg_daily: number;
}

export interface MonthlyPay {
  baseSalary: number;
  vacationPay: number;
  sickPay: number;
  absenceDays: number;
  gross: number;
}

/** Нарахування за місяць з урахуванням відсутностей. */
export function monthlyPay(
  monthlySalary: number,
  insuranceYears: number,
  absences: AbsenceForPayroll[],
  period: string,
): MonthlyPay {
  const workdays = workdaysInMonth(period);
  let missedWorkdays = 0;
  let vacationPay = 0;
  let sickPay = 0;
  let absenceDays = 0;

  for (const a of absences) {
    const inMonth = absenceDaysInMonth(a, period);
    if (inMonth.calendar === 0) continue;
    missedWorkdays += inMonth.workdays;
    absenceDays += inMonth.calendar;

    if (a.kind === 'vacation') {
      vacationPay += a.avg_daily * inMonth.calendar;
    } else if (a.kind === 'sick') {
      const employerDays = sickEmployerDaysInMonth(a, period);
      sickPay += a.avg_daily * (sickPercent(insuranceYears) / 100) * employerDays;
    }
    // unpaid: просто мінус робочі дні, нарахування немає.
  }

  const baseSalary = round2(
    (monthlySalary * Math.max(workdays - missedWorkdays, 0)) / workdays,
  );

  return {
    baseSalary,
    vacationPay: round2(vacationPay),
    sickPay: round2(sickPay),
    absenceDays,
    gross: round2(baseSalary + vacationPay + sickPay),
  };
}
