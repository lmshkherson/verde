import Link from 'next/link';
import { Alert, Badge, Card, Cell, Empty, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { fmtDate, fmtMoney, fmtQty, unitLabel } from '@/lib/format';
import { requireSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const session = await requireSession();
  const { denied } = await searchParams;
  const showMoney = session.role === 'owner' || session.role === 'sales';

  const [totals, month, lowStock, expiring, openProduction, toShip, debtors] = await Promise.all([
    queryOne<{ raw_value: number; finished_value: number; finished_qty: number }>(`
      select
        coalesce(sum(value) filter (where kind in ('raw','packaging')), 0) as raw_value,
        coalesce(sum(value) filter (where kind = 'finished'), 0)           as finished_value,
        coalesce(sum(qty)   filter (where kind = 'finished'), 0)           as finished_qty
      from v_item_stock
    `),
    queryOne<{ revenue: number; cogs: number }>(`
      select
        (select coalesce(sum(sl.qty * l.unit_price), 0)
           from shipments s
           join shipment_lines sl on sl.shipment_id = s.id
           join sales_order_lines l on l.id = sl.so_line_id
          where s.shipped_on >= date_trunc('month', current_date)) as revenue,
        (select coalesce(sum(-m.qty * m.unit_cost), 0)
           from stock_moves m
           join shipments s on s.id = m.doc_id and m.doc_type = 'shipment'
          where m.move_type = 'sale_shipment'
            and s.shipped_on >= date_trunc('month', current_date))  as cogs
    `),
    query<{ sku: string; name: string; qty: number; min_stock: number; unit: string }>(
      'select sku, name, qty, min_stock, unit from v_low_stock order by qty / nullif(min_stock, 0) limit 6',
    ),
    query<{ sku: string; name: string; code: string; expires_on: string; days_left: number; qty: number; unit: string }>(`
      select sku, name, code, expires_on, days_left, qty, unit
        from v_expiring_batches
       where days_left <= (select expiry_alert_days from settings)
       order by days_left
       limit 6
    `),
    query<{ id: string; number: string; product: string; planned_qty: number; status: string; planned_for: string | null }>(`
      select po.id, po.number, i.name as product, po.planned_qty, po.status, po.planned_for
        from production_orders po join items i on i.id = po.product_item_id
       where po.status in ('planned','in_progress')
       order by po.planned_for nulls last, po.created_at
       limit 6
    `),
    query<{ id: string; number: string; customer_name: string; total_amount: number; ship_by: string | null }>(`
      select id, number, customer_name, total_amount, ship_by
        from v_sales_orders_full
       where status = 'confirmed'
       order by ship_by nulls last
       limit 6
    `),
    query<{ customer_id: string; name: string; balance_due: number }>(`
      select customer_id, name, balance_due from v_customer_balance
       where balance_due > 0.01 order by balance_due desc limit 6
    `),
  ]);

  const margin = (month?.revenue ?? 0) - (month?.cogs ?? 0);
  const marginPct = month?.revenue ? Math.round((margin / month.revenue) * 1000) / 10 : 0;

  return (
    <>
      <PageHeader
        title={`Вітаємо, ${session.name.split(' ')[0]}`}
        subtitle="Що відбувається на виробництві просто зараз"
      />

      {denied && (
        <div className="mb-4">
          <Alert tone="amber">Цей розділ недоступний для вашої ролі.</Alert>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Готова продукція" value={fmtQty(totals?.finished_qty, 'шт')} hint="на складі" />
        {showMoney && (
          <Stat label="Склад ГП" value={fmtMoney(totals?.finished_value)} hint="за собівартістю" />
        )}
        <Stat label="Сировина" value={fmtMoney(totals?.raw_value)} hint="за собівартістю" />
        {showMoney && (
          <Stat
            label="Маржа за місяць"
            value={fmtMoney(margin)}
            hint={`виручка ${fmtMoney(month?.revenue)} · ${marginPct}%`}
            tone={margin > 0 ? 'good' : 'default'}
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Нижче мінімального залишку">
          {lowStock.length === 0 ? (
            <Empty>Усе в нормі — дефіциту немає</Empty>
          ) : (
            <Table head={['Позиція', 'Залишок', 'Мінімум']}>
              {lowStock.map((r) => (
                <Row key={r.sku}>
                  <Cell>
                    <div className="font-semibold">{r.name}</div>
                    <div className="text-xs text-emerald-800/50">{r.sku}</div>
                  </Cell>
                  <Cell align="right">
                    <span className="font-semibold text-red-600">{fmtQty(r.qty, unitLabel(r.unit))}</span>
                  </Cell>
                  <Cell align="right">{fmtQty(r.min_stock, unitLabel(r.unit))}</Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Партії з коротким терміном">
          {expiring.length === 0 ? (
            <Empty>Нічого не горить</Empty>
          ) : (
            <Table head={['Партія', 'Придатна до', 'Залишок']}>
              {expiring.map((b) => (
                <Row key={`${b.sku}-${b.code}`}>
                  <Cell>
                    <div className="font-semibold">{b.name}</div>
                    <div className="text-xs text-emerald-800/50">{b.code}</div>
                  </Cell>
                  <Cell align="right">
                    <div>{fmtDate(b.expires_on)}</div>
                    <div className={`text-xs ${b.days_left < 14 ? 'text-red-600' : 'text-amber-600'}`}>
                      {b.days_left < 0 ? 'прострочено' : `${b.days_left} дн.`}
                    </div>
                  </Cell>
                  <Cell align="right">{fmtQty(b.qty, unitLabel(b.unit))}</Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Виробництво у роботі">
          {openProduction.length === 0 ? (
            <Empty>Відкритих варок немає</Empty>
          ) : (
            <Table head={['Замовлення', 'Продукт', 'План']}>
              {openProduction.map((p) => (
                <Row key={p.id}>
                  <Cell>
                    <Link href={`/production/${p.id}`} className="font-semibold text-emerald-700 hover:underline">
                      {p.number}
                    </Link>
                    <div className="text-xs text-emerald-800/50">{fmtDate(p.planned_for)}</div>
                  </Cell>
                  <Cell>
                    {p.product}
                    <div className="mt-0.5">
                      <Badge tone={p.status === 'in_progress' ? 'amber' : 'gray'}>
                        {p.status === 'in_progress' ? 'У роботі' : 'Заплановано'}
                      </Badge>
                    </div>
                  </Cell>
                  <Cell align="right">{fmtQty(p.planned_qty, 'шт')}</Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Чекають на відвантаження">
          {toShip.length === 0 ? (
            <Empty>Немає підтверджених замовлень</Empty>
          ) : (
            <Table head={['Замовлення', 'Клієнт', showMoney ? 'Сума' : 'Відвантажити до']}>
              {toShip.map((o) => (
                <Row key={o.id}>
                  <Cell>
                    <Link href={`/sales/${o.id}`} className="font-semibold text-emerald-700 hover:underline">
                      {o.number}
                    </Link>
                  </Cell>
                  <Cell>{o.customer_name}</Cell>
                  <Cell align="right">{showMoney ? fmtMoney(o.total_amount) : fmtDate(o.ship_by)}</Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>

        {showMoney && (
          <Card title="Борги клієнтів" className="lg:col-span-2">
            {debtors.length === 0 ? (
              <Empty>Усі розрахувалися</Empty>
            ) : (
              <Table head={['Клієнт', 'Заборгованість']}>
                {debtors.map((d) => (
                  <Row key={d.customer_id}>
                    <Cell>{d.name}</Cell>
                    <Cell align="right" className="font-semibold">
                      {fmtMoney(d.balance_due)}
                    </Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
