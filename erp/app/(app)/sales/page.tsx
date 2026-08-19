import Link from 'next/link';
import { createSalesOrder } from '@/app/actions/sales';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Cell, Empty, Field, inputClass, LinkButton, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { fmtDate, fmtMoney, SO_STATUS } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const statusTone: Record<string, 'gray' | 'amber' | 'green' | 'red' | 'blue'> = {
  draft: 'gray',
  confirmed: 'amber',
  shipped: 'green',
  cancelled: 'red',
};

export default async function SalesPage() {
  const session = await requireRole('sales');

  const [orders, customers, entities] = await Promise.all([
    query<{
      id: string;
      number: string;
      customer_name: string;
      status: string;
      ordered_on: string;
      ship_by: string | null;
      total_amount: number;
      margin: number;
      margin_pct: number;
      balance_due: number;
    }>(`
      select id, number, customer_name, status, ordered_on, ship_by,
             total_amount, margin, margin_pct, balance_due
        from v_sales_orders_full
       where legal_entity_id = $1
       order by
         case status when 'confirmed' then 0 when 'draft' then 1 else 2 end,
         ordered_on desc
       limit 100
    `, [session.eid]),
    query<{ id: string; name: string }>(
      'select id, name from customers where is_active order by name',
    ),
    query<{ id: string; short_name: string; is_vat_payer: boolean }>(
      `select id, short_name, is_vat_payer from legal_entities where is_active order by short_name`,
    ),
  ]);

  const open = orders.filter((o) => o.status === 'confirmed');
  const openAmount = open.reduce((s, o) => s + o.total_amount, 0);
  const debt = orders.reduce((s, o) => s + Math.max(0, o.balance_due), 0);

  return (
    <>
      <PageHeader
        title="Продажі"
        subtitle="Замовлення мереж і дистриб'юторів, відвантаження та оплати"
        action={<LinkButton href="/sales/customers">Клієнти</LinkButton>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Підтверджені замовлення" value={String(open.length)} hint="чекають відвантаження" />
        <Stat label="Сума в роботі" value={fmtMoney(openAmount)} />
        <Stat label="Дебіторка" value={fmtMoney(debt)} tone={debt > 0 ? 'warn' : 'good'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card title="Замовлення">
          {orders.length === 0 ? (
            <Empty>Замовлень ще немає</Empty>
          ) : (
            <Table head={['Номер', 'Клієнт', 'Сума з ПДВ', 'Маржа', 'Борг', 'Статус']}>
              {orders.map((o) => (
                <Row key={o.id}>
                  <Cell>
                    <Link href={`/sales/${o.id}`} className="font-semibold text-emerald-700 hover:underline">
                      {o.number}
                    </Link>
                    <div className="text-xs text-emerald-800/50">{fmtDate(o.ordered_on)}</div>
                  </Cell>
                  <Cell>{o.customer_name}</Cell>
                  <Cell align="right">{fmtMoney(o.total_amount)}</Cell>
                  <Cell align="right">
                    {o.status === 'shipped' ? (
                      <>
                        {fmtMoney(o.margin)}
                        <div className="text-xs text-emerald-800/50">{o.margin_pct}%</div>
                      </>
                    ) : (
                      '—'
                    )}
                  </Cell>
                  <Cell align="right">
                    {o.balance_due > 0.01 ? (
                      <span className="font-semibold text-amber-600">{fmtMoney(o.balance_due)}</span>
                    ) : (
                      '—'
                    )}
                  </Cell>
                  <Cell>
                    <Badge tone={statusTone[o.status]}>{SO_STATUS[o.status]}</Badge>
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Нове замовлення">
          {customers.length === 0 ? (
            <Empty>
              Спершу заведіть клієнта
            </Empty>
          ) : (
            <ActionForm action={createSalesOrder} submitLabel="Створити замовлення">
                <Field label="Юрособа" hint="від кого продаємо — накладні й ПДВ підуть від неї">
                  <select name="entity_id" className={inputClass} defaultValue={session.eid}>
                    {entities.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.short_name} · {e.is_vat_payer ? 'з ПДВ' : 'без ПДВ'}
                      </option>
                    ))}
                  </select>
                </Field>
              <Field label="Клієнт">
                <select name="customer_id" required className={inputClass} defaultValue="">
                  <option value="" disabled>
                    Оберіть клієнта…
                  </option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Відвантажити до">
                <input name="ship_by" type="date" className={inputClass} />
              </Field>
              <Field label="Примітка">
                <input name="note" className={inputClass} />
              </Field>
            </ActionForm>
          )}
          <p className="mt-3 text-xs text-emerald-800/60">
            Ціни підставляться з прайсу за рівнем клієнта — дистриб’ютор, мережа чи РРЦ.
          </p>
        </Card>
      </div>
    </>
  );
}
