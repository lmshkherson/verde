import { Card, Cell, Empty, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { fmtDate, fmtMoney, fmtQty, ITEM_KINDS, unitLabel } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  await requireRole(); // лише власник

  const [summary, margins, production, prices, stockValue] = await Promise.all([
    queryOne<{ revenue: number; cogs: number; orders: number }>(`
      select
        (select coalesce(sum(sl.qty * l.unit_price), 0)
           from shipment_lines sl join sales_order_lines l on l.id = sl.so_line_id) as revenue,
        (select coalesce(sum(-m.qty * m.unit_cost), 0)
           from stock_moves m where m.move_type = 'sale_shipment')                  as cogs,
        (select count(*) from sales_orders where status = 'shipped')::int           as orders
    `),
    query<{ sku: string; name: string; sold_qty: number; revenue: number; cogs: number; margin: number }>(
      'select sku, name, sold_qty, revenue, cogs, margin from v_item_sales_margin where sold_qty > 0 order by margin desc',
    ),
    query<{
      number: string;
      product: string;
      produced_qty: number;
      material_cost: number;
      overhead_cost: number;
      unit_cost: number;
      finished_at: string | null;
    }>(`
      select ac.number, i.name as product, ac.produced_qty, ac.material_cost,
             ac.overhead_cost, ac.unit_cost, po.finished_at
        from v_production_actual_cost ac
        join production_orders po on po.id = ac.production_order_id
        join items i on i.id = po.product_item_id
       where po.status = 'done'
       order by po.finished_at desc
       limit 20
    `),
    query<{ name: string; unit: string; moved_at: string; unit_cost: number; qty: number; supplier_name: string | null }>(`
      select i.name, i.unit, h.moved_at, h.unit_cost, h.qty, h.supplier_name
        from v_purchase_price_history h
        join items i on i.id = h.item_id
       order by h.moved_at desc
       limit 20
    `),
    query<{ kind: string; value: number; qty: number }>(`
      select kind, sum(value) as value, sum(qty) as qty
        from v_item_stock group by kind order by kind
    `),
  ]);

  const margin = (summary?.revenue ?? 0) - (summary?.cogs ?? 0);
  const marginPct = summary?.revenue ? Math.round((margin / summary.revenue) * 1000) / 10 : 0;
  const totalStock = stockValue.reduce((s, r) => s + r.value, 0);

  return (
    <>
      <PageHeader title="Звіти" subtitle="Собівартість, маржа й вартість запасів — за весь час" />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Виручка" value={fmtMoney(summary?.revenue)} hint={`${summary?.orders ?? 0} закритих замовлень`} />
        <Stat label="Собівартість продажів" value={fmtMoney(summary?.cogs)} />
        <Stat label="Валова маржа" value={fmtMoney(margin)} hint={`${marginPct}%`} tone={margin > 0 ? 'good' : 'danger'} />
        <Stat label="Запаси на складі" value={fmtMoney(totalStock)} hint="за собівартістю" />
      </div>

      <div className="grid gap-4">
        <Card title="Маржа за SKU">
          {margins.length === 0 ? (
            <Empty>Продажів ще не було</Empty>
          ) : (
            <Table head={['Товар', 'Продано', 'Виручка', 'Собівартість', 'Маржа', '%']}>
              {margins.map((m) => {
                const pct = m.revenue > 0 ? Math.round((m.margin / m.revenue) * 1000) / 10 : 0;
                return (
                  <Row key={m.sku}>
                    <Cell>
                      <div className="font-semibold">{m.name}</div>
                      <div className="text-xs text-emerald-800/50">{m.sku}</div>
                    </Cell>
                    <Cell align="right">{fmtQty(m.sold_qty, 'шт')}</Cell>
                    <Cell align="right">{fmtMoney(m.revenue)}</Cell>
                    <Cell align="right">{fmtMoney(m.cogs)}</Cell>
                    <Cell align="right" className="font-semibold text-emerald-700">
                      {fmtMoney(m.margin)}
                    </Cell>
                    <Cell align="right">{pct}%</Cell>
                  </Row>
                );
              })}
            </Table>
          )}
        </Card>

        <Card title="Собівартість варок">
          {production.length === 0 ? (
            <Empty>Закритих варок ще немає</Empty>
          ) : (
            <Table head={['Варка', 'Продукт', 'Випуск', 'Сировина', 'Накладні', 'Собівартість од.']}>
              {production.map((p) => (
                <Row key={p.number}>
                  <Cell>
                    <div className="font-semibold">{p.number}</div>
                    <div className="text-xs text-emerald-800/50">{fmtDate(p.finished_at)}</div>
                  </Cell>
                  <Cell>{p.product}</Cell>
                  <Cell align="right">{fmtQty(p.produced_qty, 'шт')}</Cell>
                  <Cell align="right">{fmtMoney(p.material_cost)}</Cell>
                  <Cell align="right">{fmtMoney(p.overhead_cost)}</Cell>
                  <Cell align="right" className="font-semibold">
                    {fmtMoney(p.unit_cost)}
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Історія закупівельних цін">
          {prices.length === 0 ? (
            <Empty>Приходів ще не було</Empty>
          ) : (
            <Table head={['Дата', 'Сировина', 'Постачальник', 'Кількість', 'Ціна']}>
              {prices.map((p, i) => (
                <Row key={i}>
                  <Cell>{fmtDate(p.moved_at)}</Cell>
                  <Cell className="font-semibold">{p.name}</Cell>
                  <Cell>{p.supplier_name ?? '—'}</Cell>
                  <Cell align="right">{fmtQty(p.qty, unitLabel(p.unit))}</Cell>
                  <Cell align="right" className="font-semibold">
                    {fmtMoney(p.unit_cost)}
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Вартість запасів за групами">
          <Table head={['Група', 'Кількість', 'Вартість']}>
            {stockValue.map((s) => (
              <Row key={s.kind}>
                <Cell className="font-semibold">{ITEM_KINDS[s.kind] ?? s.kind}</Cell>
                <Cell align="right">{fmtQty(s.qty)}</Cell>
                <Cell align="right" className="font-semibold">
                  {fmtMoney(s.value)}
                </Cell>
              </Row>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
