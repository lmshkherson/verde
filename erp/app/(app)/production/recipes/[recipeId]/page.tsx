import { notFound } from 'next/navigation';
import { addRecipeLine, removeRecipeLine } from '@/app/actions/production';
import { ActionForm } from '@/components/action-form';
import { Button, Card, Cell, Empty, Field, inputClass, LinkButton, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { fmtMoney, fmtQty, unitLabel } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function RecipePage({ params }: { params: Promise<{ recipeId: string }> }) {
  const session = await requireRole('production');
  const { recipeId } = await params;

  const recipe = await queryOne<{
    id: string;
    version: number;
    output_qty: number;
    notes: string | null;
    product: string;
    sku: string;
    price_distributor: number | null;
    batch_material_cost: number | null;
    unit_material_cost: number | null;
  }>(
    `select r.id, r.version, r.output_qty, r.notes, i.name as product, i.sku, i.price_distributor,
            rc.batch_material_cost, rc.unit_material_cost
       from recipes r
       join items i on i.id = r.product_item_id
       left join v_recipe_cost rc on rc.recipe_id = r.id and rc.legal_entity_id = $2
      where r.id = $1`,
    [recipeId, session.eid],
  );
  if (!recipe) notFound();

  const [lines, materials] = await Promise.all([
    query<{
      id: string;
      item_id: string;
      name: string;
      sku: string;
      unit: string;
      qty_per_batch: number;
      loss_pct: number;
      avg_cost: number;
    }>(
      `select rl.id, rl.item_id, i.name, i.sku, i.unit, rl.qty_per_batch, rl.loss_pct,
              coalesce(s.avg_cost, 0) as avg_cost
         from recipe_lines rl
         join items i on i.id = rl.item_id
         left join v_item_stock s on s.item_id = rl.item_id and s.legal_entity_id = $2
        where rl.recipe_id = $1
        order by i.name`,
      [recipeId, session.eid],
    ),
    query<{ id: string; sku: string; name: string; unit: string }>(
      "select id, sku, name, unit from items where kind in ('raw','packaging','semi') and is_active order by name",
    ),
  ]);

  const unitCost = recipe.unit_material_cost ?? 0;
  const marginPct =
    recipe.price_distributor && unitCost
      ? Math.round(((recipe.price_distributor - unitCost) / recipe.price_distributor) * 1000) / 10
      : null;

  return (
    <>
      <PageHeader
        title={`${recipe.product} — v${recipe.version}`}
        subtitle={`${recipe.sku} · вихід ${fmtQty(recipe.output_qty)} шт із варки`}
        action={<LinkButton href="/production/recipes">← До рецептур</LinkButton>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Сировина на варку" value={fmtMoney(recipe.batch_material_cost)} />
        <Stat label="Сировина на одиницю" value={fmtMoney(unitCost)} hint="за поточними цінами складу" />
        <Stat
          label="Ціна дистриб'ютора"
          value={recipe.price_distributor ? fmtMoney(recipe.price_distributor) : '—'}
        />
        <Stat
          label="Маржа до сировини"
          value={marginPct === null ? '—' : `${marginPct}%`}
          tone={marginPct !== null && marginPct > 50 ? 'good' : 'warn'}
          hint="без накладних витрат"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card title="Склад рецептури">
          {lines.length === 0 ? (
            <Empty>Додайте перший компонент</Empty>
          ) : (
            <Table head={['Компонент', 'На варку', 'Втрати', 'Ціна', 'Сума', '']}>
              {lines.map((l) => {
                const effective = l.qty_per_batch * (1 + l.loss_pct / 100);
                return (
                  <Row key={l.id}>
                    <Cell>
                      <div className="font-semibold">{l.name}</div>
                      <div className="text-xs text-emerald-800/50">{l.sku}</div>
                    </Cell>
                    <Cell align="right">{fmtQty(l.qty_per_batch, unitLabel(l.unit))}</Cell>
                    <Cell align="right">{l.loss_pct > 0 ? `${l.loss_pct}%` : '—'}</Cell>
                    <Cell align="right">{fmtMoney(l.avg_cost)}</Cell>
                    <Cell align="right" className="font-semibold">
                      {fmtMoney(effective * l.avg_cost)}
                    </Cell>
                    <Cell align="right">
                      <form action={removeRecipeLine}>
                        <input type="hidden" name="line_id" value={l.id} />
                        <input type="hidden" name="recipe_id" value={recipe.id} />
                        <Button variant="ghost" className="!min-h-9 !px-3 text-xs">
                          Видалити
                        </Button>
                      </form>
                    </Cell>
                  </Row>
                );
              })}
            </Table>
          )}
          {recipe.notes && (
            <p className="mt-4 whitespace-pre-line rounded-xl bg-emerald-50/60 p-3 text-sm text-emerald-900/80">
              {recipe.notes}
            </p>
          )}
        </Card>

        <Card title="Додати компонент">
          <ActionForm action={addRecipeLine} submitLabel="Зберегти компонент">
            <input type="hidden" name="recipe_id" value={recipe.id} />
            <Field label="Сировина або пакування">
              <select name="item_id" required className={inputClass} defaultValue="">
                <option value="" disabled>
                  Оберіть позицію…
                </option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({unitLabel(m.unit)})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Кількість на варку">
              <input name="qty_per_batch" type="number" step="0.0001" min="0" required className={inputClass} />
            </Field>
            <Field label="Технологічні втрати, %" hint="Усушка, налипання, обрізки">
              <input name="loss_pct" type="number" step="0.1" min="0" max="99" defaultValue="0" className={inputClass} />
            </Field>
          </ActionForm>
          <p className="mt-3 text-xs text-emerald-800/60">
            Повторне додавання тієї самої позиції оновлює її норму.
          </p>
        </Card>
      </div>
    </>
  );
}
