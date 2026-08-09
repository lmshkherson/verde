'use server';

import { revalidatePath } from 'next/cache';
import { transaction } from '@/lib/db';
import { type ActionState, num, str, strOrNull, toMessage } from '@/lib/action-state';
import { requireRole } from '@/lib/session';

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
           (legal_entity_id, full_name, position, department, monthly_salary, hired_on, cost_behavior, note)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          session.eid,
          name,
          strOrNull(formData, 'position'),
          department,
          salary,
          strOrNull(formData, 'hired_on'),
          str(formData, 'cost_behavior') || 'variable',
          strOrNull(formData, 'note'),
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

      const { rows: employees } = await c.query<{ id: string; department: string; monthly_salary: number }>(
        'select id, department, monthly_salary from employees where legal_entity_id = $1 and is_active',
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
        const gross = round2(e.monthly_salary);
        const pdfo = round2((gross * pdfo_rate) / 100);
        const military = round2((gross * military_rate) / 100);
        const esv = round2((gross * esv_rate) / 100);
        await c.query(
          `insert into payroll_lines (run_id, employee_id, department, gross, pdfo, military, esv, net)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [runId, e.id, e.department, gross, pdfo, military, esv, round2(gross - pdfo - military)],
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
