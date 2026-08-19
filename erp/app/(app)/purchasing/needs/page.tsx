import { createOrdersFromNeeds } from '@/app/actions/purchasing';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Cell, Empty, Field, inputClass, LinkButton, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { fmtMoney, fmtQty, unitLabel } from '@/lib/format';
import { purchaseNeeds } from '@/lib/needs';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Потреби в закупівлі: скільки бракує з урахуванням варок і мінімумів. */
export default async function PurchaseNeedsPage() {
  const session = await requireRole('warehouse');

  const [needs, entities] = await Promise.all([
    purchaseNeeds(),
    query<{ id: string; short_name: string }>(
      'select id, short_name from legal_entities where is_active order by short_name',
    ),
  ]);

  const short = needs.filter((n) => n.shortage > 0.0005);
  const withSupplier = short.filter((n) => n.supplier_id);
  const noSupplier = short.filter((n) => !n.supplier_id);
  const estimate = withSupplier.reduce(
    (s, n) => s + n.shortage * Number(n.last_price ?? 0),
    0,
  );

  return (
    <>
      <PageHeader
        title="Потреби в закупівлі"
        subtitle="Відкриті варки + мінімальні залишки − склад групи − уже замовлене"
        action={<LinkButton href="/purchasing">← До закупівель</LinkButton>}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          label="Позицій у дефіциті"
          value={String(short.length)}
          tone={short.length > 0 ? 'warn' : 'good'}
        />
        <Stat label="Орієнтовна сума закупівлі" value={fmtMoney(estimate)} hint="за останніми цінами" />
        <Stat
          label="Без відомого постачальника"
          value={String(noSupplier.length)}
          hint="цих позицій ще не купували — заявку створіть вручну"
          tone={noSupplier.length > 0 ? 'warn' : 'good'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card title="Дефіцити">
          {short.length === 0 ? (
            <Empty>Дефіцитів немає — запасів вистачає на відкриті варки й мінімуми</Empty>
          ) : (
            <Table head={['Позиція', 'Доступно', 'Під варки', 'Мінімум', 'У дорозі', 'Дефіцит', 'Постачальник']}>
              {short.map((n) => (
                <Row key={n.item_id}>
                  <Cell>
                    <div className="font-semibold">{n.name}</div>
                    <div className="text-xs text-emerald-800/50">{n.sku}</div>
                  </Cell>
                  <Cell align="right">{fmtQty(n.available, unitLabel(n.unit))}</Cell>
                  <Cell align="right">{fmtQty(n.production_need)}</Cell>
                  <Cell align="right">{fmtQty(n.min_stock)}</Cell>
                  <Cell align="right">{fmtQty(n.on_order)}</Cell>
                  <Cell align="right">
                    <span className="font-bold text-red-600">{fmtQty(n.shortage, unitLabel(n.unit))}</span>
                  </Cell>
                  <Cell>
                    {n.supplier_name ?? <Badge tone="amber">не купували</Badge>}
                    {n.last_price != null && (
                      <div className="text-xs text-emerald-800/50">
                        остання ціна {fmtMoney(n.last_price)}
                      </div>
                    )}
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Створити заявки">
            <p className="mb-3 text-sm text-emerald-800/70">
              Одна чернетка на кожного постачальника останньої закупівлі: кількість — рівно
              дефіцит, ціна — остання. Чернетки можна відредагувати перед відправкою.
            </p>
            <ActionForm action={createOrdersFromNeeds} submitLabel="Створити чернетки заявок">
              <Field label="Юрособа" hint="від кого підуть заявки">
                <select name="entity_id" className={inputClass} defaultValue={session.eid}>
                  {entities.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.short_name}
                    </option>
                  ))}
                </select>
              </Field>
            </ActionForm>
          </Card>

          <Card title="Звідки цифри">
            <p className="text-sm text-emerald-800/70">
              <strong>Під варки</strong> — сировина за рецептами відкритих виробничих замовлень
              (заплановані й у роботі), з урахуванням відсотка втрат.
            </p>
            <p className="mt-3 text-sm text-emerald-800/70">
              <strong>Мінімум</strong> — поле «мінімальний залишок» у картці номенклатури: страховий
              запас, нижче якого падати не можна.
            </p>
            <p className="mt-3 text-sm text-emerald-800/70">
              <strong>У дорозі</strong> — незакриті заявки постачальникам: чернетки й замовлене,
              що ще не приїхало.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
