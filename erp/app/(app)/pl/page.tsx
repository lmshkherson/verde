import Link from 'next/link';
import { createExpense } from '@/app/actions/finance';
import { ActionForm } from '@/components/action-form';
import { Card, Cell, Empty, Field, inputClass, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { EXPENSE_CATEGORIES, fmtDate, fmtMoney, fmtQty, PRODUCTION_EXPENSE_CATEGORIES } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const monthFmt = new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric' });

/** Рядок звіту: підпис, сума і роль у структурі результату. */
function PlRow({
  label,
  value,
  kind = 'plain',
  hint,
}: {
  label: string;
  value: number;
  kind?: 'plain' | 'minus' | 'subtotal' | 'total';
  hint?: string;
}) {
  const styles = {
    plain: 'text-emerald-950',
    minus: 'text-emerald-950',
    subtotal: 'font-bold text-emerald-900',
    total: 'text-lg font-black',
  };
  const border =
    kind === 'subtotal' || kind === 'total' ? 'border-t border-emerald-900/15 pt-2 mt-1' : '';

  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 ${border}`}>
      <div>
        <span className={styles[kind]}>{label}</span>
        {hint && <div className="text-xs text-emerald-800/50">{hint}</div>}
      </div>
      <span
        className={`tabular-nums ${styles[kind]} ${
          kind === 'total' ? (value >= 0 ? 'text-emerald-700' : 'text-red-600') : ''
        }`}
      >
        {kind === 'minus' ? '−' : ''}
        {fmtMoney(Math.abs(value))}
      </span>
    </div>
  );
}

export default async function ProfitAndLossPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await requireRole(); // лише власник
  const { period } = await searchParams;

  const now = new Date();
  const current = period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const from = `${current}-01`;

  const [pl, opex, expenses, vat, receivable, payable, periods, suppliers, output] = await Promise.all([
    queryOne<{
      revenue_net: number;
      cogs: number;
      gross_profit: number;
      write_offs: number;
      production_costs: number;
      opex: number;
      net_result: number;
    }>(
      `select revenue_net, cogs, gross_profit, write_offs, production_costs, opex, net_result
         from v_pl_monthly
        where legal_entity_id = $1 and period = $2::date`,
      [session.eid, from],
    ),
    query<{ category: string; amount: number }>(
      `select category, sum(amount_net) as amount
         from expenses
        where legal_entity_id = $1
          and spent_on >= $2::date and spent_on < ($2::date + interval '1 month')
        group by category order by sum(amount_net) desc`,
      [session.eid, from],
    ),
    query<{
      id: string;
      spent_on: string;
      category: string;
      description: string | null;
      amount_net: number;
      vat_amount: number;
      supplier: string | null;
    }>(
      `select e.id, e.spent_on, e.category, e.description, e.amount_net, e.vat_amount, s.name as supplier
         from expenses e
         left join suppliers s on s.id = e.supplier_id
        where e.legal_entity_id = $1
          and e.spent_on >= $2::date and e.spent_on < ($2::date + interval '1 month')
        order by e.spent_on desc limit 40`,
      [session.eid, from],
    ),
    queryOne<{ liability: number | null; credit: number | null; payable: number }>(
      `select liability, credit, payable from v_vat_summary
        where legal_entity_id = $1 and period = $2::date`,
      [session.eid, from],
    ),
    queryOne<{ total: number }>(
      `select coalesce(sum(balance_due), 0) as total
         from v_customer_balance_by_entity where legal_entity_id = $1`,
      [session.eid],
    ),
    queryOne<{ total: number }>(
      `select coalesce(sum(balance_due), 0) as total
         from v_supplier_balance where legal_entity_id = $1`,
      [session.eid],
    ),
    query<{ period: string }>(
      'select distinct period from v_pl_monthly where legal_entity_id = $1 order by period desc limit 12',
      [session.eid],
    ),
    query<{ id: string; name: string }>('select id, name from suppliers where is_active order by name'),
    // Управлінська оцінка: скільки цех коштує на одиницю випуску цього місяця.
    queryOne<{ produced_qty: number; material_cost: number }>(
      `select coalesce(sum(po.produced_qty), 0) as produced_qty,
              coalesce(sum(ac.material_cost), 0) as material_cost
         from production_orders po
         join v_production_actual_cost ac on ac.production_order_id = po.id
        where po.legal_entity_id = $1 and po.status = 'done'
          and po.finished_at >= $2::date and po.finished_at < ($2::date + interval '1 month')`,
      [session.eid, from],
    ),
  ]);

  const p = pl ?? {
    revenue_net: 0,
    cogs: 0,
    gross_profit: 0,
    write_offs: 0,
    production_costs: 0,
    opex: 0,
    net_result: 0,
  };
  const grossPct = p.revenue_net > 0 ? Math.round((p.gross_profit / p.revenue_net) * 1000) / 10 : 0;

  // Витрати цеху не сидять у вартості партії, тож для ціноутворення показуємо їх
  // рознесеними на випуск — інакше легко недооцінити реальну вартість продукту.
  // Виробничі витрати беремо з в'юхи: вона вже враховує і зарплату цеху,
  // і амортизацію виробничого обладнання, а не лише ручні витрати.
  const shopOpex = p.production_costs;
  const otherOpex = p.opex;

  const producedQty = output?.produced_qty ?? 0;
  const materialPerUnit = producedQty > 0 ? (output?.material_cost ?? 0) / producedQty : 0;
  const shopPerUnit = producedQty > 0 ? shopOpex / producedQty : 0;

  return (
    <>
      <PageHeader
        title="Фінансовий результат"
        subtitle={`${session.ename} · ${monthFmt.format(new Date(from))}. Дохід і витрати — без ПДВ`}
      />

      {periods.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {periods.map((row) => {
            const key = String(row.period).slice(0, 7);
            return (
              <Link
                key={key}
                href={`/pl?period=${key}`}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  key === current
                    ? 'bg-emerald-700 text-white'
                    : 'border border-emerald-900/15 bg-white text-emerald-900'
                }`}
              >
                {monthFmt.format(new Date(`${key}-01`))}
              </Link>
            );
          })}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Дохід без ПДВ" value={fmtMoney(p.revenue_net)} />
        <Stat label="Валовий прибуток" value={fmtMoney(p.gross_profit)} hint={`${grossPct}%`} />
        <Stat
          label="Фінансовий результат"
          value={fmtMoney(p.net_result)}
          tone={p.net_result >= 0 ? 'good' : 'danger'}
        />
        <Stat
          label="ПДВ до сплати"
          value={session.vat ? fmtMoney(vat?.payable ?? 0) : '—'}
          hint={session.vat ? 'поза фінрезультатом' : 'не платник'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card title="Звіт про фінансовий результат">
            <PlRow label="Дохід від реалізації" value={p.revenue_net} hint="без ПДВ" />
            <PlRow
              label="Собівартість реалізації"
              value={p.cogs}
              kind="minus"
              hint="сировина й пакування, без ПДВ"
            />
            <PlRow label="Валовий прибуток" value={p.gross_profit} kind="subtotal" />
            <PlRow
              label="Виробничі витрати періоду"
              value={shopOpex}
              kind="minus"
              hint="зарплата, енергія та амортизація цеху — не входять у вартість партії"
            />
            <PlRow label="Списання й втрати" value={p.write_offs} kind="minus" />
            <PlRow label="Інші операційні витрати" value={otherOpex} kind="minus" hint="без ПДВ" />
            <PlRow label="Фінансовий результат" value={p.net_result} kind="total" />

            <div className="mt-5 rounded-xl bg-emerald-50/60 p-3 text-sm text-emerald-900/80">
              <div className="mb-1 font-bold">Довідково — поза фінансовим результатом</div>
              <div className="grid gap-1 sm:grid-cols-2">
                <div className="flex justify-between gap-4">
                  <span>Податкове зобов’язання з ПДВ</span>
                  <span className="tabular-nums">{fmtMoney(vat?.liability ?? 0)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>Податковий кредит</span>
                  <span className="tabular-nums">{fmtMoney(vat?.credit ?? 0)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>Дебіторка (з ПДВ)</span>
                  <span className="tabular-nums">{fmtMoney(receivable?.total ?? 0)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>Кредиторка (з ПДВ)</span>
                  <span className="tabular-nums">{fmtMoney(payable?.total ?? 0)}</span>
                </div>
              </div>
              <p className="mt-2 text-xs text-emerald-800/60">
                ПДВ не є ні доходом, ні витратою — він проходить транзитом. Борги показані станом
                на сьогодні, а не на кінець періоду.
              </p>
            </div>
          </Card>

          {producedQty > 0 && (
            <Card title="Довідково: повна вартість одиниці">
              <p className="mb-3 text-sm text-emerald-800/70">
                В обліку собівартість партії — це лише сировина. Але для ціноутворення варто
                бачити й цех: ось витрати місяця, рознесені на випуск місяця. Це управлінська
                оцінка, у проводки вона не потрапляє.
              </p>
              <Table head={['Показник', 'На одиницю']}>
                <Row>
                  <Cell>Сировина й пакування</Cell>
                  <Cell align="right">{fmtMoney(materialPerUnit)}</Cell>
                </Row>
                <Row>
                  <Cell>
                    Цех, рознесений на випуск
                    <div className="text-xs text-emerald-800/50">
                      {fmtMoney(shopOpex)} на {fmtQty(producedQty, 'шт')}
                    </div>
                  </Cell>
                  <Cell align="right">{fmtMoney(shopPerUnit)}</Cell>
                </Row>
                <Row>
                  <Cell className="font-bold">Повна вартість одиниці</Cell>
                  <Cell align="right" className="font-bold">
                    {fmtMoney(materialPerUnit + shopPerUnit)}
                  </Cell>
                </Row>
              </Table>
            </Card>
          )}

          {opex.length > 0 && (
            <Card title="Операційні витрати за категоріями">
              <Table head={['Категорія', 'Сума без ПДВ', 'Частка від доходу']}>
                {opex.map((o) => (
                  <Row key={o.category}>
                    <Cell className="font-semibold">{EXPENSE_CATEGORIES[o.category] ?? o.category}</Cell>
                    <Cell align="right">{fmtMoney(o.amount)}</Cell>
                    <Cell align="right">
                      {p.revenue_net > 0 ? `${Math.round((o.amount / p.revenue_net) * 1000) / 10}%` : '—'}
                    </Cell>
                  </Row>
                ))}
              </Table>
            </Card>
          )}

          <Card title="Витрати періоду">
            {expenses.length === 0 ? (
              <Empty>Витрат за цей місяць ще не вносили</Empty>
            ) : (
              <Table head={['Дата', 'Категорія', 'Опис', 'Без ПДВ', 'ПДВ']}>
                {expenses.map((e) => (
                  <Row key={e.id}>
                    <Cell>{fmtDate(e.spent_on)}</Cell>
                    <Cell>{EXPENSE_CATEGORIES[e.category] ?? e.category}</Cell>
                    <Cell>
                      {e.description ?? '—'}
                      {e.supplier && <div className="text-xs text-emerald-800/50">{e.supplier}</div>}
                    </Cell>
                    <Cell align="right" className="font-semibold">
                      {fmtMoney(e.amount_net)}
                    </Cell>
                    <Cell align="right">{e.vat_amount > 0 ? fmtMoney(e.vat_amount) : '—'}</Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Card>
        </div>

        <Card title="Додати витрату">
          <ActionForm action={createExpense} submitLabel="Записати витрату">
            <Field label="Категорія">
              <select name="category" required className={inputClass} defaultValue="rent">
                {Object.entries(EXPENSE_CATEGORIES).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Дата">
              <input
                name="spent_on"
                type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
                className={inputClass}
              />
            </Field>
            <Field label="Сума без ПДВ" hint="Саме вона потрапляє у фінансовий результат">
              <input name="amount_net" type="number" step="0.01" min="0" required className={inputClass} />
            </Field>
            <Field
              label="ПДВ"
              hint={session.vat ? 'Піде в податковий кредит, не у витрати' : 'Юрособа не платник ПДВ'}
            >
              <input
                name="vat_amount"
                type="number"
                step="0.01"
                min="0"
                defaultValue="0"
                disabled={!session.vat}
                className={inputClass}
              />
            </Field>
            <Field
              label="Поведінка витрати"
              hint="Змінні ростуть із випуском, постійні — ні. Впливає на розподіл ЗВВ"
            >
              <select name="cost_behavior" className={inputClass} defaultValue="fixed">
                <option value="fixed">Постійна</option>
                <option value="variable">Змінна</option>
              </select>
            </Field>
            <Field label="Опис">
              <input name="description" className={inputClass} placeholder="Оренда цеху, серпень" />
            </Field>
            <Field label="Постачальник" hint="Якщо вказати — сума потрапить у кредиторку">
              <select name="supplier_id" className={inputClass} defaultValue="">
                <option value="">Без прив’язки</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
