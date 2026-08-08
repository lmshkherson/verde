import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cancelProductionOrder, startProduction } from '@/app/actions/production';
import { Badge, Button, Card, Cell, Empty, LinkButton, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { fmtDate, fmtMoney, fmtQty, PROD_STATUS, unitLabel } from '@/lib/format';
import { requireRole } from '@/lib/session';
import { CompleteProductionForm, type Material } from '../complete-form';

export const dynamic = 'force-dynamic';

const statusTone: Record<string, 'gray' | 'amber' | 'green' | 'red'> = {
  planned: 'gray',
  in_progress: 'amber',
  done: 'green',
  cancelled: 'red',
};

export default async function ProductionOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole('production');
  const { id } = await params;

  const order = await queryOne<{
    id: string;
    number: string;
    status: string;
    planned_qty: number;
    produced_qty: number;
    planned_for: string | null;
    finished_at: string | null;
    note: string | null;
    product: string;
    product_sku: string;
    recipe_id: string;
    version: number;
    output_qty: number;
    batch_code: string | null;
    material_cost: number | null;
    overhead_cost: number;
    unit_cost: number | null;
    overhead_policy: string;
  }>(
    `select po.id, po.number, po.status, po.planned_qty, po.produced_qty, po.planned_for,
            po.finished_at, po.note, i.name as product, i.sku as product_sku,
            po.recipe_id, r.version, r.output_qty, b.code as batch_code,
            ac.material_cost, po.overhead_cost, ac.unit_cost, e.overhead_policy
       from production_orders po
       join items i on i.id = po.product_item_id
       join legal_entities e on e.id = po.legal_entity_id
       join recipes r on r.id = po.recipe_id
       left join batches b on b.id = po.output_batch_id
       left join v_production_actual_cost ac on ac.production_order_id = po.id
      where po.id = $1`,
    [id],
  );
  if (!order) notFound();

  const [materials, consumed] = await Promise.all([
    query<{
      item_id: string;
      name: string;
      unit: string;
      qty_per_batch: number;
      loss_pct: number;
      available: number;
      avg_cost: number;
    }>(
      `select rl.item_id, i.name, i.unit, rl.qty_per_batch, rl.loss_pct,
              coalesce(s.qty, 0) as available, coalesce(s.avg_cost, 0) as avg_cost
         from recipe_lines rl
         join items i on i.id = rl.item_id
         left join v_item_stock s on s.item_id = rl.item_id and s.legal_entity_id = $2
        where rl.recipe_id = $1
        order by i.name`,
      [order.recipe_id, session.eid],
    ),
    query<{ name: string; unit: string; qty: number; unit_cost: number; batch_code: string | null }>(
      `select i.name, i.unit, -m.qty as qty, m.unit_cost, b.code as batch_code
         from stock_moves m
         join items i on i.id = m.item_id
         left join batches b on b.id = m.batch_id
        where m.doc_type = 'production_order' and m.doc_id = $1 and m.move_type = 'production_consume'
        order by i.name`,
      [id],
    ),
  ]);

  const canWork = order.status === 'planned' || order.status === 'in_progress';
  const formMaterials: Material[] = materials.map((m) => ({
    itemId: m.item_id,
    name: m.name,
    unit: m.unit,
    qtyPerBatch: m.qty_per_batch,
    lossPct: m.loss_pct,
    available: m.available,
    avgCost: m.avg_cost,
  }));

  return (
    <>
      <PageHeader
        title={`Варка ${order.number}`}
        subtitle={`${order.product} · рецептура v${order.version}`}
        action={<LinkButton href="/production">← До списку</LinkButton>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="План" value={fmtQty(order.planned_qty, 'шт')} hint={fmtDate(order.planned_for)} />
        <Stat
          label="Випущено"
          value={order.status === 'done' ? fmtQty(order.produced_qty, 'шт') : '—'}
          hint={order.batch_code ? `партія ${order.batch_code}` : undefined}
          tone={order.status === 'done' ? 'good' : 'default'}
        />
        <Stat
          label="Собівартість одиниці"
          value={order.unit_cost ? fmtMoney(order.unit_cost) : '—'}
          hint={
            order.material_cost
              ? order.overhead_policy === 'capitalize'
                ? `сировина ${fmtMoney(order.material_cost)} + накладні ${fmtMoney(order.overhead_cost)}`
                : 'лише сировина — витрати цеху йдуть у період'
              : undefined
          }
        />
        <div className="rounded-2xl border border-emerald-900/10 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-800/60">Статус</div>
          <div className="mt-2">
            <Badge tone={statusTone[order.status]}>{PROD_STATUS[order.status]}</Badge>
          </div>
          {canWork && (
            <div className="mt-3 flex gap-2">
              {order.status === 'planned' && (
                <form action={startProduction}>
                  <input type="hidden" name="order_id" value={order.id} />
                  <Button className="!min-h-9 !px-3 text-xs">Почати</Button>
                </form>
              )}
              <form action={cancelProductionOrder}>
                <input type="hidden" name="order_id" value={order.id} />
                <Button variant="ghost" className="!min-h-9 !px-3 text-xs">
                  Скасувати
                </Button>
              </form>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4">
        {canWork && (
          <Card title="Потреба в сировині">
            <Table head={['Компонент', 'Норма на план', 'На складі', 'Вистачає?']}>
              {materials.map((m) => {
                const required =
                  Math.round(
                    ((m.qty_per_batch * (1 + m.loss_pct / 100) * order.planned_qty) / order.output_qty) *
                      1000,
                  ) / 1000;
                const enough = m.available + 0.0005 >= required;
                return (
                  <Row key={m.item_id}>
                    <Cell>
                      <div className="font-semibold">{m.name}</div>
                      {m.loss_pct > 0 && (
                        <div className="text-xs text-emerald-800/50">втрати {m.loss_pct}%</div>
                      )}
                    </Cell>
                    <Cell align="right">{fmtQty(required, unitLabel(m.unit))}</Cell>
                    <Cell align="right">{fmtQty(m.available, unitLabel(m.unit))}</Cell>
                    <Cell align="right">
                      {enough ? (
                        <Badge tone="green">так</Badge>
                      ) : (
                        <Badge tone="red">бракує {fmtQty(required - m.available)}</Badge>
                      )}
                    </Cell>
                  </Row>
                );
              })}
            </Table>
          </Card>
        )}

        {canWork && (
          <Card title="Закриття варки">
            <CompleteProductionForm
              orderId={order.id}
              plannedQty={order.planned_qty}
              outputQty={order.output_qty}
              materials={formMaterials}
              defaultBatchCode={`${order.product_sku}/${order.number}`}
              capitalizeOverhead={order.overhead_policy === 'capitalize'}
            />
          </Card>
        )}

        {order.status === 'done' && (
          <Card title="Фактично списано">
            {consumed.length === 0 ? (
              <Empty>Списань не було</Empty>
            ) : (
              <Table head={['Компонент', 'Партія', 'Кількість', 'Сума']}>
                {consumed.map((c, i) => (
                  <Row key={i}>
                    <Cell>{c.name}</Cell>
                    <Cell className="font-mono text-xs">{c.batch_code ?? '—'}</Cell>
                    <Cell align="right">{fmtQty(c.qty, unitLabel(c.unit))}</Cell>
                    <Cell align="right">{fmtMoney(c.qty * c.unit_cost)}</Cell>
                  </Row>
                ))}
              </Table>
            )}
            <p className="mt-4 text-sm text-emerald-800/70">
              Закрито {fmtDate(order.finished_at)}. Готова продукція оприбуткована партією{' '}
              <span className="font-mono">{order.batch_code}</span> —{' '}
              <Link href="/stock" className="font-semibold text-emerald-700 hover:underline">
                перевірити на складі
              </Link>
              .
            </p>
          </Card>
        )}
      </div>
    </>
  );
}
