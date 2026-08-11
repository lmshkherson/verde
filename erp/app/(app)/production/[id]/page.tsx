import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cancelProductionOrder, startProduction, updateProductionHeader } from '@/app/actions/production';
import { ActionForm } from '@/components/action-form';
import { Badge, Button, Card, Cell, Empty, Field, inputClass, LinkButton, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { fmtDate, fmtMoney, fmtQty, isoDay, PROD_STATUS, unitLabel } from '@/lib/format';
import { requireRole } from '@/lib/session';
import { CompleteProductionForm, type Material } from '../complete-form';

export const dynamic = 'force-dynamic';

const statusTone: Record<string, 'gray' | 'amber' | 'green' | 'red'> = {
  planned: 'gray',
  in_progress: 'amber',
  done: 'green',
  cancelled: 'red',
};

/**
 * Документ варки — та сама структура, що й у надходження: статус біля
 * заголовка, показники, рядки документа з цінами й підсумком у головній
 * колонці, шапка і проведення — у правій.
 */
export default async function ProductionOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole('production');
  const { id } = await params;

  const order = await queryOne<{
    id: string;
    number: string;
    status: string;
    planned_qty: number;
    produced_qty: number;
    planned_for: string | Date | null;
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
      sku: string;
      unit: string;
      qty_per_batch: number;
      loss_pct: number;
      available: number;
      blocked: number;
      avg_cost: number;
    }>(
      // «На складі» — це лише допущені партії: карантинні у варку не підуть,
      // і показувати їх як доступні означало б обіцяти те, чого немає.
      `select rl.item_id, i.name, i.sku, i.unit, rl.qty_per_batch, rl.loss_pct,
              coalesce(q.released_qty, 0) as available,
              coalesce(q.blocked_qty, 0) as blocked,
              coalesce(s.avg_cost, 0) as avg_cost
         from recipe_lines rl
         join items i on i.id = rl.item_id
         left join v_item_stock s on s.item_id = rl.item_id and s.legal_entity_id = $2
         left join lateral (
           select sum(sb.qty) filter (where b.quality_status = 'released')  as released_qty,
                  sum(sb.qty) filter (where b.quality_status <> 'released') as blocked_qty
             from v_stock_batches sb
             join batches b on b.id = sb.batch_id
            where sb.item_id = rl.item_id and sb.legal_entity_id = $2
         ) q on true
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

  const requiredOf = (m: (typeof materials)[number]) =>
    Math.round(((m.qty_per_batch * (1 + m.loss_pct / 100) * order.planned_qty) / order.output_qty) * 1000) /
    1000;
  const plannedMaterialCost = materials.reduce((s, m) => s + requiredOf(m) * Number(m.avg_cost), 0);
  const consumedTotal = consumed.reduce((s, c) => s + Number(c.qty) * Number(c.unit_cost), 0);

  return (
    <>
      <PageHeader
        title={`Варка ${order.number}`}
        subtitle={`${order.product} · техкарта v${order.version} · вихід ${fmtQty(order.output_qty)} шт із варки`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone[order.status]}>{PROD_STATUS[order.status]}</Badge>
            <LinkButton href={`/movements/${order.id}`}>Дт/Кт</LinkButton>
            <LinkButton href="/production">← До списку</LinkButton>
          </div>
        }
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
          label="Сировина на план"
          value={fmtMoney(order.status === 'done' ? consumedTotal : plannedMaterialCost)}
          hint={order.status === 'done' ? 'фактично списано' : 'за поточними цінами складу'}
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
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {canWork && (
            <Card title="Рядки документа — потреба в сировині">
              <Table head={['№', 'Компонент', 'Потрібно', 'На складі', 'Ціна', 'Сума', 'Вистачає?']}>
                {materials.map((m, idx) => {
                  const required = requiredOf(m);
                  const enough = m.available + 0.0005 >= required;
                  return (
                    <Row key={m.item_id}>
                      <Cell className="text-emerald-800/50">{idx + 1}</Cell>
                      <Cell>
                        <div className="font-semibold">{m.name}</div>
                        <div className="text-xs text-emerald-800/50">
                          {m.sku}
                          {m.loss_pct > 0 ? ` · втрати ${m.loss_pct}%` : ''}
                        </div>
                      </Cell>
                      <Cell align="right">{fmtQty(required, unitLabel(m.unit))}</Cell>
                      <Cell align="right">
                        {fmtQty(m.available, unitLabel(m.unit))}
                        {Number(m.blocked) > 0.0005 && (
                          <div className="text-xs font-semibold text-amber-600">
                            + {fmtQty(m.blocked)} не допущено
                          </div>
                        )}
                      </Cell>
                      <Cell align="right">{fmtMoney(m.avg_cost)}</Cell>
                      <Cell align="right" className="font-semibold">
                        {fmtMoney(required * m.avg_cost)}
                      </Cell>
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
              <div className="mt-3 flex justify-end text-sm">
                <span className="text-emerald-800/60">Разом сировина:&nbsp;</span>
                <span className="font-bold tabular-nums">{fmtMoney(plannedMaterialCost)}</span>
              </div>
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
            <Card title="Рядки документа — фактично списано">
              {consumed.length === 0 ? (
                <Empty>Списань не було</Empty>
              ) : (
                <>
                  <Table head={['№', 'Компонент', 'Партія', 'Кількість', 'Ціна', 'Сума']}>
                    {consumed.map((c, i) => (
                      <Row key={i}>
                        <Cell className="text-emerald-800/50">{i + 1}</Cell>
                        <Cell className="font-semibold">{c.name}</Cell>
                        <Cell className="font-mono text-xs">{c.batch_code ?? '—'}</Cell>
                        <Cell align="right">{fmtQty(c.qty, unitLabel(c.unit))}</Cell>
                        <Cell align="right">{fmtMoney(c.unit_cost)}</Cell>
                        <Cell align="right" className="font-semibold">
                          {fmtMoney(Number(c.qty) * Number(c.unit_cost))}
                        </Cell>
                      </Row>
                    ))}
                  </Table>
                  <div className="mt-3 flex justify-end text-sm">
                    <span className="text-emerald-800/60">Разом списано:&nbsp;</span>
                    <span className="font-bold tabular-nums">{fmtMoney(consumedTotal)}</span>
                  </div>
                </>
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

        <div className="space-y-4">
          {canWork && (
            <Card title="Шапка документа">
              <ActionForm action={updateProductionHeader} submitLabel="Зберегти шапку" variant="ghost">
                <input type="hidden" name="order_id" value={order.id} />
                <Field label="Дата виробництва">
                  <input
                    name="planned_for"
                    type="date"
                    defaultValue={isoDay(order.planned_for) ?? ''}
                    className={inputClass}
                  />
                </Field>
                <Field label="Примітка">
                  <input name="note" defaultValue={order.note ?? ''} className={inputClass} />
                </Field>
              </ActionForm>
            </Card>
          )}

          {canWork ? (
            <Card title="Проведення">
              <p className="mb-3 text-sm text-emerald-800/70">
                Закриття варки спише сировину партіями за FEFO, порахує собівартість і оприбуткує
                готову продукцію окремою партією з власним терміном придатності.
              </p>
              {order.status === 'planned' && (
                <form action={startProduction} className="mb-3">
                  <input type="hidden" name="order_id" value={order.id} />
                  <Button>Почати</Button>
                </form>
              )}
              <form action={cancelProductionOrder}>
                <input type="hidden" name="order_id" value={order.id} />
                <Button variant="ghost">Скасувати документ</Button>
              </form>
            </Card>
          ) : (
            <Card title="Документ">
              <dl className="space-y-2 text-sm">
                {[
                  ['Продукт', order.product],
                  ['Техкарта', `v${order.version}`],
                  ['Партія випуску', order.batch_code ?? '—'],
                  ['Закрито', order.finished_at ? fmtDate(order.finished_at) : '—'],
                  ['Примітка', order.note ?? '—'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-emerald-800/60">{k}</dt>
                    <dd className="text-right font-medium text-emerald-950">{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
