import Link from 'next/link';
import { Card, Cell, Empty, LinkButton, PageHeader, Row, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { fmtMoney, fmtQty, MOVE_TYPES, unitLabel } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const dateTime = new Intl.DateTimeFormat('uk-UA', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export default async function StockMovesPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const session = await requireRole('warehouse', 'production', 'sales');
  const { type } = await searchParams;
  const showMoney = session.role !== 'warehouse';

  const moves = await query<{
    id: number;
    moved_at: string;
    qty: number;
    unit_cost: number;
    move_type: string;
    note: string | null;
    item_id: string;
    sku: string;
    name: string;
    unit: string;
    batch_code: string | null;
    warehouse: string;
    user_name: string | null;
  }>(
    `select m.id, m.moved_at, m.qty, m.unit_cost, m.move_type, m.note,
            i.id as item_id, i.sku, i.name, i.unit,
            b.code as batch_code, w.name as warehouse, u.full_name as user_name
       from stock_moves m
       join items i on i.id = m.item_id
       join warehouses w on w.id = m.warehouse_id
       left join batches b on b.id = m.batch_id
       left join app_users u on u.id = m.user_id
      where ($1::text is null or m.move_type = $1)
        and m.legal_entity_id = $2
      order by m.moved_at desc, m.id desc
      limit 200`,
    [type ?? null, session.eid],
  );

  return (
    <>
      <PageHeader
        title="Журнал рухів"
        subtitle="Кожен запис — це документ. Залишки — лише сума цих записів"
        action={<LinkButton href="/stock">← До залишків</LinkButton>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/stock/moves"
          className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
            !type ? 'bg-emerald-700 text-white' : 'border border-emerald-900/15 bg-white text-emerald-900'
          }`}
        >
          Усі
        </Link>
        {Object.entries(MOVE_TYPES).map(([key, label]) => (
          <Link
            key={key}
            href={`/stock/moves?type=${key}`}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
              type === key
                ? 'bg-emerald-700 text-white'
                : 'border border-emerald-900/15 bg-white text-emerald-900'
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      <Card>
        {moves.length === 0 ? (
          <Empty>Рухів немає</Empty>
        ) : (
          <Table
            head={['Коли', 'Позиція', 'Операція', 'Склад', 'Кількість', ...(showMoney ? ['Сума'] : [])]}
          >
            {moves.map((m) => (
              <Row key={m.id}>
                <Cell>
                  <div className="whitespace-nowrap">{dateTime.format(new Date(m.moved_at))}</div>
                  <div className="text-xs text-emerald-800/50">{m.user_name ?? '—'}</div>
                </Cell>
                <Cell>
                  <Link href={`/stock/${m.item_id}`} className="font-semibold text-emerald-800 hover:underline">
                    {m.name}
                  </Link>
                  <div className="font-mono text-xs text-emerald-800/50">{m.batch_code ?? m.sku}</div>
                </Cell>
                <Cell>
                  <div>{MOVE_TYPES[m.move_type] ?? m.move_type}</div>
                  {m.note && <div className="text-xs text-emerald-800/50">{m.note}</div>}
                </Cell>
                <Cell>{m.warehouse}</Cell>
                <Cell
                  align="right"
                  className={m.qty > 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-red-600'}
                >
                  {m.qty > 0 ? '+' : ''}
                  {fmtQty(m.qty, unitLabel(m.unit))}
                </Cell>
                {showMoney && <Cell align="right">{fmtMoney(Math.abs(m.qty) * m.unit_cost)}</Cell>}
              </Row>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
