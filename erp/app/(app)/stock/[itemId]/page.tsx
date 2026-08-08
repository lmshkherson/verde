import { notFound } from 'next/navigation';
import { Badge, Card, Cell, Empty, LinkButton, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { fmtDate, fmtMoney, fmtQty, ITEM_KINDS, MOVE_TYPES, unitLabel } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function ItemCardPage({ params }: { params: Promise<{ itemId: string }> }) {
  const session = await requireRole('warehouse', 'production', 'sales');
  const { itemId } = await params;
  const showMoney = session.role !== 'warehouse';

  const item = await queryOne<{
    id: string;
    sku: string;
    name: string;
    kind: string;
    unit: string;
    min_stock: number;
    qty: number;
    avg_cost: number;
    value: number;
  }>(
    `select i.id, i.sku, i.name, i.kind, i.unit, i.min_stock,
            coalesce(s.qty, 0) as qty, coalesce(s.avg_cost, 0) as avg_cost, coalesce(s.value, 0) as value
       from items i left join v_item_stock s on s.item_id = i.id
      where i.id = $1`,
    [itemId],
  );
  if (!item) notFound();

  const [batches, moves] = await Promise.all([
    query<{
      batch_id: string;
      code: string;
      expires_on: string | null;
      qty: number;
      value: number;
      warehouse: string;
    }>(
      `select sb.batch_id, b.code, b.expires_on, sb.qty, sb.value, w.name as warehouse
         from v_stock_batches sb
         join batches b on b.id = sb.batch_id
         join warehouses w on w.id = sb.warehouse_id
        where sb.item_id = $1
        order by b.expires_on nulls last, b.created_at`,
      [itemId],
    ),
    query<{
      id: number;
      moved_at: string;
      qty: number;
      unit_cost: number;
      move_type: string;
      note: string | null;
      batch_code: string | null;
      user_name: string | null;
    }>(
      `select m.id, m.moved_at, m.qty, m.unit_cost, m.move_type, m.note,
              b.code as batch_code, u.full_name as user_name
         from stock_moves m
         left join batches b on b.id = m.batch_id
         left join app_users u on u.id = m.user_id
        where m.item_id = $1
        order by m.moved_at desc, m.id desc
        limit 50`,
      [itemId],
    ),
  ]);

  return (
    <>
      <PageHeader
        title={item.name}
        subtitle={`${item.sku} · ${ITEM_KINDS[item.kind]}`}
        action={<LinkButton href="/stock">← До залишків</LinkButton>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Залишок"
          value={fmtQty(item.qty, unitLabel(item.unit))}
          tone={item.min_stock > 0 && item.qty < item.min_stock ? 'danger' : 'default'}
          hint={item.min_stock > 0 ? `мінімум ${fmtQty(item.min_stock)}` : undefined}
        />
        <Stat label="Партій на складі" value={String(batches.length)} />
        {showMoney && <Stat label="Собівартість" value={fmtMoney(item.avg_cost)} hint="середньозважена" />}
        {showMoney && <Stat label="Вартість запасу" value={fmtMoney(item.value)} />}
      </div>

      <div className="grid gap-4">
        <Card title="Партії">
          {batches.length === 0 ? (
            <Empty>Залишків немає</Empty>
          ) : (
            <Table head={['Партія', 'Склад', 'Придатна до', 'Залишок', ...(showMoney ? ['Вартість'] : [])]}>
              {batches.map((b) => {
                const days = b.expires_on
                  ? Math.round((new Date(b.expires_on).getTime() - Date.now()) / 86_400_000)
                  : null;
                return (
                  <Row key={b.batch_id}>
                    <Cell className="font-mono text-xs">{b.code}</Cell>
                    <Cell>{b.warehouse}</Cell>
                    <Cell align="right">
                      {b.expires_on ? (
                        <>
                          <div>{fmtDate(b.expires_on)}</div>
                          {days !== null && days < 60 && (
                            <Badge tone={days < 14 ? 'red' : 'amber'}>{days} дн.</Badge>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </Cell>
                    <Cell align="right" className="font-semibold">
                      {fmtQty(b.qty, unitLabel(item.unit))}
                    </Cell>
                    {showMoney && <Cell align="right">{fmtMoney(b.value)}</Cell>}
                  </Row>
                );
              })}
            </Table>
          )}
        </Card>

        <Card title="Останні рухи">
          {moves.length === 0 ? (
            <Empty>Рухів ще не було</Empty>
          ) : (
            <Table head={['Дата', 'Операція', 'Партія', 'Кількість', ...(showMoney ? ['Ціна'] : [])]}>
              {moves.map((m) => (
                <Row key={m.id}>
                  <Cell>
                    <div>{fmtDate(m.moved_at)}</div>
                    <div className="text-xs text-emerald-800/50">{m.user_name ?? '—'}</div>
                  </Cell>
                  <Cell>
                    <div className="font-semibold">{MOVE_TYPES[m.move_type] ?? m.move_type}</div>
                    {m.note && <div className="text-xs text-emerald-800/50">{m.note}</div>}
                  </Cell>
                  <Cell className="font-mono text-xs">{m.batch_code ?? '—'}</Cell>
                  <Cell align="right" className={m.qty > 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-red-600'}>
                    {m.qty > 0 ? '+' : ''}
                    {fmtQty(m.qty, unitLabel(item.unit))}
                  </Cell>
                  {showMoney && <Cell align="right">{fmtMoney(m.unit_cost)}</Cell>}
                </Row>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
