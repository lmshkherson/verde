import Link from 'next/link';
import { openStocktake } from '@/app/actions/stocktake';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Cell, Empty, Field, inputClass, PageHeader, Row, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { fmtDate, fmtMoney } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = {
  draft: 'Відкрито',
  counting: 'Триває перерахунок',
  completed: 'Завершено',
  cancelled: 'Скасовано',
};

export default async function StocktakeListPage() {
  const session = await requireRole('warehouse', 'production');

  const [docs, warehouses] = await Promise.all([
    query<{
      id: string;
      number: string;
      counted_on: string;
      status: string;
      warehouse: string;
      lines: number;
      counted: number;
      with_diff: number;
      surplus_value: number;
      shortage_value: number;
    }>(
      `select s.id, s.number, s.counted_on, s.status, w.name as warehouse,
              g.lines, g.counted, g.with_diff, g.surplus_value, g.shortage_value
         from stocktakes s
         join warehouses w on w.id = s.warehouse_id
         join v_stocktake_summary g on g.stocktake_id = s.id
        where s.legal_entity_id = $1
        order by s.counted_on desc, s.number desc`,
      [session.eid],
    ),
    query<{ id: string; name: string }>(
      'select id, name from warehouses where is_active order by code',
    ),
  ]);

  return (
    <>
      <PageHeader
        title="Інвентаризація"
        subtitle="Опис, порівняльна відомість і коригування залишків"
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card title="Журнал описів">
          {docs.length === 0 ? (
            <Empty>Інвентаризацій ще не було</Empty>
          ) : (
            <Table head={['Опис', 'Склад', 'Пораховано', 'Розбіжності', 'Стан']}>
              {docs.map((d) => (
                <Row key={d.id}>
                  <Cell>
                    <Link
                      href={`/stocktake/${d.id}`}
                      className="font-semibold text-emerald-800 hover:underline"
                    >
                      {d.number}
                    </Link>
                    <div className="text-xs text-emerald-800/50">{fmtDate(d.counted_on)}</div>
                  </Cell>
                  <Cell>{d.warehouse}</Cell>
                  <Cell align="right">
                    <span className={d.counted < d.lines ? 'font-semibold text-amber-600' : ''}>
                      {d.counted} / {d.lines}
                    </span>
                  </Cell>
                  <Cell align="right">
                    {d.with_diff > 0 ? (
                      <>
                        <div className="font-semibold text-amber-700">{d.with_diff} позицій</div>
                        <div className="text-xs text-emerald-800/60">
                          +{fmtMoney(d.surplus_value)} / −{fmtMoney(d.shortage_value)}
                        </div>
                      </>
                    ) : (
                      '—'
                    )}
                  </Cell>
                  <Cell>
                    <Badge
                      tone={
                        d.status === 'completed'
                          ? 'green'
                          : d.status === 'cancelled'
                            ? 'gray'
                            : 'amber'
                      }
                    >
                      {STATUS[d.status]}
                    </Badge>
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Новий опис">
          <p className="mb-3 text-sm text-emerald-800/70">
            Обліковий залишок фіксується зрізом на момент відкриття: опис — це фотографія складу на
            дату, і поки комісія рахує, цифра в бланку не має стрибати від нових рухів.
          </p>
          <ActionForm action={openStocktake} submitLabel="Відкрити опис">
            <Field label="Склад">
              <select name="warehouse_id" required className={inputClass} defaultValue="">
                <option value="" disabled>
                  Оберіть…
                </option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Дата">
              <input
                name="counted_on"
                type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
                className={inputClass}
              />
            </Field>
            <Field label="Голова комісії">
              <input name="chairman" className={inputClass} placeholder="Ковальчук О.М., директор" />
            </Field>
            <Field label="Члени комісії" hint="через кому">
              <input name="commission" className={inputClass} />
            </Field>
            <Field label="Матеріально відповідальна особа">
              <input name="responsible" className={inputClass} placeholder="Савченко П.І., комірник" />
            </Field>
            <Field label="Примітка">
              <input name="note" className={inputClass} />
            </Field>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
