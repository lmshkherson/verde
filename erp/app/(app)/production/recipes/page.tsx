import Link from 'next/link';
import { createRecipe } from '@/app/actions/production';
import { ActionForm } from '@/components/action-form';
import { Card, Cell, Empty, Field, inputClass, LinkButton, PageHeader, Row, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { fmtMoney, fmtQty } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function RecipesPage() {
  await requireRole('production');

  const [recipes, products] = await Promise.all([
    query<{
      id: string;
      product: string;
      sku: string;
      version: number;
      output_qty: number;
      lines: number;
      unit_material_cost: number | null;
      price_distributor: number | null;
    }>(`
      select r.id, i.name as product, i.sku, r.version, r.output_qty,
             (select count(*) from recipe_lines rl where rl.recipe_id = r.id)::int as lines,
             rc.unit_material_cost, i.price_distributor
        from recipes r
        join items i on i.id = r.product_item_id
        left join v_recipe_cost rc on rc.recipe_id = r.id
       order by i.name, r.version desc
    `),
    query<{ id: string; sku: string; name: string }>(
      "select id, sku, name from items where kind in ('finished','semi') and is_active order by name",
    ),
  ]);

  return (
    <>
      <PageHeader
        title="Рецептури"
        subtitle="Скільки сировини йде на варку і скільки продукції з неї виходить"
        action={<LinkButton href="/production">← До виробництва</LinkButton>}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card title="Технологічні карти">
          {recipes.length === 0 ? (
            <Empty>Рецептур ще немає</Empty>
          ) : (
            <Table head={['Продукт', 'Версія', 'Вихід', 'Компонентів', 'Сировина/од.', 'Маржа до ціни']}>
              {recipes.map((r) => {
                const margin =
                  r.price_distributor && r.unit_material_cost
                    ? Math.round(((r.price_distributor - r.unit_material_cost) / r.price_distributor) * 1000) / 10
                    : null;
                return (
                  <Row key={r.id}>
                    <Cell>
                      <Link
                        href={`/production/recipes/${r.id}`}
                        className="font-semibold text-emerald-700 hover:underline"
                      >
                        {r.product}
                      </Link>
                      <div className="text-xs text-emerald-800/50">{r.sku}</div>
                    </Cell>
                    <Cell>v{r.version}</Cell>
                    <Cell align="right">{fmtQty(r.output_qty, 'шт')}</Cell>
                    <Cell align="right">{r.lines}</Cell>
                    <Cell align="right">
                      {r.unit_material_cost ? fmtMoney(r.unit_material_cost) : '—'}
                    </Cell>
                    <Cell align="right">{margin === null ? '—' : `${margin}%`}</Cell>
                  </Row>
                );
              })}
            </Table>
          )}
        </Card>

        <Card title="Нова рецептура">
          <ActionForm action={createRecipe} submitLabel="Створити">
            <Field label="Продукт">
              <select name="product_item_id" required className={inputClass} defaultValue="">
                <option value="" disabled>
                  Оберіть продукт…
                </option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Вихід із варки, шт" hint="Скільки одиниць дає одне завантаження">
              <input name="output_qty" type="number" step="1" min="1" required className={inputClass} />
            </Field>
            <Field label="Примітки">
              <textarea name="notes" rows={3} className={`${inputClass} py-2`} />
            </Field>
          </ActionForm>
          <p className="mt-3 text-xs text-emerald-800/60">
            Нова рецептура на той самий продукт створюється як наступна версія — старі варки
            зберігають свою.
          </p>
        </Card>
      </div>
    </>
  );
}
