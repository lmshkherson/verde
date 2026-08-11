import Link from 'next/link';
import { createProductionOrder } from '@/app/actions/production';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Cell, Empty, Field, inputClass, LinkButton, PageHeader, Row, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { fmtDate, fmtMoney, fmtQty, PROD_STATUS } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const statusTone: Record<string, 'gray' | 'amber' | 'green' | 'red'> = {
  planned: 'gray',
  in_progress: 'amber',
  done: 'green',
  cancelled: 'red',
};

export default async function ProductionPage() {
  const session = await requireRole('production');

  const [orders, recipes] = await Promise.all([
    query<{
      id: string;
      number: string;
      product: string;
      planned_qty: number;
      produced_qty: number;
      status: string;
      planned_for: string | null;
      unit_cost: number | null;
    }>(`
      select po.id, po.number, i.name as product, po.planned_qty, po.produced_qty,
             po.status, po.planned_for, ac.unit_cost
        from production_orders po
        join items i on i.id = po.product_item_id
        left join v_production_actual_cost ac on ac.production_order_id = po.id
       where po.legal_entity_id = $1
       order by
         case po.status when 'in_progress' then 0 when 'planned' then 1 else 2 end,
         po.planned_for nulls last, po.created_at desc
       limit 100
    `, [session.eid]),
    // Продукти з чинними техкартами: версію для варки обирає дата, а не людина.
    query<{ id: string; label: string; output_qty: number; unit_material_cost: number | null }>(`
      select r.product_item_id as id,
             i.name || ' — техкарта v' || r.version || ' діє з ' || to_char(r.effective_from, 'DD.MM.YYYY') as label,
             r.output_qty,
             rc.unit_material_cost
        from v_current_recipes r
        join items i on i.id = r.product_item_id
        left join v_recipe_cost rc on rc.recipe_id = r.id and rc.legal_entity_id = $1
       order by i.name
    `, [session.eid]),
  ]);

  return (
    <>
      <PageHeader
        title="Виробництво"
        subtitle="Варки, списання сировини й випуск готової продукції"
        action={<LinkButton href="/production/recipes">Рецептури</LinkButton>}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card title="Виробничі замовлення">
          {orders.length === 0 ? (
            <Empty>Замовлень ще немає — створіть перше праворуч</Empty>
          ) : (
            <Table head={['Номер', 'Продукт', 'План / факт', 'Собівартість', 'Статус']}>
              {orders.map((o) => (
                <Row key={o.id}>
                  <Cell>
                    <Link href={`/production/${o.id}`} className="font-semibold text-emerald-700 hover:underline">
                      {o.number}
                    </Link>
                    <div className="text-xs text-emerald-800/50">{fmtDate(o.planned_for)}</div>
                  </Cell>
                  <Cell>{o.product}</Cell>
                  <Cell align="right">
                    {fmtQty(o.planned_qty)}
                    {o.status === 'done' && (
                      <div className="text-xs text-emerald-800/60">факт {fmtQty(o.produced_qty)}</div>
                    )}
                  </Cell>
                  <Cell align="right">{o.unit_cost ? fmtMoney(o.unit_cost) : '—'}</Cell>
                  <Cell>
                    <Badge tone={statusTone[o.status]}>{PROD_STATUS[o.status]}</Badge>
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Нова варка">
          {recipes.length === 0 ? (
            <Empty>
              Спершу створіть рецептуру
            </Empty>
          ) : (
            <ActionForm action={createProductionOrder} submitLabel="Створити замовлення">
              <Field label="Продукт" hint="версію техкарти визначає дата виробництва">
                <select name="product_item_id" required className={inputClass} defaultValue="">
                  <option value="" disabled>
                    Оберіть продукт…
                  </option>
                  {recipes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label} ({fmtQty(r.output_qty)} шт із варки)
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Планова кількість, шт">
                <input name="planned_qty" type="number" step="1" min="1" required className={inputClass} />
              </Field>
              <Field label="Дата виробництва">
                <input name="planned_for" type="date" className={inputClass} />
              </Field>
              <Field label="Примітка">
                <input name="note" className={inputClass} />
              </Field>
            </ActionForm>
          )}
        </Card>
      </div>
    </>
  );
}
