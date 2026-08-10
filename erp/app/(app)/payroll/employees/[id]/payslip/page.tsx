import { notFound } from 'next/navigation';
import { PrintButton } from '@/components/print-button';
import { LinkButton, PageHeader } from '@/components/ui';
import { queryOne } from '@/lib/db';
import { fmtDate, fmtMoney, isoDay } from '@/lib/format';
import { requireSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Розрахунковий листок — ст. 110 КЗпП: роботодавець повідомляє працівникові
 * складові зарплати, розміри й підстави утримань, суму до виплати.
 *
 * Доступ навмисно ширший за «лише власник»: листок відкриває будь-хто, хто
 * знає адресу, але це той самий власник чи бухгалтер, які й так бачать
 * зарплату. Ролі без розділу «Зарплата» сюди не потраплять з меню.
 */
export default async function PayslipPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await requireSession();
  if (session.role !== 'owner') notFound();

  const { id } = await params;
  const { period } = await searchParams;
  if (!period || !/^\d{4}-\d{2}$/.test(period)) notFound();

  const line = await queryOne<{
    full_name: string;
    position: string | null;
    tax_id: string | null;
    entity_name: string;
    period: string | Date;
    status: string;
    paid_on: string | Date | null;
    gross: number;
    base_salary: number;
    vacation_pay: number;
    sick_pay: number;
    pdfo: number;
    military: number;
    esv: number;
    net: number;
    absence_days: number;
    fund_amount: number;
  }>(
    `select e.full_name, e.position, e.tax_id, le.name as entity_name,
            r.period, r.status, r.paid_on,
            l.gross, l.base_salary, l.vacation_pay, l.sick_pay,
            l.pdfo, l.military, l.esv, l.net, l.absence_days,
            coalesce((
              select sum(a.fund_amount) from employee_absences a
               where a.employee_id = e.id and a.kind = 'sick'
                 and a.date_from < (r.period + interval '1 month')
                 and a.date_to >= r.period
            ), 0) as fund_amount
       from payroll_lines l
       join payroll_runs r on r.id = l.run_id
       join employees e on e.id = l.employee_id
       join legal_entities le on le.id = r.legal_entity_id
      where l.employee_id = $1 and r.period = $2::date
        and r.legal_entity_id = $3`,
    [id, `${period}-01`, session.eid],
  );
  if (!line) notFound();

  const rows: [string, number][] = [
    ['Оклад за відпрацьований час', line.base_salary],
    ['Відпускні', line.vacation_pay],
    ['Лікарняні (за рахунок підприємства, перші 5 днів)', line.sick_pay],
  ];
  const deductions: [string, number][] = [
    ['Податок на доходи фізичних осіб (18%)', line.pdfo],
    ['Військовий збір (5%)', line.military],
  ];

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="Розрахунковий листок"
          subtitle={`${line.full_name} · ${fmtDate(line.period)}`}
          action={
            <div className="flex gap-2">
              <LinkButton href={`/payroll/employees/${id}`}>← До картки</LinkButton>
              <PrintButton label="Друк" />
            </div>
          }
        />
        <p className="max-w-xl text-sm text-emerald-800/70">
          Нижче — друкована форма. Скористайтеся кнопкою «Друк», щоб видати працівникові.
        </p>
      </div>

      <div className="mx-auto w-full max-w-[160mm] bg-white p-[10mm] text-black print:block">
        <h1 className="mb-1 text-center text-base font-bold uppercase">Розрахунковий листок</h1>
        <p className="mb-4 text-center text-[12px]">
          за {fmtDate(line.period)} — {line.status === 'paid' ? 'виплачено' : 'нараховано'}
          {line.paid_on ? ` ${fmtDate(line.paid_on)}` : ''}
        </p>

        <div className="mb-4 space-y-1 text-[11px]">
          <div>
            <span className="text-black/60">Підприємство: </span>
            {line.entity_name}
          </div>
          <div>
            <span className="text-black/60">Працівник: </span>
            {line.full_name}
            {line.position ? `, ${line.position}` : ''}
            {line.tax_id ? ` · РНОКПП ${line.tax_id}` : ''}
          </div>
        </div>

        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="border border-black px-2 py-1 text-left font-semibold">Нараховано</th>
              <th className="border border-black px-2 py-1 text-right font-semibold">Сума</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter(([, v]) => Number(v) > 0)
              .map(([label, value]) => (
                <tr key={label}>
                  <td className="border border-black px-2 py-1">{label}</td>
                  <td className="border border-black px-2 py-1 text-right tabular-nums">
                    {fmtMoney(value)}
                  </td>
                </tr>
              ))}
            <tr className="font-semibold">
              <td className="border border-black px-2 py-1">Разом нараховано</td>
              <td className="border border-black px-2 py-1 text-right tabular-nums">
                {fmtMoney(line.gross)}
              </td>
            </tr>
          </tbody>
        </table>

        <table className="mt-3 w-full border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="border border-black px-2 py-1 text-left font-semibold">Утримано</th>
              <th className="border border-black px-2 py-1 text-right font-semibold">Сума</th>
            </tr>
          </thead>
          <tbody>
            {deductions.map(([label, value]) => (
              <tr key={label}>
                <td className="border border-black px-2 py-1">{label}</td>
                <td className="border border-black px-2 py-1 text-right tabular-nums">
                  {fmtMoney(value)}
                </td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="border border-black px-2 py-1">Разом утримано</td>
              <td className="border border-black px-2 py-1 text-right tabular-nums">
                {fmtMoney(Number(line.pdfo) + Number(line.military))}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mt-4 border border-black px-3 py-2 text-[13px] font-bold">
          До виплати: {fmtMoney(line.net)}
        </div>

        <div className="mt-3 space-y-1 text-[10px] text-black/70">
          {line.absence_days > 0 && <div>Днів відсутності в періоді: {line.absence_days}.</div>}
          {Number(line.fund_amount) > 0 && (
            <div>
              Допомога з тимчасової непрацездатності з 6-го дня — {fmtMoney(line.fund_amount)} —
              виплачується Пенсійним фондом України напряму й у цю відомість не входить.
            </div>
          )}
          <div>
            Єдиний соціальний внесок ({fmtMoney(line.esv)}) сплачує роботодавець — із зарплати він
            не утримується.
          </div>
        </div>

        <div className="mt-8 flex justify-between text-[10px]">
          <div>
            Видав: ___________________
            <div className="mt-1 text-black/60">{isoDay(new Date())}</div>
          </div>
          <div>Отримав: ___________________</div>
        </div>
      </div>
    </>
  );
}
