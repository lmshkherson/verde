import { PrintButton } from '@/components/print-button';
import { LinkButton } from '@/components/ui';
import { amountInWords } from '@/lib/amount-words';
import { fmtDate, fmtNum } from '@/lib/format';
import type { ReconData } from '@/lib/reconciliation';

/**
 * Друкований акт звірки взаєморозрахунків. Один шаблон для клієнта і
 * постачальника: різниця лише в тому, хто кому винен, — її задає підпис
 * колонок і знак сальдо.
 */
export function ReconAct({
  data,
  from,
  to,
  ourName,
  ourEdrpou,
  ourDirector,
  ourDirectorPosition,
  theirName,
  theirEdrpou,
  /** Що означає додатне сальдо: «заборгованість на користь …». */
  positiveMeans,
  negativeMeans,
  backHref,
  periodFormAction,
}: {
  data: ReconData;
  from: string;
  to: string;
  ourName: string;
  ourEdrpou: string | null;
  ourDirector: string | null;
  ourDirectorPosition: string;
  theirName: string;
  theirEdrpou: string | null;
  positiveMeans: string;
  negativeMeans: string;
  backHref: string;
  periodFormAction: string;
}) {
  const saldoLabel = (v: number) =>
    Math.abs(v) < 0.005
      ? 'розрахунки закриті'
      : v > 0
        ? `${fmtNum(Math.abs(v))} грн — ${positiveMeans}`
        : `${fmtNum(Math.abs(v))} грн — ${negativeMeans}`;

  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <PrintButton label="Друк / зберегти PDF" />
        <LinkButton href={backHref}>← До картки</LinkButton>
        <form action={periodFormAction} className="flex items-center gap-2">
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="rounded-lg border border-emerald-900/15 bg-white px-2 py-1.5 text-sm"
          />
          <span className="text-sm text-emerald-800/60">—</span>
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="rounded-lg border border-emerald-900/15 bg-white px-2 py-1.5 text-sm"
          />
          <button className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white">
            Показати
          </button>
        </form>
      </div>

      {/* Аркуш A4: жорстка ширина в міліметрах, щоб екран і папір збігалися. */}
      <div className="mx-auto w-full max-w-[210mm] bg-white p-[12mm] text-black shadow-sm print:p-0 print:shadow-none">
        <h1 className="mb-1 text-center text-lg font-bold uppercase">
          Акт звірки взаєморозрахунків
        </h1>
        <p className="mb-5 text-center text-[13px]">
          за період з {fmtDate(from)} до {fmtDate(to)}
        </p>

        <p className="mb-4 text-[13px]">
          Ми, <span className="font-semibold">{ourName}</span>
          {ourEdrpou ? ` (код ЄДРПОУ ${ourEdrpou})` : ''}, з одного боку, та{' '}
          <span className="font-semibold">{theirName}</span>
          {theirEdrpou ? ` (код ЄДРПОУ ${theirEdrpou})` : ''}, з іншого боку, склали цей акт про
          те, що стан взаємних розрахунків за даними обліку є таким:
        </p>

        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              {['Дата', 'Документ / операція', 'Дебет, грн', 'Кредит, грн'].map((h) => (
                <th key={h} className="border border-black px-1.5 py-1 text-center font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-black px-1.5 py-1" colSpan={2}>
                <span className="font-semibold">Сальдо на {fmtDate(from)}</span>
              </td>
              <td className="border border-black px-1.5 py-1 text-right tabular-nums">
                {data.opening > 0.005 ? fmtNum(data.opening) : ''}
              </td>
              <td className="border border-black px-1.5 py-1 text-right tabular-nums">
                {data.opening < -0.005 ? fmtNum(-data.opening) : ''}
              </td>
            </tr>
            {data.rows.map((r, i) => (
              <tr key={i}>
                <td className="border border-black px-1.5 py-1 text-center">{fmtDate(r.day)}</td>
                <td className="border border-black px-1.5 py-1">{r.doc}</td>
                <td className="border border-black px-1.5 py-1 text-right tabular-nums">
                  {r.debit > 0.005 ? fmtNum(r.debit) : ''}
                </td>
                <td className="border border-black px-1.5 py-1 text-right tabular-nums">
                  {r.credit > 0.005 ? fmtNum(r.credit) : ''}
                </td>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr>
                <td className="border border-black px-1.5 py-2 text-center text-black/60" colSpan={4}>
                  Операцій за період не було
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="border border-black px-1.5 py-1 text-right font-semibold">
                Обороти за період
              </td>
              <td className="border border-black px-1.5 py-1 text-right font-semibold tabular-nums">
                {fmtNum(data.totalDebit)}
              </td>
              <td className="border border-black px-1.5 py-1 text-right font-semibold tabular-nums">
                {fmtNum(data.totalCredit)}
              </td>
            </tr>
            <tr>
              <td colSpan={2} className="border border-black px-1.5 py-1 text-right font-bold">
                Сальдо на {fmtDate(to)}
              </td>
              <td className="border border-black px-1.5 py-1 text-right font-bold tabular-nums">
                {data.closing > 0.005 ? fmtNum(data.closing) : ''}
              </td>
              <td className="border border-black px-1.5 py-1 text-right font-bold tabular-nums">
                {data.closing < -0.005 ? fmtNum(-data.closing) : ''}
              </td>
            </tr>
          </tfoot>
        </table>

        <p className="mt-3 text-[13px]">
          Станом на {fmtDate(to)}: <span className="font-semibold">{saldoLabel(data.closing)}</span>
          {Math.abs(data.closing) >= 0.005 && (
            <>
              {' '}
              (<span className="font-semibold">{amountInWords(Math.abs(data.closing))}</span>)
            </>
          )}
        </p>

        <div className="mt-10 grid grid-cols-2 gap-10 text-[12px]">
          <div>
            <div className="mb-1 font-semibold">{ourName}</div>
            <div className="mt-2">
              <span className="font-semibold">{ourDirectorPosition}</span>
              <div className="mt-6 border-b border-black" />
              <div className="mt-0.5 text-[10px] text-black/60">
                підпис · {ourDirector ?? 'прізвище та ініціали'}
              </div>
            </div>
            <div className="mt-5 text-[10px] text-black/60">М.П. (за наявності печатки)</div>
          </div>
          <div>
            <div className="mb-1 font-semibold">{theirName}</div>
            <div className="mt-2">
              <span className="font-semibold">Посада</span>
              <div className="mt-6 border-b border-black" />
              <div className="mt-0.5 text-[10px] text-black/60">підпис · прізвище та ініціали</div>
            </div>
            <div className="mt-5 text-[10px] text-black/60">М.П. (за наявності печатки)</div>
          </div>
        </div>
      </div>
    </>
  );
}
