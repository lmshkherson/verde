import Link from 'next/link';
import { Badge, Card, Cell, Empty, LinkButton, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { fmtMoney, fmtQty, ITEM_KINDS, unitLabel } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'finished', label: 'Готова продукція' },
  { key: 'raw', label: 'Сировина' },
  { key: 'packaging', label: 'Пакування' },
  { key: 'semi', label: 'Напівфабрикат' },
];

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const session = await requireRole('warehouse', 'production', 'sales');
  const { kind = 'finished' } = await searchParams;
  const showMoney = session.role !== 'warehouse';

  const rows = await query<{
    item_id: string;
    sku: string;
    name: string;
    unit: string;
    qty: number;
    reserved_qty: number;
    available_qty: number;
    avg_cost: number;
  }>(
    `select a.item_id, a.sku, a.name, a.unit, a.qty, a.reserved_qty, a.available_qty, a.avg_cost
       from v_item_available a
       join items i on i.id = a.item_id
      where a.kind = $1 and a.legal_entity_id = $2 and i.is_active
      order by a.name`,
    [kind, session.eid],
  );

  const totalValue = rows.reduce((sum, r) => sum + r.qty * r.avg_cost, 0);
  const positions = rows.filter((r) => r.qty > 0).length;

  return (
    <>
      <PageHeader
        title="Склад"
        subtitle="Залишки рахуються з журналу рухів — кожну цифру можна розкласти на документи"
        action={
          <div className="flex gap-2">
            <LinkButton href="/stock/moves">Журнал рухів</LinkButton>
            {(session.role === 'warehouse' || session.role === 'owner') && (
              <LinkButton href="/stock/operations" variant="primary">
                Операції
              </LinkButton>
            )}
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Позицій із залишком" value={String(positions)} hint={ITEM_KINDS[kind] ?? ''} />
        {showMoney && <Stat label="Вартість запасу" value={fmtMoney(totalValue)} hint="за собівартістю" />}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/stock?kind=${tab.key}`}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              kind === tab.key
                ? 'bg-emerald-700 text-white'
                : 'border border-emerald-900/15 bg-white text-emerald-900 hover:bg-emerald-50'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <Card>
        {rows.length === 0 ? (
          <Empty>У цій групі ще немає номенклатури</Empty>
        ) : (
          <Table
            head={
              showMoney
                ? ['Позиція', 'Залишок', 'Резерв', 'Доступно', 'Собівартість', 'Вартість']
                : ['Позиція', 'Залишок', 'Резерв', 'Доступно']
            }
          >
            {rows.map((r) => (
              <Row key={r.item_id}>
                <Cell>
                  <Link href={`/stock/${r.item_id}`} className="font-semibold text-emerald-800 hover:underline">
                    {r.name}
                  </Link>
                  <div className="text-xs text-emerald-800/50">{r.sku}</div>
                </Cell>
                <Cell align="right">{fmtQty(r.qty, unitLabel(r.unit))}</Cell>
                <Cell align="right">
                  {r.reserved_qty > 0 ? <Badge tone="amber">{fmtQty(r.reserved_qty)}</Badge> : '—'}
                </Cell>
                <Cell align="right" className="font-semibold">
                  {fmtQty(r.available_qty, unitLabel(r.unit))}
                </Cell>
                {showMoney && <Cell align="right">{fmtMoney(r.avg_cost)}</Cell>}
                {showMoney && <Cell align="right">{fmtMoney(r.qty * r.avg_cost)}</Cell>}
              </Row>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
