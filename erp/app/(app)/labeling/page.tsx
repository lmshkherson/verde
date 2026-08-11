import Link from 'next/link';
import { Badge, Card, Cell, Empty, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function LabelingPage() {
  await requireRole('production', 'sales');

  const [products, gaps] = await Promise.all([
    query<{
      id: string;
      sku: string;
      name: string;
      weight_g: number | null;
      spec_version: number | null;
      approved_on: string | null;
      recipe_changed: boolean | null;
      has_recipe: boolean;
    }>(
      `select i.id, i.sku, i.name, i.weight_g,
              s.version as spec_version, s.approved_on, s.recipe_changed,
              exists (select 1 from recipes r where r.product_item_id = i.id and r.is_active
                        and r.approved_at is not null) as has_recipe
         from items i
         left join v_current_spec s on s.item_id = i.id
        where i.kind in ('finished', 'semi') and i.is_active
        order by i.name`,
    ),
    // Сировина без поживних даних — саме вона блокує затвердження специфікацій.
    query<{ id: string; name: string; sku: string }>(
      `select id, name, sku from items
        where kind in ('raw', 'semi') and is_active
          and (protein_100 is null or fat_100 is null or carbs_100 is null)
        order by name`,
    ),
  ]);

  const approved = products.filter((p) => p.spec_version !== null && !p.recipe_changed).length;
  const stale = products.filter((p) => p.recipe_changed).length;

  return (
    <>
      <PageHeader
        title="Маркування"
        subtitle="Харчова цінність із рецептури, склад, алергени й макет етикетки"
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Продуктів" value={String(products.length)} />
        <Stat label="Специфікацій чинних" value={String(approved)} tone={approved > 0 ? 'good' : 'default'} />
        <Stat
          label="Застарілих"
          value={String(stale)}
          hint="рецептуру змінили після затвердження"
          tone={stale > 0 ? 'danger' : 'good'}
        />
        <Stat
          label="Сировини без даних"
          value={String(gaps.length)}
          hint="блокує розрахунок"
          tone={gaps.length > 0 ? 'warn' : 'good'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card title="Продукція">
          {products.length === 0 ? (
            <Empty>Готової продукції ще немає</Empty>
          ) : (
            <Table head={['Продукт', 'Вага', 'Специфікація', 'Стан']}>
              {products.map((p) => (
                <Row key={p.id}>
                  <Cell>
                    <Link
                      href={`/labeling/${p.id}`}
                      className="font-semibold text-emerald-800 hover:underline"
                    >
                      {p.name}
                    </Link>
                    <div className="text-xs text-emerald-800/50">{p.sku}</div>
                  </Cell>
                  <Cell align="right">{p.weight_g ? `${p.weight_g} г` : '—'}</Cell>
                  <Cell>
                    {p.spec_version ? (
                      <>
                        <div className="text-sm">версія {p.spec_version}</div>
                        <div className="text-xs text-emerald-800/50">{fmtDate(p.approved_on)}</div>
                      </>
                    ) : (
                      '—'
                    )}
                  </Cell>
                  <Cell>
                    {!p.has_recipe ? (
                      <Badge tone="gray">немає рецептури</Badge>
                    ) : p.recipe_changed ? (
                      <Badge tone="red">застаріла</Badge>
                    ) : p.spec_version ? (
                      <Badge tone="green">чинна</Badge>
                    ) : (
                      <Badge tone="amber">не затверджена</Badge>
                    )}
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Звідки беруться цифри">
            <p className="text-sm text-emerald-800/70">
              Склад і харчова цінність рахуються з рецептури: скільки чого закладено проти
              фактичного виходу варки. Різниця між ними — випарувана волога, і саме тому в
              готовому продукті показники концентрованіші за суму сировини.
            </p>
            <p className="mt-3 text-sm text-emerald-800/70">
              Енергетична цінність не сумується з ккал інгредієнтів, а рахується з білків, жирів,
              вуглеводів і волокон за нормативними коефіцієнтами. Так вимагає закон — і так на
              етикетці немає розбіжності між таблицею та підсумком.
            </p>
          </Card>

          {gaps.length > 0 && (
            <Card title="Сировина без поживних даних">
              <p className="mb-3 text-sm text-emerald-800/70">
                Поки в інгредієнта немає білків, жирів і вуглеводів, специфікація продукту з ним
                не затвердиться. Дані беруться зі специфікації постачальника або з протоколу
                досліджень — вигадувати їх не можна.
              </p>
              <ul className="space-y-1">
                {gaps.map((g) => (
                  <li key={g.id}>
                    <Link
                      href={`/catalog/${g.id}`}
                      className="text-sm font-semibold text-emerald-700 hover:underline"
                    >
                      {g.name}
                    </Link>
                    <span className="ml-2 text-xs text-emerald-800/50">{g.sku}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
