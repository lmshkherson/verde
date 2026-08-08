import { Badge, Card, Cell, Empty, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { fmtDate, fmtMoney, fmtQty, ITEM_KINDS, unitLabel } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const monthFmt = new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric' });

export default async function ReportsPage() {
  const session = await requireRole(); // лише власник

  const [summary, margins, production, prices, stockValue, vatRows, entityTotals] = await Promise.all([
    // Виручка береться без ПДВ: податок іде транзитом у бюджет і виручкою не є.
    queryOne<{ revenue: number; cogs: number; orders: number; vat: number }>(
      `select
         (select coalesce(sum(sl.qty * l.unit_price), 0)
            from shipment_lines sl
            join sales_order_lines l on l.id = sl.so_line_id
            join shipments sh on sh.id = sl.shipment_id
            join sales_orders o on o.id = sh.so_id
           where o.legal_entity_id = $1)                                        as revenue,
         (select coalesce(sum(sl.qty * l.unit_price * l.vat_rate / 100), 0)
            from shipment_lines sl
            join sales_order_lines l on l.id = sl.so_line_id
            join shipments sh on sh.id = sl.shipment_id
            join sales_orders o on o.id = sh.so_id
           where o.legal_entity_id = $1)                                        as vat,
         (select coalesce(sum(-m.qty * m.unit_cost), 0)
            from stock_moves m
           where m.move_type = 'sale_shipment' and m.legal_entity_id = $1)      as cogs,
         (select count(*) from sales_orders
           where status = 'shipped' and legal_entity_id = $1)::int              as orders`,
      [session.eid],
    ),
    query<{ sku: string; name: string; sold_qty: number; revenue: number; cogs: number; margin: number }>(
      `select sku, name, sold_qty, revenue, cogs, margin
         from v_item_sales_margin
        where sold_qty > 0 and legal_entity_id = $1
        order by margin desc`,
      [session.eid],
    ),
    query<{
      number: string;
      product: string;
      produced_qty: number;
      material_cost: number;
      overhead_cost: number;
      unit_cost: number;
      finished_at: string | null;
    }>(
      `select ac.number, i.name as product, ac.produced_qty, ac.material_cost,
              ac.overhead_cost, ac.unit_cost, po.finished_at
         from v_production_actual_cost ac
         join production_orders po on po.id = ac.production_order_id
         join items i on i.id = po.product_item_id
        where po.status = 'done' and po.legal_entity_id = $1
        order by po.finished_at desc
        limit 20`,
      [session.eid],
    ),
    query<{ name: string; unit: string; moved_at: string; unit_cost: number; qty: number; supplier_name: string | null }>(
      `select i.name, i.unit, h.moved_at, h.unit_cost, h.qty, h.supplier_name
         from v_purchase_price_history h
         join items i on i.id = h.item_id
        where h.legal_entity_id = $1
        order by h.moved_at desc
        limit 20`,
      [session.eid],
    ),
    query<{ kind: string; value: number; qty: number }>(
      `select kind, sum(value) as value, sum(qty) as qty
         from v_item_stock where legal_entity_id = $1 group by kind order by kind`,
      [session.eid],
    ),
    query<{ period: string; liability: number | null; credit: number | null; payable: number }>(
      `select period, liability, credit, payable
         from v_vat_summary where legal_entity_id = $1 order by period desc limit 12`,
      [session.eid],
    ),
    // Зведення по всіх юрособах — щоб власник бачив групу цілком, а не по шматках.
    query<{ short_name: string; is_vat_payer: boolean; stock_value: number; revenue: number; cogs: number }>(`
      select e.short_name, e.is_vat_payer,
             coalesce(st.value, 0) as stock_value,
             coalesce(rv.revenue, 0) as revenue,
             coalesce(cg.cogs, 0) as cogs
        from legal_entities e
        left join (select legal_entity_id, sum(value) as value from v_item_stock group by legal_entity_id) st
               on st.legal_entity_id = e.id
        left join (
          select o.legal_entity_id, sum(sl.qty * l.unit_price) as revenue
            from shipment_lines sl
            join sales_order_lines l on l.id = sl.so_line_id
            join shipments sh on sh.id = sl.shipment_id
            join sales_orders o on o.id = sh.so_id
           group by o.legal_entity_id
        ) rv on rv.legal_entity_id = e.id
        left join (
          select legal_entity_id, sum(-qty * unit_cost) as cogs
            from stock_moves where move_type = 'sale_shipment' group by legal_entity_id
        ) cg on cg.legal_entity_id = e.id
       where e.is_active
       order by e.short_name
    `),
  ]);

  const margin = (summary?.revenue ?? 0) - (summary?.cogs ?? 0);
  const marginPct = summary?.revenue ? Math.round((margin / summary.revenue) * 1000) / 10 : 0;
  const totalStock = stockValue.reduce((s, r) => s + r.value, 0);

  return (
    <>
      <PageHeader
        title="Звіти"
        subtitle={`${session.ename} · собівартість, маржа й ПДВ. Виручка й маржа — без ПДВ`}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Виручка без ПДВ"
          value={fmtMoney(summary?.revenue)}
          hint={`${summary?.orders ?? 0} закритих замовлень`}
        />
        <Stat label="Собівартість продажів" value={fmtMoney(summary?.cogs)} />
        <Stat
          label="Валова маржа"
          value={fmtMoney(margin)}
          hint={`${marginPct}%`}
          tone={margin > 0 ? 'good' : 'danger'}
        />
        <Stat label="Запаси на складі" value={fmtMoney(totalStock)} hint="за собівартістю" />
      </div>

      <div className="grid gap-4">
        {session.vat && (
          <Card title="ПДВ за періодами">
            {vatRows.length === 0 ? (
              <Empty>Операцій із ПДВ ще не було</Empty>
            ) : (
              <Table head={['Період', 'Зобов’язання', 'Податковий кредит', 'До сплати']}>
                {vatRows.map((v) => (
                  <Row key={v.period}>
                    <Cell className="font-semibold">{monthFmt.format(new Date(v.period))}</Cell>
                    <Cell align="right">{fmtMoney(v.liability ?? 0)}</Cell>
                    <Cell align="right">{fmtMoney(v.credit ?? 0)}</Cell>
                    <Cell align="right" className={v.payable > 0 ? 'font-bold text-amber-600' : 'font-bold'}>
                      {fmtMoney(v.payable)}
                    </Cell>
                  </Row>
                ))}
              </Table>
            )}
            <p className="mt-3 text-xs text-emerald-800/60">
              Зобов’язання фіксується за датою відвантаження, кредит — за датою оприбуткування.
              Правило першої події за оплатою наперед поки не враховується.
            </p>
          </Card>
        )}

        <Card title="Група компаній">
          <Table head={['Юрособа', 'Статус', 'Запаси', 'Виручка без ПДВ', 'Маржа']}>
            {entityTotals.map((e) => (
              <Row key={e.short_name}>
                <Cell className="font-semibold">{e.short_name}</Cell>
                <Cell>
                  <Badge tone={e.is_vat_payer ? 'blue' : 'gray'}>
                    {e.is_vat_payer ? 'з ПДВ' : 'без ПДВ'}
                  </Badge>
                </Cell>
                <Cell align="right">{fmtMoney(e.stock_value)}</Cell>
                <Cell align="right">{fmtMoney(e.revenue)}</Cell>
                <Cell align="right" className="font-semibold">
                  {fmtMoney(e.revenue - e.cogs)}
                </Cell>
              </Row>
            ))}
          </Table>
          <p className="mt-3 text-xs text-emerald-800/60">
            Продажі між власними юрособами тут враховані як звичайні — щоб побачити чистий результат
            групи, їх треба виключити вручну.
          </p>
        </Card>

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
            <Table head={['Дата', 'Сировина', 'Постачальник', 'Кількість', 'Собівартість']}>
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
