import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  createAbsence,
  deleteAbsence,
  issueProperty,
  returnProperty,
  updateEmployee,
} from '@/app/actions/hr';
import { ActionForm } from '@/components/action-form';
import {
  Alert,
  Badge,
  Card,
  Cell,
  Empty,
  Field,
  LinkButton,
  PageHeader,
  Row,
  Stat,
  Table,
  inputClass,
} from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { fmtDate, fmtMoney, isoDay } from '@/lib/format';
import { ABSENCE_KINDS, PROPERTY_KINDS, sickPercent } from '@/lib/hr';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const DEPARTMENTS: Record<string, string> = {
  production: 'Виробництво',
  admin: 'Адміністрація',
  sales: 'Продажі',
};

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole();
  const { id } = await params;

  const emp = await queryOne<{
    id: string;
    full_name: string;
    position: string | null;
    department: string;
    monthly_salary: number;
    hired_on: string | Date | null;
    dismissed_on: string | Date | null;
    cost_behavior: string;
    note: string | null;
    tax_id: string | null;
    birth_date: string | Date | null;
    id_document: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    vacation_days_per_year: number;
    insurance_years: number;
    is_active: boolean;
    entitled_days: number | null;
    used_days: number | null;
  }>(
    `select e.*, b.entitled_days, b.used_days
       from employees e
       left join v_vacation_balance b on b.employee_id = e.id
      where e.id = $1 and e.legal_entity_id = $2`,
    [id, session.eid],
  );
  if (!emp) notFound();

  const [absences, property, payHistory] = await Promise.all([
    query<{
      id: string;
      kind: string;
      date_from: string | Date;
      date_to: string | Date;
      calendar_days: number;
      avg_daily: number;
      amount: number;
      fund_amount: number;
      note: string | null;
    }>(
      `select id, kind, date_from, date_to, calendar_days, avg_daily, amount, fund_amount, note
         from employee_absences where employee_id = $1
        order by date_from desc limit 30`,
      [id],
    ),
    query<{
      id: string;
      kind: string;
      name: string;
      issued_on: string | Date;
      returned_on: string | Date | null;
      note: string | null;
    }>(
      `select id, kind, name, issued_on, returned_on, note
         from employee_property where employee_id = $1
        order by returned_on nulls first, issued_on desc`,
      [id],
    ),
    query<{
      period: string | Date;
      status: string;
      gross: number;
      base_salary: number;
      vacation_pay: number;
      sick_pay: number;
      net: number;
    }>(
      `select r.period, r.status, l.gross, l.base_salary, l.vacation_pay, l.sick_pay, l.net
         from payroll_lines l join payroll_runs r on r.id = l.run_id
        where l.employee_id = $1
        order by r.period desc limit 12`,
      [id],
    ),
  ]);

  const remaining =
    emp.entitled_days !== null ? Number(emp.entitled_days) - Number(emp.used_days ?? 0) : null;
  const notReturned = property.filter((p) => !p.returned_on).length;

  return (
    <>
      <PageHeader
        title={emp.full_name}
        subtitle={`${emp.position ?? 'посада не вказана'} · ${DEPARTMENTS[emp.department]}`}
        action={
          <div className="flex items-center gap-2">
            {!emp.is_active && <Badge tone="gray">Звільнений</Badge>}
            <LinkButton href="/payroll">← До зарплати</LinkButton>
          </div>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Оклад" value={fmtMoney(emp.monthly_salary)} />
        <Stat
          label="Залишок відпустки"
          value={remaining !== null ? `${remaining} дн.` : '—'}
          hint={
            emp.entitled_days !== null
              ? `належить ${emp.entitled_days}, використано ${emp.used_days}`
              : 'вкажіть дату приймання'
          }
          tone={remaining !== null && remaining < 0 ? 'warn' : 'default'}
        />
        <Stat
          label="Лікарняні"
          value={`${sickPercent(emp.insurance_years)}%`}
          hint={`страховий стаж ${emp.insurance_years} р.`}
        />
        <Stat
          label="На руках майна"
          value={String(notReturned)}
          hint="не повернуто"
          tone={notReturned > 0 && !emp.is_active ? 'danger' : 'default'}
        />
      </div>

      {!emp.is_active && notReturned > 0 && (
        <div className="mb-4">
          <Alert tone="red">
            Працівник звільнений, але за ним лишається невіддане майно — перегляньте журнал нижче.
          </Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card title="Кадрова картка">
            <ActionForm action={updateEmployee} submitLabel="Зберегти картку">
              <input type="hidden" name="employee_id" value={emp.id} />
              <Field label="ПІБ">
                <input name="full_name" required defaultValue={emp.full_name} className={inputClass} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Посада">
                  <input name="position" defaultValue={emp.position ?? ''} className={inputClass} />
                </Field>
                <Field label="Підрозділ">
                  <select name="department" defaultValue={emp.department} className={inputClass}>
                    {Object.entries(DEPARTMENTS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Оклад">
                  <input
                    name="monthly_salary"
                    type="number"
                    step="0.01"
                    defaultValue={emp.monthly_salary}
                    className={inputClass}
                  />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="РНОКПП">
                  <input name="tax_id" defaultValue={emp.tax_id ?? ''} className={inputClass} />
                </Field>
                <Field label="Дата народження">
                  <input
                    name="birth_date"
                    type="date"
                    defaultValue={isoDay(emp.birth_date) ?? ''}
                    className={inputClass}
                  />
                </Field>
                <Field label="Паспорт / ID-картка">
                  <input name="id_document" defaultValue={emp.id_document ?? ''} className={inputClass} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Телефон">
                  <input name="phone" defaultValue={emp.phone ?? ''} className={inputClass} />
                </Field>
                <Field label="Email">
                  <input name="email" defaultValue={emp.email ?? ''} className={inputClass} />
                </Field>
              </div>
              <Field label="Адреса">
                <input name="address" defaultValue={emp.address ?? ''} className={inputClass} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Прийнятий">
                  <input
                    name="hired_on"
                    type="date"
                    defaultValue={isoDay(emp.hired_on) ?? ''}
                    className={inputClass}
                  />
                </Field>
                <Field label="Звільнений" hint="заповнення деактивує">
                  <input
                    name="dismissed_on"
                    type="date"
                    defaultValue={isoDay(emp.dismissed_on) ?? ''}
                    className={inputClass}
                  />
                </Field>
                <Field label="Відпустка, дн./рік">
                  <input
                    name="vacation_days_per_year"
                    type="number"
                    defaultValue={emp.vacation_days_per_year}
                    className={inputClass}
                  />
                </Field>
                <Field label="Страховий стаж, р.">
                  <input
                    name="insurance_years"
                    type="number"
                    defaultValue={emp.insurance_years}
                    className={inputClass}
                  />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Поведінка витрати" hint="для управлінського обліку">
                  <select name="cost_behavior" defaultValue={emp.cost_behavior} className={inputClass}>
                    <option value="variable">Змінна</option>
                    <option value="fixed">Постійна</option>
                  </select>
                </Field>
                <Field label="Примітка">
                  <input name="note" defaultValue={emp.note ?? ''} className={inputClass} />
                </Field>
              </div>
            </ActionForm>
          </Card>

          <Card title="Відсутності">
            {absences.length === 0 ? (
              <Empty>Відпусток і лікарняних ще не було</Empty>
            ) : (
              <Table head={['Вид', 'Період', 'Днів', 'Нараховано', '']}>
                {absences.map((a) => (
                  <Row key={a.id}>
                    <Cell>
                      <Badge
                        tone={a.kind === 'vacation' ? 'green' : a.kind === 'sick' ? 'amber' : 'gray'}
                      >
                        {ABSENCE_KINDS[a.kind]}
                      </Badge>
                      {a.note && <div className="mt-1 text-xs text-emerald-800/50">{a.note}</div>}
                    </Cell>
                    <Cell>
                      {fmtDate(a.date_from)} — {fmtDate(a.date_to)}
                    </Cell>
                    <Cell align="right">{a.calendar_days}</Cell>
                    <Cell align="right">
                      {a.kind === 'unpaid' ? (
                        '—'
                      ) : (
                        <>
                          <div className="font-semibold">{fmtMoney(a.amount)}</div>
                          {Number(a.fund_amount) > 0 && (
                            <div className="text-xs text-emerald-800/50">
                              + {fmtMoney(a.fund_amount)} від ПФУ
                            </div>
                          )}
                        </>
                      )}
                    </Cell>
                    <Cell align="right">
                      <ActionForm action={deleteAbsence} submitLabel="Видалити" variant="ghost" hideSuccess>
                        <input type="hidden" name="employee_id" value={emp.id} />
                        <input type="hidden" name="absence_id" value={a.id} />
                      </ActionForm>
                    </Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Card>

          <Card title="Видане майно й документи">
            {property.length === 0 ? (
              <Empty>Нічого не видавалося</Empty>
            ) : (
              <Table head={['Що', 'Видано', 'Повернуто', '']}>
                {property.map((p) => (
                  <Row key={p.id}>
                    <Cell>
                      <div className="font-semibold">{p.name}</div>
                      <div className="text-xs text-emerald-800/50">
                        {PROPERTY_KINDS[p.kind]}
                        {p.note ? ` · ${p.note}` : ''}
                      </div>
                    </Cell>
                    <Cell>{fmtDate(p.issued_on)}</Cell>
                    <Cell>
                      {p.returned_on ? (
                        fmtDate(p.returned_on)
                      ) : (
                        <Badge tone="amber">на руках</Badge>
                      )}
                    </Cell>
                    <Cell align="right">
                      {!p.returned_on && (
                        <form action={returnProperty}>
                          <input type="hidden" name="employee_id" value={emp.id} />
                          <input type="hidden" name="property_id" value={p.id} />
                          <button className="text-xs font-semibold text-emerald-700 hover:underline">
                            Повернуто
                          </button>
                        </form>
                      )}
                    </Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Card>

          <Card title="Історія нарахувань">
            {payHistory.length === 0 ? (
              <Empty>Нарахувань ще не було</Empty>
            ) : (
              <Table head={['Період', 'Оклад', 'Відпускні', 'Лікарняні', 'Разом', 'На руки']}>
                {payHistory.map((h, i) => (
                  <Row key={i}>
                    <Cell>
                      <Link
                        href={`/payroll/employees/${emp.id}/payslip?period=${(isoDay(h.period) ?? '').slice(0, 7)}`}
                        className="font-semibold text-emerald-700 hover:underline"
                        title="Розрахунковий листок"
                      >
                        {fmtDate(h.period)}
                      </Link>
                    </Cell>
                    <Cell align="right">{fmtMoney(h.base_salary)}</Cell>
                    <Cell align="right">
                      {Number(h.vacation_pay) > 0 ? fmtMoney(h.vacation_pay) : '—'}
                    </Cell>
                    <Cell align="right">{Number(h.sick_pay) > 0 ? fmtMoney(h.sick_pay) : '—'}</Cell>
                    <Cell align="right" className="font-semibold">
                      {fmtMoney(h.gross)}
                    </Cell>
                    <Cell align="right">{fmtMoney(h.net)}</Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Оформити відсутність">
            <p className="mb-3 text-sm text-emerald-800/70">
              Середньоденна фіксується на момент оформлення: заробіток за останні 12 місяців ÷ 365.
              Лікарняний: перші 5 днів платить підприємство ({sickPercent(emp.insurance_years)}% за
              стажем), з шостого — ПФУ напряму. Нарахування підтягнеться у відомість того місяця,
              на який припадають дні.
            </p>
            <ActionForm action={createAbsence} submitLabel="Оформити">
              <input type="hidden" name="employee_id" value={emp.id} />
              <Field label="Вид">
                <select name="kind" className={inputClass} defaultValue="vacation">
                  {Object.entries(ABSENCE_KINDS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="З">
                  <input name="date_from" type="date" required className={inputClass} />
                </Field>
                <Field label="По (включно)">
                  <input name="date_to" type="date" required className={inputClass} />
                </Field>
              </div>
              <Field label="Підстава / примітка">
                <input name="note" className={inputClass} placeholder="Заява від 03.08, наказ № 12-В" />
              </Field>
            </ActionForm>
          </Card>

          <Card title="Видати майно чи документ">
            <ActionForm action={issueProperty} submitLabel="Записати" variant="ghost">
              <input type="hidden" name="employee_id" value={emp.id} />
              <Field label="Вид">
                <select name="kind" className={inputClass} defaultValue="equipment">
                  {Object.entries(PROPERTY_KINDS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Що саме">
                <input name="name" className={inputClass} placeholder="Ноутбук Lenovo, інв. № 0012" required />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Дата видачі">
                  <input
                    name="issued_on"
                    type="date"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Примітка">
                  <input name="note" className={inputClass} />
                </Field>
              </div>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
