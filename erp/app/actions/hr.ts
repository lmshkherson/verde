'use server';

import { revalidatePath } from 'next/cache';
import { transaction } from '@/lib/db';
import { type ActionState, num, str, strOrNull, toMessage } from '@/lib/action-state';
import { requireRole } from '@/lib/session';
import { avgDailyPay, calendarDays, monthlyPay, sickPercent } from '@/lib/hr';

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function createEmployee(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole();
  const name = str(formData, 'full_name');
  const department = str(formData, 'department');
  const salary = num(formData, 'monthly_salary');

  if (!name) return { error: 'Вкажіть ПІБ' };
  if (!department) return { error: 'Оберіть підрозділ' };
  if (salary <= 0) return { error: 'Вкажіть оклад' };

  try {
    await transaction((c) =>
      c.query(
        `insert into employees
           (legal_entity_id, full_name, position, department, monthly_salary, hired_on,
            cost_behavior, note, tax_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          session.eid,
          name,
          strOrNull(formData, 'position'),
          department,
          salary,
          strOrNull(formData, 'hired_on'),
          str(formData, 'cost_behavior') || 'variable',
          strOrNull(formData, 'note'),
          strOrNull(formData, 'tax_id'),
        ],
      ),
    );
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/payroll');
  return { ok: 'Працівника додано' };
}

/**
 * Нарахування зарплати за місяць. Ставки податків беруться з налаштувань:
 * ПДФО і військовий збір утримуються з працівника, ЄСВ нараховується
 * роботодавцем зверху й теж є витратою.
 */
export async function createPayrollRun(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole();
  const period = str(formData, 'period');
  if (!/^\d{4}-\d{2}$/.test(period)) return { error: 'Невірний період' };

  try {
    await transaction(async (c) => {
      const { rows: rates } = await c.query<{ pdfo_rate: number; military_rate: number; esv_rate: number }>(
        'select pdfo_rate, military_rate, esv_rate from settings where id = 1',
      );
      const { pdfo_rate, military_rate, esv_rate } = rates[0];

      const { rows: employees } = await c.query<{
        id: string;
        department: string;
        monthly_salary: number;
        insurance_years: number;
      }>(
        `select id, department, monthly_salary, insurance_years
           from employees where legal_entity_id = $1 and is_active`,
        [session.eid],
      );
      if (employees.length === 0) throw new Error('Немає активних працівників');

      const { rows: run } = await c.query<{ id: string }>(
        `insert into payroll_runs (legal_entity_id, period, created_by)
         values ($1, $2::date, $3)
         on conflict (legal_entity_id, period) do update set created_by = excluded.created_by
         returning id`,
        [session.eid, `${period}-01`, session.uid],
      );
      const runId = run[0].id;

      const { rows: existing } = await c.query<{ status: string }>(
        'select status from payroll_runs where id = $1',
        [runId],
      );
      if (existing[0].status !== 'draft') throw new Error('Нарахування вже проведене');

      await c.query('delete from payroll_lines where run_id = $1', [runId]);

      for (const e of employees) {
        // Відсутності, що зачіпають місяць нарахування. Середньоденна взята
        // з самої відсутності — вона зафіксована при оформленні.
        const { rows: absences } = await c.query<{
          kind: string;
          date_from: string;
          date_to: string;
          avg_daily: number;
        }>(
          `select kind, date_from::text, date_to::text, avg_daily
             from employee_absences
            where employee_id = $1
              and date_from < ($2::date + interval '1 month')
              and date_to >= $2::date`,
          [e.id, `${period}-01`],
        );

        const pay = monthlyPay(Number(e.monthly_salary), e.insurance_years, absences, period);
        const gross = pay.gross;
        const pdfo = round2((gross * pdfo_rate) / 100);
        const military = round2((gross * military_rate) / 100);
        const esv = round2((gross * esv_rate) / 100);
        await c.query(
          `insert into payroll_lines
             (run_id, employee_id, department, gross, pdfo, military, esv, net,
              base_salary, vacation_pay, sick_pay, absence_days)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            runId, e.id, e.department, gross, pdfo, military, esv,
            round2(gross - pdfo - military),
            pay.baseSalary, pay.vacationPay, pay.sickPay, pay.absenceDays,
          ],
        );
      }
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/payroll');
  return { ok: 'Нарахування сформовано' };
}

export async function postPayrollRun(formData: FormData) {
  await requireRole();
  await transaction((c) =>
    c.query("update payroll_runs set status = 'posted' where id = $1 and status = 'draft'", [
      str(formData, 'run_id'),
    ]),
  );
  revalidatePath('/payroll');
}

/**
 * Повернення проведеної відомості в чернетку — щоб виправити відсутність чи
 * оклад і сформувати заново. Виплачену повертати не можна: гроші вже пішли.
 */
export async function unpostPayrollRun(formData: FormData) {
  await requireRole();
  await transaction((c) =>
    c.query("update payroll_runs set status = 'draft' where id = $1 and status = 'posted'", [
      str(formData, 'run_id'),
    ]),
  );
  revalidatePath('/payroll');
}

export async function payPayrollRun(formData: FormData) {
  await requireRole();
  await transaction((c) =>
    c.query(
      `update payroll_runs set status = 'paid', paid_on = coalesce($2::date, current_date)
        where id = $1 and status = 'posted'`,
      [str(formData, 'run_id'), strOrNull(formData, 'paid_on')],
    ),
  );
  revalidatePath('/payroll');
}

export async function createFixedAsset(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole();
  const name = str(formData, 'name');
  const cost = num(formData, 'cost');
  const life = num(formData, 'useful_life_months');
  const lifeMgmt = num(formData, 'useful_life_mgmt');

  if (!name) return { error: 'Вкажіть назву' };
  if (cost <= 0) return { error: 'Вкажіть первісну вартість' };
  if (life <= 0) return { error: 'Вкажіть строк корисного використання' };
  if (num(formData, 'residual_value') >= cost) {
    return { error: 'Ліквідаційна вартість не може бути більшою за первісну' };
  }

  try {
    await transaction((c) =>
      c.query(
        `insert into fixed_assets
           (legal_entity_id, name, inventory_no, department, acquired_on, cost,
            residual_value, useful_life_months, useful_life_mgmt, cost_behavior, note)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          session.eid,
          name,
          strOrNull(formData, 'inventory_no'),
          str(formData, 'department') || 'production',
          str(formData, 'acquired_on') || new Date().toISOString().slice(0, 10),
          cost,
          num(formData, 'residual_value'),
          life,
          lifeMgmt > 0 ? lifeMgmt : null,
          str(formData, 'cost_behavior') || 'fixed',
          strOrNull(formData, 'note'),
        ],
      ),
    );
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/assets');
  return { ok: 'Основний засіб додано' };
}

/**
 * Нарахування амортизації за місяць, прямолінійним методом.
 * Строк для управлінського обліку може відрізнятися — тоді й сума інша,
 * і в проводках з'являється розбіжність між книгами.
 */
export async function runDepreciation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole();
  const period = str(formData, 'period');
  if (!/^\d{4}-\d{2}$/.test(period)) return { error: 'Невірний період' };

  let lines = 0;
  try {
    await transaction(async (c) => {
      const { rows: run } = await c.query<{ id: string }>(
        `insert into depreciation_runs (legal_entity_id, period, created_by)
         values ($1, $2::date, $3)
         on conflict (legal_entity_id, period) do update set created_by = excluded.created_by
         returning id`,
        [session.eid, `${period}-01`, session.uid],
      );
      const runId = run[0].id;
      await c.query('delete from depreciation_lines where run_id = $1', [runId]);

      const { rows: assets } = await c.query<{
        id: string;
        department: string;
        cost: number;
        residual_value: number;
        useful_life_months: number;
        useful_life_mgmt: number | null;
        accumulated_accounting: number;
        accumulated_management: number;
      }>(
        `select a.id, a.department, a.cost, a.residual_value, a.useful_life_months, a.useful_life_mgmt,
                d.accumulated_accounting, d.accumulated_management
           from fixed_assets a
           join v_asset_depreciation d on d.asset_id = a.id
          where a.legal_entity_id = $1 and a.is_active
            and a.acquired_on < ($2::date + interval '1 month')
            and (a.disposed_on is null or a.disposed_on >= $2::date)`,
        [session.eid, `${period}-01`],
      );

      for (const a of assets) {
        const depreciable = a.cost - a.residual_value;
        // Нарахування зупиняється, коли вартість, що амортизується, вичерпана.
        const monthlyAcc = round2(depreciable / a.useful_life_months);
        const monthlyMgmt = round2(depreciable / (a.useful_life_mgmt ?? a.useful_life_months));

        const amountAcc = Math.max(0, Math.min(monthlyAcc, depreciable - a.accumulated_accounting));
        const amountMgmt = Math.max(0, Math.min(monthlyMgmt, depreciable - a.accumulated_management));
        if (amountAcc <= 0 && amountMgmt <= 0) continue;

        await c.query(
          `insert into depreciation_lines
             (run_id, asset_id, department, amount_accounting, amount_management)
           values ($1, $2, $3, $4, $5)`,
          [runId, a.id, a.department, round2(amountAcc), round2(amountMgmt)],
        );
        lines += 1;
      }
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/assets');
  return { ok: `Амортизацію нараховано по ${lines} об’єктах` };
}

/** Кадрові дані картки. Оклад і підрозділ теж тут — картка одна. */
export async function updateEmployee(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole();
  const id = str(formData, 'employee_id');
  const name = str(formData, 'full_name');
  if (!id) return { error: 'Не вказано працівника' };
  if (!name) return { error: 'Вкажіть ПІБ' };

  try {
    await transaction((c) =>
      c.query(
        `update employees set
           full_name = $2, position = $3, department = $4, monthly_salary = $5,
           hired_on = $6, dismissed_on = $7, cost_behavior = $8, note = $9,
           tax_id = $10, birth_date = $11, id_document = $12, phone = $13,
           email = $14, address = $15, vacation_days_per_year = $16, insurance_years = $17,
           is_active = ($7::date is null)
         where id = $1 and legal_entity_id = $18`,
        [
          id,
          name,
          strOrNull(formData, 'position'),
          str(formData, 'department') || 'production',
          num(formData, 'monthly_salary'),
          strOrNull(formData, 'hired_on'),
          strOrNull(formData, 'dismissed_on'),
          str(formData, 'cost_behavior') || 'variable',
          strOrNull(formData, 'note'),
          strOrNull(formData, 'tax_id'),
          strOrNull(formData, 'birth_date'),
          strOrNull(formData, 'id_document'),
          strOrNull(formData, 'phone'),
          strOrNull(formData, 'email'),
          strOrNull(formData, 'address'),
          Math.round(num(formData, 'vacation_days_per_year', 24)),
          Math.round(num(formData, 'insurance_years', 8)),
          session.eid,
        ],
      ),
    );
  } catch (err) {
    const message = toMessage(err);
    return {
      error: message.includes('employees_tax_id_key')
        ? 'Працівник із таким РНОКПП у цій юрособі вже є'
        : message,
    };
  }

  revalidatePath(`/payroll/employees/${id}`);
  revalidatePath('/payroll');
  return { ok: 'Картку збережено' };
}

/**
 * Оформлення відсутності. Середньоденна фіксується тут і не перераховується:
 * видані відпускні заднім числом не змінюють.
 *
 * Відпустка авансом дозволена — це законно за згодою роботодавця, тож
 * від'ємний залишок не блокується, а показується на картці.
 */
export async function createAbsence(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole();
  const employeeId = str(formData, 'employee_id');
  const kind = str(formData, 'kind');
  const from = str(formData, 'date_from');
  const to = str(formData, 'date_to');

  if (!employeeId) return { error: 'Не вказано працівника' };
  if (!['vacation', 'sick', 'unpaid'].includes(kind)) return { error: 'Оберіть вид відсутності' };
  if (!from || !to) return { error: 'Вкажіть дати' };
  if (to < from) return { error: 'Дата закінчення раніша за початок' };

  const days = calendarDays(from, to);
  if (days > 366) return { error: 'Відсутність довша за рік — перевірте дати' };

  try {
    await transaction(async (c) => {
      const { rows: emp } = await c.query<{
        monthly_salary: number;
        insurance_years: number;
        legal_entity_id: string;
      }>(
        'select monthly_salary, insurance_years, legal_entity_id from employees where id = $1',
        [employeeId],
      );
      if (!emp[0] || emp[0].legal_entity_id !== session.eid) {
        throw new Error('Працівника не знайдено');
      }

      // Перетини з уже оформленими відсутностями — людина не може бути
      // одночасно у відпустці й на лікарняному.
      const { rows: overlap } = await c.query<{ n: number }>(
        `select count(*)::int as n from employee_absences
          where employee_id = $1 and date_from <= $3::date and date_to >= $2::date`,
        [employeeId, from, to],
      );
      if (overlap[0].n > 0) {
        throw new Error('Період перетинається з уже оформленою відсутністю');
      }

      // Заробіток за останні 12 місяців з історії нарахувань.
      const { rows: history } = await c.query<{ earnings: number; months: number }>(
        `select coalesce(sum(l.gross), 0) as earnings, count(*)::int as months
           from payroll_lines l
           join payroll_runs r on r.id = l.run_id
          where l.employee_id = $1 and r.status in ('posted', 'paid')
            and r.period >= (date_trunc('month', $2::date) - interval '12 months')
            and r.period < date_trunc('month', $2::date)`,
        [employeeId, from],
      );
      const avgDaily = avgDailyPay(
        Number(history[0].earnings),
        Number(history[0].months),
        Number(emp[0].monthly_salary),
      );

      let amount = 0;
      let fundAmount = 0;
      if (kind === 'vacation') {
        amount = round2(avgDaily * days);
      } else if (kind === 'sick') {
        const pct = sickPercent(emp[0].insurance_years) / 100;
        const employerDays = Math.min(days, 5);
        amount = round2(avgDaily * pct * employerDays);
        fundAmount = round2(avgDaily * pct * (days - employerDays));
      }

      await c.query(
        `insert into employee_absences
           (employee_id, kind, date_from, date_to, calendar_days, avg_daily, amount, fund_amount, note, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [employeeId, kind, from, to, days, avgDaily, amount, fundAmount,
         strOrNull(formData, 'note'), session.uid],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/payroll/employees/${employeeId}`);
  return { ok: 'Відсутність оформлено' };
}

/**
 * Видалити можна лише відсутність, яка ще не зачеплена проведеним
 * нарахуванням: інакше відомість і кадровий облік розійшлися б.
 */
export async function deleteAbsence(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole();
  const employeeId = str(formData, 'employee_id');
  const absenceId = str(formData, 'absence_id');

  try {
    await transaction(async (c) => {
      const { rows } = await c.query<{ n: number }>(
        `select count(*)::int as n
           from employee_absences a
           join payroll_runs r on r.status in ('posted', 'paid')
            and r.period <= a.date_to
            and (r.period + interval '1 month') > a.date_from
           join payroll_lines l on l.run_id = r.id and l.employee_id = a.employee_id
          where a.id = $1`,
        [absenceId],
      );
      if (rows[0].n > 0) {
        throw new Error(
          'Період уже потрапив у проведене нарахування. Спершу поверніть відомість у чернетку.',
        );
      }
      await c.query('delete from employee_absences where id = $1', [absenceId]);
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/payroll/employees/${employeeId}`);
  return { ok: 'Відсутність видалено' };
}

export async function issueProperty(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole();
  const employeeId = str(formData, 'employee_id');
  const name = str(formData, 'name');
  if (!name) return { error: 'Вкажіть, що видано' };

  try {
    await transaction((c) =>
      c.query(
        `insert into employee_property (employee_id, kind, name, issued_on, note, created_by)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          employeeId,
          str(formData, 'kind') || 'equipment',
          name,
          str(formData, 'issued_on') || new Date().toISOString().slice(0, 10),
          strOrNull(formData, 'note'),
          session.uid,
        ],
      ),
    );
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/payroll/employees/${employeeId}`);
  return { ok: 'Записано' };
}

export async function returnProperty(formData: FormData) {
  await requireRole();
  const employeeId = str(formData, 'employee_id');
  await transaction((c) =>
    c.query(
      `update employee_property set returned_on = current_date
        where id = $1 and returned_on is null`,
      [str(formData, 'property_id')],
    ),
  );
  revalidatePath(`/payroll/employees/${employeeId}`);
}
