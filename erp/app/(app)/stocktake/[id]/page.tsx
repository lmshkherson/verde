import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cancelStocktake, completeStocktake, countLine } from '@/app/actions/stocktake';
import { ActionForm } from '@/components/action-form';
import { PrintButton } from '@/components/print-button';
import {
  Alert,
  Badge,
  Button,
  Card,
  Cell,
  Empty,
  LinkButton,
  PageHeader,
  Row,
  Stat,
  Table,
  inputClass,
} from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { fmtDate, fmtMoney, fmtQty, unitLabel } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = {
  draft: 'Відкрито',
  counting: 'Триває перерахунок',
  completed: 'Завершено',
  cancelled: 'Скасовано',
};

export default async function StocktakePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole('warehouse', 'production');
  const { id } = await params;

  const doc = await queryOne<{
    id: string;
    number: string;
    counted_on: string;
    status: string;
    warehouse: string;
    warehouse_address: string | null;
    chairman: string | null;
    commission: string | null;
    responsible: string | null;
    note: string | null;
    entity_name: string;
    lines: number;
    counted: number;
    with_diff: number;
    surplus_value: number;
    shortage_value: number;
  }>(
    `select s.id, s.number, s.counted_on, s.status, w.name as warehouse, w.address as warehouse_address,
            s.chairman, s.commission, s.responsible, s.note, e.name as entity_name,
            g.lines, g.counted, g.with_diff, g.surplus_value, g.shortage_value
       from stocktakes s
       join warehouses w on w.id = s.warehouse_id
       join legal_entities e on e.id = s.legal_entity_id
       join v_stocktake_summary g on g.stocktake_id = s.id
      where s.id = $1 and s.legal_entity_id = $2`,
    [id, session.eid],
  );
  if (!doc) notFound();

  const lines = await query<{
    id: string;
    name: string;
    sku: string;
    unit: string;
    batch_code: string | null;
    book_qty: number;
    counted_qty: number | null;
    unit_cost: number;
    diff_qty: number;
    diff_value: number;
    note: string | null;
  }>(
    `select l.id, i.name, i.sku, i.unit, b.code as batch_code,
            l.book_qty, l.counted_qty, l.unit_cost, l.diff_qty, l.diff_value, l.note
       from v_stocktake_lines l
       join items i on i.id = l.item_id
       left join batches b on b.id = l.batch_id
      where l.stocktake_id = $1
      order by i.name, b.code`,
    [id],
  );

  const open = doc.status === 'draft' || doc.status === 'counting';
  const diffs = lines.filter((l) => l.counted_qty !== null && Math.abs(Number(l.diff_qty)) > 0.0005);

  return (
    <>
      <div className="no-print">
        <PageHeader
          title={`Інвентаризаційний опис ${doc.number}`}
          subtitle={`${doc.warehouse} · ${fmtDate(doc.counted_on)}`}
          action={
            <div className="flex gap-2">
              <PrintButton label="Друк опису" />
              <LinkButton href={`/movements/${doc.id}`}>Дт/Кт</LinkButton>
              <LinkButton href="/stocktake">← До журналу</LinkButton>
            </div>
          }
        />

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Badge
            tone={doc.status === 'completed' ? 'green' : doc.status === 'cancelled' ? 'gray' : 'amber'}
          >
            {STATUS[doc.status]}
          </Badge>
          {doc.note && <span className="text-sm text-emerald-800/60">{doc.note}</span>}
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Пораховано"
            value={`${doc.counted} / ${doc.lines}`}
            tone={doc.counted < doc.lines ? 'warn' : 'good'}
          />
          <Stat label="Розбіжностей" value={String(doc.with_diff)} tone={doc.with_diff > 0 ? 'warn' : 'good'} />
          <Stat label="Надлишок" value={fmtMoney(doc.surplus_value)} tone="good" />
          <Stat label="Нестача" value={fmtMoney(doc.shortage_value)} tone={Number(doc.shortage_value) > 0 ? 'danger' : 'default'} />
        </div>

        {open && doc.counted < doc.lines && (
          <div className="mb-4">
            <Alert tone="amber">
              Порахували не все: {doc.lines - doc.counted} позицій без факту. Порожнє поле — це «ще
              не рахували», нуль — «на полиці порожньо». Непораховані рядки коригуватися не будуть.
            </Alert>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <Card title="Позиції">
            {lines.length === 0 ? (
              <Empty>На складі порожньо — інвентаризувати нічого</Empty>
            ) : (
              <Table head={['Позиція', 'Партія', 'Облік', 'Факт', 'Розбіжність', '']}>
                {lines.map((l) => {
                  const diff = Number(l.diff_qty);
                  const counted = l.counted_qty !== null;
                  return (
                    <Row key={l.id}>
                      <Cell>
                        <div className="font-semibold">{l.name}</div>
                        <div className="text-xs text-emerald-800/50">{l.sku}</div>
                      </Cell>
                      <Cell className="font-mono text-xs">{l.batch_code ?? '—'}</Cell>
                      <Cell align="right">{fmtQty(l.book_qty, unitLabel(l.unit))}</Cell>
                      <Cell align="right" className="font-semibold">
                        {counted ? fmtQty(l.counted_qty, unitLabel(l.unit)) : '—'}
                      </Cell>
                      <Cell align="right">
                        {counted && Math.abs(diff) > 0.0005 ? (
                          <>
                            <span className={diff > 0 ? 'font-bold text-emerald-700' : 'font-bold text-red-600'}>
                              {diff > 0 ? '+' : ''}
                              {fmtQty(diff)}
                            </span>
                            <div className="text-xs text-emerald-800/60">
                              {fmtMoney(l.diff_value)}
                            </div>
                          </>
                        ) : counted ? (
                          <span className="text-emerald-700">збігається</span>
                        ) : (
                          '—'
                        )}
                      </Cell>
                      <Cell>
                        {open && (
                          <ActionForm action={countLine} submitLabel="→" hideSuccess>
                            <input type="hidden" name="stocktake_id" value={doc.id} />
                            <input type="hidden" name="line_id" value={l.id} />
                            <input
                              name="counted_qty"
                              type="number"
                              step="0.001"
                              min="0"
                              defaultValue={l.counted_qty ?? ''}
                              placeholder="факт"
                              className={`${inputClass} !min-h-9 w-24 text-sm`}
                            />
                            <input
                              name="note"
                              defaultValue={l.note ?? ''}
                              placeholder="причина"
                              className={`${inputClass} !min-h-9 w-32 text-sm`}
                            />
                          </ActionForm>
                        )}
                      </Cell>
                    </Row>
                  );
                })}
              </Table>
            )}
          </Card>

          <div className="space-y-4">
            {open && (
              <Card title="Завершити">
                <p className="mb-3 text-sm text-emerald-800/70">
                  Розбіжності стануть рухами коригування. Різниця береться від{' '}
                  <strong>поточного</strong> залишку, а не від зрізу: якщо поки рахували, по позиції
                  пройшло відвантаження, коригувати треба до того, що є зараз.
                </p>
                <ActionForm action={completeStocktake} submitLabel="Закрити опис">
                  <input type="hidden" name="stocktake_id" value={doc.id} />
                </ActionForm>
                <form action={cancelStocktake} className="mt-3">
                  <input type="hidden" name="stocktake_id" value={doc.id} />
                  <Button variant="ghost">Скасувати опис</Button>
                </form>
              </Card>
            )}

            {doc.status === 'completed' && (
              <Card title="Як це лягло в облік">
                <Table head={['Дебет', 'Кредит', 'Що це']}>
                  <Row>
                    <Cell className="font-mono font-semibold">201 / 204 / 26</Cell>
                    <Cell className="font-mono">719</Cell>
                    <Cell className="text-xs">надлишок — інший операційний дохід</Cell>
                  </Row>
                  <Row>
                    <Cell className="font-mono font-semibold">947</Cell>
                    <Cell className="font-mono">201 / 204 / 26</Cell>
                    <Cell className="text-xs">нестача — втрати від псування</Cell>
                  </Row>
                </Table>
                <p className="mt-3 text-sm text-emerald-800/70">
                  Проводки з&apos;являться після{' '}
                  <Link href="/accounting" className="underline">
                    перегенерації періоду
                  </Link>
                  .
                </p>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Друкований опис. Положення про інвентаризацію не нав'язує бланк
          небюджетним підприємствам, але обов'язкові реквізити мають бути:
          хто рахував, що саме, скільки за обліком і скільки фактично. */}
      <div className="mx-auto hidden w-full max-w-[210mm] bg-white p-[10mm] text-black print:block">
        <h1 className="mb-1 text-center text-base font-bold uppercase">
          Інвентаризаційний опис № {doc.number}
        </h1>
        <p className="mb-4 text-center text-[12px]">
          запасів на складі «{doc.warehouse}» станом на {fmtDate(doc.counted_on)}
        </p>

        <div className="mb-3 space-y-1 text-[11px]">
          <div>
            <span className="text-black/60">Підприємство: </span>
            {doc.entity_name}
          </div>
          {doc.warehouse_address && (
            <div>
              <span className="text-black/60">Місце проведення: </span>
              {doc.warehouse_address}
            </div>
          )}
          <div>
            <span className="text-black/60">Голова комісії: </span>
            {doc.chairman ?? '________________________'}
          </div>
          <div>
            <span className="text-black/60">Члени комісії: </span>
            {doc.commission ?? '________________________'}
          </div>
        </div>

        <p className="mb-3 text-[10px]">
          Розписка. До початку інвентаризації всі видаткові й прибуткові документи на запаси здані
          до бухгалтерії, і всі запаси, що надійшли на відповідальність, оприбутковані, а вибулі —
          списані.
        </p>

        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr>
              {['№', 'Найменування', 'Артикул', 'Партія', 'Од.', 'За обліком', 'Фактично', 'Різниця', 'Сума різниці'].map(
                (h) => (
                  <th key={h} className="border border-black px-1 py-0.5 text-center font-semibold">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id}>
                <td className="border border-black px-1 py-0.5 text-center">{i + 1}</td>
                <td className="border border-black px-1 py-0.5">{l.name}</td>
                <td className="border border-black px-1 py-0.5">{l.sku}</td>
                <td className="border border-black px-1 py-0.5">{l.batch_code ?? '—'}</td>
                <td className="border border-black px-1 py-0.5 text-center">{unitLabel(l.unit)}</td>
                <td className="border border-black px-1 py-0.5 text-right tabular-nums">
                  {fmtQty(l.book_qty)}
                </td>
                <td className="border border-black px-1 py-0.5 text-right tabular-nums">
                  {l.counted_qty !== null ? fmtQty(l.counted_qty) : ''}
                </td>
                <td className="border border-black px-1 py-0.5 text-right tabular-nums">
                  {l.counted_qty !== null && Math.abs(Number(l.diff_qty)) > 0.0005
                    ? fmtQty(l.diff_qty)
                    : ''}
                </td>
                <td className="border border-black px-1 py-0.5 text-right tabular-nums">
                  {l.counted_qty !== null && Math.abs(Number(l.diff_qty)) > 0.0005
                    ? fmtMoney(l.diff_value)
                    : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {diffs.length > 0 && (
          <>
            <h2 className="mt-5 text-[12px] font-bold uppercase">Порівняльна відомість</h2>
            <p className="mb-1 text-[10px] text-black/60">Лише позиції з розбіжностями</p>
            <table className="w-full border-collapse text-[10px]">
              <thead>
                <tr>
                  {['Найменування', 'Партія', 'Надлишок', 'Нестача', 'Сума', 'Пояснення'].map((h) => (
                    <th key={h} className="border border-black px-1 py-0.5 text-center font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {diffs.map((l) => (
                  <tr key={l.id}>
                    <td className="border border-black px-1 py-0.5">{l.name}</td>
                    <td className="border border-black px-1 py-0.5">{l.batch_code ?? '—'}</td>
                    <td className="border border-black px-1 py-0.5 text-right tabular-nums">
                      {Number(l.diff_qty) > 0 ? fmtQty(l.diff_qty) : ''}
                    </td>
                    <td className="border border-black px-1 py-0.5 text-right tabular-nums">
                      {Number(l.diff_qty) < 0 ? fmtQty(-Number(l.diff_qty)) : ''}
                    </td>
                    <td className="border border-black px-1 py-0.5 text-right tabular-nums">
                      {fmtMoney(l.diff_value)}
                    </td>
                    <td className="border border-black px-1 py-0.5">{l.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="mt-8 grid grid-cols-2 gap-10 text-[11px]">
          <div>
            <div className="font-semibold">Голова комісії</div>
            <div className="mt-7 border-b border-black" />
            <div className="mt-0.5 text-[9px] text-black/60">
              {doc.chairman ?? 'підпис, прізвище'}
            </div>
          </div>
          <div>
            <div className="font-semibold">Матеріально відповідальна особа</div>
            <div className="mt-7 border-b border-black" />
            <div className="mt-0.5 text-[9px] text-black/60">
              {doc.responsible ?? 'підпис, прізвище'}
            </div>
          </div>
        </div>

        <p className="mt-4 text-[10px]">
          Усі запаси, перелічені в описі, комісією перевірено в натурі в моїй присутності й
          прийнято на відповідальне зберігання. Претензій до комісії не маю.
        </p>
      </div>
    </>
  );
}
