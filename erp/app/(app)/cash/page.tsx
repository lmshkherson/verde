import Link from 'next/link';
import { createCashOrder, deleteCashOrder } from '@/app/actions/cash';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Cell, Empty, Field, inputClass, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { EXPENSE_CATEGORIES, fmtDate, fmtMoney } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const KIND_LABELS: Record<string, string> = {
  customer_payment: 'Оплата від покупця',
  supplier_payment: 'Оплата постачальнику',
  expense: 'Господарська витрата',
  other: 'Інше',
};

export default async function CashPage() {
  const session = await requireRole('sales', 'warehouse');

  const [balanceRow, orders, looseRows, customers, suppliers, entities] = await Promise.all([
    queryOne<{ balance: number }>(
      `select
         coalesce((select sum(case when direction = 'in' then amount else -amount end)
                     from cash_orders where legal_entity_id = $1), 0)
       + coalesce((select sum(p.amount) from payments p
                    where p.legal_entity_id = $1 and p.method = 'cash'
                      and not exists (select 1 from cash_orders o where o.payment_id = p.id)), 0)
       - coalesce((select sum(sp.amount) from supplier_payments sp
                    where sp.legal_entity_id = $1 and sp.method = 'cash'
                      and not exists (select 1 from cash_orders o where o.supplier_payment_id = sp.id)), 0)
         as balance`,
      [session.eid],
    ),
    query<{
      id: string;
      number: string;
      direction: string;
      kind: string;
      occurred_on: string | Date;
      amount: number;
      person: string | null;
      purpose: string | null;
      counterparty: string | null;
    }>(
      `select o.id, o.number, o.direction, o.kind, o.occurred_on, o.amount, o.person, o.purpose,
              coalesce(c.name, s.name) as counterparty
         from cash_orders o
         left join customers c on c.id = o.customer_id
         left join suppliers s on s.id = o.supplier_id
        where o.legal_entity_id = $1
        order by o.occurred_on desc, o.created_at desc
        limit 80`,
      [session.eid],
    ),
    // Готівкові оплати, записані без ордера (кнопкою на замовленні).
    query<{ day: string | Date; amount: number; who: string; direction: string }>(
      `select p.paid_on as day, p.amount, c.name as who, 'in' as direction
         from payments p join customers c on c.id = p.customer_id
        where p.legal_entity_id = $1 and p.method = 'cash'
          and not exists (select 1 from cash_orders o where o.payment_id = p.id)
       union all
       select sp.paid_on, sp.amount, s.name, 'out'
         from supplier_payments sp join suppliers s on s.id = sp.supplier_id
        where sp.legal_entity_id = $1 and sp.method = 'cash'
          and not exists (select 1 from cash_orders o where o.supplier_payment_id = sp.id)
        order by day desc
        limit 30`,
      [session.eid],
    ),
    query<{ id: string; name: string }>('select id, name from customers where is_active order by name'),
    query<{ id: string; name: string }>('select id, name from suppliers where is_active order by name'),
    query<{ id: string; short_name: string; is_vat_payer: boolean }>(
      'select id, short_name, is_vat_payer from legal_entities where is_active order by short_name',
    ),
  ]);

  const monthIn = orders
    .filter((o) => o.direction === 'in')
    .reduce((s, o) => s + Number(o.amount), 0);
  const monthOut = orders
    .filter((o) => o.direction === 'out')
    .reduce((s, o) => s + Number(o.amount), 0);

  return (
    <>
      <PageHeader
        title="Каса"
        subtitle="Прибуткові й видаткові касові ордери; гроші лягають у ті самі розрахунки, що й банк"
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          label="Залишок у касі"
          value={fmtMoney(balanceRow?.balance)}
          tone={Number(balanceRow?.balance ?? 0) < -0.005 ? 'danger' : 'default'}
          hint={Number(balanceRow?.balance ?? 0) < -0.005 ? 'каса не може бути від’ємною — перевірте ордери' : undefined}
        />
        <Stat label="Надходження (останні)" value={fmtMoney(monthIn)} />
        <Stat label="Видатки (останні)" value={fmtMoney(monthOut)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card title="Касова книга">
            {orders.length === 0 ? (
              <Empty>Ордерів ще не було</Empty>
            ) : (
              <Table head={['Ордер', 'Операція', 'Сума', '']}>
                {orders.map((o) => (
                  <Row key={o.id}>
                    <Cell>
                      <Link
                        href={`/cash/${o.id}/print`}
                        className="font-semibold text-emerald-800 hover:underline"
                      >
                        {o.number}
                      </Link>
                      <div className="text-xs text-emerald-800/50">{fmtDate(o.occurred_on)}</div>
                    </Cell>
                    <Cell>
                      {KIND_LABELS[o.kind]}
                      <div className="text-xs text-emerald-800/50">
                        {o.counterparty ?? o.person ?? o.purpose ?? '—'}
                      </div>
                    </Cell>
                    <Cell align="right">
                      <span className={o.direction === 'in' ? 'font-semibold text-emerald-700' : 'font-semibold text-red-600'}>
                        {o.direction === 'in' ? '+' : '−'}{fmtMoney(o.amount)}
                      </span>
                    </Cell>
                    <Cell align="right">
                      <form action={deleteCashOrder}>
                        <input type="hidden" name="cash_order_id" value={o.id} />
                        <button className="text-xs font-semibold text-red-600 hover:underline">
                          Видалити
                        </button>
                      </form>
                    </Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Card>

          {looseRows.length > 0 && (
            <Card title="Готівкові оплати без ордера">
              <p className="mb-3 text-sm text-emerald-800/70">
                Записані кнопкою «Записати оплату» з методом «Готівка». Вони входять у залишок
                каси; щоб мати первинний документ, надалі оформлюйте такі гроші ордером тут.
              </p>
              <Table head={['Дата', 'Контрагент', 'Сума']}>
                {looseRows.map((r, i) => (
                  <Row key={i}>
                    <Cell>{fmtDate(r.day)}</Cell>
                    <Cell>{r.who}</Cell>
                    <Cell align="right">
                      <span className={r.direction === 'in' ? 'text-emerald-700' : 'text-red-600'}>
                        {r.direction === 'in' ? '+' : '−'}{fmtMoney(r.amount)}
                      </span>
                    </Cell>
                  </Row>
                ))}
              </Table>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Новий ордер">
            <ActionForm action={createCashOrder} submitLabel="Виписати ордер">
              <Field label="Юрособа" hint="чия каса — в кожної юрособи своя">
                <select name="entity_id" className={inputClass} defaultValue={session.eid}>
                  {entities.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.short_name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Напрям">
                  <select name="direction" className={inputClass} defaultValue="in">
                    <option value="in">ПКО — надходження</option>
                    <option value="out">ВКО — видача</option>
                  </select>
                </Field>
                <Field label="Тип операції">
                  <select name="kind" className={inputClass} defaultValue="customer_payment">
                    <option value="customer_payment">Оплата від покупця (ПКО)</option>
                    <option value="supplier_payment">Оплата постачальнику (ВКО)</option>
                    <option value="expense">Господарська витрата (ВКО)</option>
                    <option value="other">Інше</option>
                  </select>
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Сума">
                  <input name="amount" type="number" step="0.01" min="0.01" required className={inputClass} />
                </Field>
                <Field label="Дата">
                  <input
                    name="occurred_on"
                    type="date"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    className={inputClass}
                  />
                </Field>
              </div>
              <Field label="Клієнт" hint="для оплати від покупця">
                <select name="customer_id" className={inputClass} defaultValue="">
                  <option value="">—</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Постачальник" hint="для оплати постачальнику">
                <select name="supplier_id" className={inputClass} defaultValue="">
                  <option value="">—</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Стаття витрат" hint="для господарської витрати">
                <select name="category" className={inputClass} defaultValue="other">
                  {Object.entries(EXPENSE_CATEGORIES).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Прийнято від / видано (ПІБ)" hint="друкується в ордері">
                <input name="person" className={inputClass} placeholder="Мельник Т.С." />
              </Field>
              <Field label="Підстава">
                <input name="purpose" className={inputClass} placeholder="Оплата за замовленням №…" />
              </Field>
            </ActionForm>
          </Card>

          <Card title="Як це працює">
            <p className="text-sm text-emerald-800/70">
              Ордер створює той самий фінансовий запис, що і банк: оплата покупця зменшує його
              борг (видно на замовленні), оплата постачальнику — кредиторку, а господарська
              витрата одразу лягає у фінрезультат за своєю статтею.
            </p>
            <p className="mt-3 text-sm text-emerald-800/70">
              У проводках готівка живе на рахунку 301 — залишок каси видно і в оборотці.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
