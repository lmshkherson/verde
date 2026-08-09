import Link from 'next/link';
import { Badge, Card, Cell, Empty, Field, inputClass, PageHeader, Row, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { fmtDate, fmtQty, unitLabel } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function TraceabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireRole('production', 'sales', 'warehouse');
  const q = (await searchParams).q?.trim() ?? '';

  // Шукаємо і за кодом партії, і за назвою чи артикулом позиції: у день
  // аварії відомо або одне, або інше, і вгадувати, що саме, не час.
  const batches = await query<{
    id: string;
    code: string;
    item_name: string;
    sku: string;
    unit: string;
    produced_on: string | null;
    expires_on: string | null;
    source: string;
    on_hand: number;
    shipped: number;
  }>(
    `select b.id, b.code, i.name as item_name, i.sku, i.unit,
            b.produced_on, b.expires_on, b.source,
            coalesce((select sum(m.qty) from stock_moves m
                       where m.batch_id = b.id and m.legal_entity_id = $2), 0) as on_hand,
            coalesce((select sum(-m.qty) from stock_moves m
                       where m.batch_id = b.id and m.move_type = 'sale_shipment'), 0) as shipped
       from batches b
       join items i on i.id = b.item_id
      where ($1 = '' or b.code ilike '%' || $1 || '%'
             or i.name ilike '%' || $1 || '%' or i.sku ilike '%' || $1 || '%')
      order by b.created_at desc
      limit 60`,
    [q, session.eid],
  );

  return (
    <>
      <PageHeader
        title="Простежуваність партій"
        subtitle="Крок назад — звідки взялося. Крок вперед — куди поїхало"
      />

      <div className="grid gap-4">
        <Card title="Пошук партії">
          <form method="get" className="max-w-xl">
            <Field label="Код партії, назва або артикул">
              <input
                name="q"
                defaultValue={q}
                className={inputClass}
                placeholder="ВС-ЗАК-2026-0001/RAW-FINIK або «Фісташка»"
                autoFocus
              />
            </Field>
          </form>
          <p className="mt-3 text-sm text-emerald-800/70">
            Знайшли партію — відкрийте її, і система покаже весь ланцюжок: від постачальника
            сировини через варки до клієнтів, яким поїхала готова продукція. Звідти ж оголошується
            відкликання.
          </p>
        </Card>

        <Card title={q ? `Знайдено: ${batches.length}` : 'Останні партії'}>
          {batches.length === 0 ? (
            <Empty>Нічого не знайшлося</Empty>
          ) : (
            <Table head={['Партія', 'Позиція', 'Джерело', 'Придатна до', 'Залишок', 'Відвантажено']}>
              {batches.map((b) => (
                <Row key={b.id}>
                  <Cell>
                    <Link
                      href={`/traceability/${b.id}`}
                      className="font-mono text-xs font-semibold text-emerald-800 hover:underline"
                    >
                      {b.code}
                    </Link>
                    {b.produced_on && (
                      <div className="text-xs text-emerald-800/50">від {fmtDate(b.produced_on)}</div>
                    )}
                  </Cell>
                  <Cell>
                    <div className="font-semibold">{b.item_name}</div>
                    <div className="text-xs text-emerald-800/50">{b.sku}</div>
                  </Cell>
                  <Cell>
                    <Badge tone={b.source === 'production' ? 'green' : 'gray'}>
                      {b.source === 'production'
                        ? 'Власна варка'
                        : b.source === 'purchase'
                          ? 'Від постачальника'
                          : 'Вхідний залишок'}
                    </Badge>
                  </Cell>
                  <Cell>{b.expires_on ? fmtDate(b.expires_on) : '—'}</Cell>
                  <Cell align="right">{fmtQty(b.on_hand, unitLabel(b.unit))}</Cell>
                  <Cell align="right">
                    {Number(b.shipped) > 0 ? (
                      <span className="font-semibold text-amber-700">
                        {fmtQty(b.shipped, unitLabel(b.unit))}
                      </span>
                    ) : (
                      '—'
                    )}
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
