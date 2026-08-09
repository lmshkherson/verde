import { createEmployee, createPayrollRun, payPayrollRun, postPayrollRun } from '@/app/actions/hr';
import { ActionForm } from '@/components/action-form';
import { Badge, Button, Card, Cell, Empty, Field, inputClass, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { fmtMoney } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const monthFmt = new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric' });

const DEPARTMENTS: Record<string, string> = {
  production: 'Цех',
  admin: 'Адміністрація',
  sales: 'Збут',
};

const STATUS: Record<string, string> = { draft: 'Чернетка', posted: 'Проведено', paid: 'Виплачено' };

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await requireRole();
  const { period } = await searchParams;

  const now = new Date();
  const current = period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const from = `${current}-01`;

  const [employees, run, lines, rates] = await Promise.all([
    query<{ id: string; full_name: string; position: string | null; department: string; monthly_salary: number }>(
      `select id, full_name, position, department, monthly_salary
         from employees where legal_entity_id = $1 and is_active order by department, full_name`,
      [session.eid],
    ),
    queryOne<{
      run_id: string;
      status: string;
      gross: number;
      pdfo: number;
      military: number;
      esv: number;
      net: number;
      total_cost: number;
      production_cost: number;
    }>(
      `select run_id, status, gross, pdfo, military, esv, net, total_cost, production_cost
         from v_payroll_totals where legal_entity_id = $1 and period = $2::date`,
      [session.eid, from],
    ),
    query<{ full_name: string; department: string; gross: number; pdfo: number; military: number; esv: number; net: number }>(
      `select e.full_name, l.department, l.gross, l.pdfo, l.military, l.esv, l.net
         from payroll_lines l
         join payroll_runs r on r.id = l.run_id
         join employees e on e.id = l.employee_id
        where r.legal_entity_id = $1 and r.period = $2::date
        order by l.department, e.full_name`,
      [session.eid, from],
    ),
    queryOne<{ pdfo_rate: number; military_rate: number; esv_rate: number }>(
      'select pdfo_rate, military_rate, esv_rate from settings where id = 1',
    ),
  ]);

  return (
    <>
      <PageHeader
        title="Зарплата"
        subtitle={`${session.ename} · ${monthFmt.format(new Date(from))} · ПДФО ${rates?.pdfo_rate}%, ВЗ ${rates?.military_rate}%, ЄСВ ${rates?.esv_rate}%`}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Нараховано" value={fmtMoney(run?.gross ?? 0)} hint="до утримань" />
        <Stat label="До виплати" value={fmtMoney(run?.net ?? 0)} hint="на руки" />
        <Stat
          label="Податки"
          value={fmtMoney((run?.pdfo ?? 0) + (run?.military ?? 0) + (run?.esv ?? 0))}
          hint="ПДФО + ВЗ + ЄСВ"
        />
        <Stat
          label="Загальна вартість"
          value={fmtMoney(run?.total_cost ?? 0)}
          hint={`з них цех ${fmtMoney(run?.production_cost ?? 0)}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card
            title={`Нарахування за ${monthFmt.format(new Date(from))}`}
            action={
              run ? <Badge tone={run.status === 'paid' ? 'green' : run.status === 'posted' ? 'blue' : 'gray'}>{STATUS[run.status]}</Badge> : undefined
            }
          >
            {lines.length === 0 ? (
              <Empty>Нарахування ще не сформоване</Empty>
            ) : (
              <>
                <Table head={['Працівник', 'Підрозділ', 'Нараховано', 'ПДФО', 'ВЗ', 'ЄСВ', 'До виплати']}>
                  {lines.map((l, i) => (
                    <Row key={i}>
                      <Cell className="font-semibold">{l.full_name}</Cell>
                      <Cell>
                        <Badge tone={l.department === 'production' ? 'amber' : 'gray'}>
                          {DEPARTMENTS[l.department]}
                        </Badge>
                      </Cell>
                      <Cell align="right">{fmtMoney(l.gross)}</Cell>
                      <Cell align="right">{fmtMoney(l.pdfo)}</Cell>
                      <Cell align="right">{fmtMoney(l.military)}</Cell>
                      <Cell align="right">{fmtMoney(l.esv)}</Cell>
                      <Cell align="right" className="font-semibold">
                        {fmtMoney(l.net)}
                      </Cell>
                    </Row>
                  ))}
                </Table>

                {run && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {run.status === 'draft' && (
                      <form action={postPayrollRun}>
                        <input type="hidden" name="run_id" value={run.run_id} />
                        <Button className="!min-h-10">Провести</Button>
                      </form>
                    )}
                    {run.status === 'posted' && (
                      <form action={payPayrollRun} className="flex items-end gap-2">
                        <input type="hidden" name="run_id" value={run.run_id} />
                        <input
                          name="paid_on"
                          type="date"
                          defaultValue={new Date().toISOString().slice(0, 10)}
                          className={`${inputClass} !min-h-10 w-44`}
                        />
                        <Button className="!min-h-10">Виплатити</Button>
                      </form>
                    )}
                  </div>
                )}

                <p className="mt-4 text-xs text-emerald-800/60">
                  Зарплата цеху в бухгалтерському обліку йде Дт 23 у виробництво, в управлінському —
                  Дт 91 у витрати періоду. Адміністрація і збут однакові в обох книгах.
                </p>
              </>
            )}
          </Card>

          <Card title="Працівники">
            {employees.length === 0 ? (
              <Empty>Працівників ще не заведено</Empty>
            ) : (
              <Table head={['ПІБ', 'Посада', 'Підрозділ', 'Оклад']}>
                {employees.map((e) => (
                  <Row key={e.id}>
                    <Cell className="font-semibold">{e.full_name}</Cell>
                    <Cell>{e.position ?? '—'}</Cell>
                    <Cell>
                      <Badge tone={e.department === 'production' ? 'amber' : 'gray'}>
                        {DEPARTMENTS[e.department]}
                      </Badge>
                    </Cell>
                    <Cell align="right" className="font-semibold">
                      {fmtMoney(e.monthly_salary)}
                    </Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Сформувати нарахування">
            <p className="mb-3 text-sm text-emerald-800/70">
              Береться оклад кожного активного працівника, з нього утримуються ПДФО й військовий
              збір, а ЄСВ нараховується зверху й теж є витратою роботодавця.
            </p>
            <ActionForm action={createPayrollRun} submitLabel="Сформувати за місяць">
              <input type="hidden" name="period" value={current} />
            </ActionForm>
          </Card>

          <Card title="Новий працівник">
            <ActionForm action={createEmployee} submitLabel="Додати">
              <Field label="ПІБ">
                <input name="full_name" required className={inputClass} />
              </Field>
              <Field label="Посада">
                <input name="position" className={inputClass} placeholder="Оператор лінії" />
              </Field>
              <Field label="Підрозділ" hint="Визначає, на який рахунок ляжуть витрати">
                <select name="department" required className={inputClass} defaultValue="production">
                  {Object.entries(DEPARTMENTS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Оклад за місяць">
                <input name="monthly_salary" type="number" step="0.01" min="0" required className={inputClass} />
              </Field>
              <Field label="Дата прийому">
                <input name="hired_on" type="date" className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
