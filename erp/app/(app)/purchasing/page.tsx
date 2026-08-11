import Link from 'next/link';
import { createPurchaseOrder } from '@/app/actions/purchasing';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Cell, Empty, Field, inputClass, LinkButton, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { fmtDate, fmtMoney, fmtQty, PO_STATUS } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const statusTone: Record<string, 'gray' | 'amber' | 'green' | 'red'> = {
  draft: 'gray',
  ordered: 'amber',
  received: 'green',
  cancelled: 'red',
};

export default async function PurchasingPage() {
  const session = await requireRole('warehouse');

  const [orders, suppliers, shortages, entities] = await Promise.all([
    query<{
      id: string;
      number: string;
      supplier: string;
      status: string;
      ordered_on: string;
      expected_on: string | null;
      total_amount: number;
      received_qty: number;
      total_qty: number;
    }>(`
      select p.id, p.number, s.name as supplier, p.status, p.ordered_on, p.expected_on,
             t.total_amount, t.received_qty, t.total_qty
        from purchase_orders p
        join suppliers s on s.id = p.supplier_id
        left join v_po_totals t on t.po_id = p.id
       where p.legal_entity_id = $1
       order by
         case p.status when 'ordered' then 0 when 'draft' then 1 else 2 end,
         p.ordered_on desc
       limit 100
    `, [session.eid]),
    query<{ id: string; name: string }>('select id, name from suppliers where is_active order by name'),
    query<{ sku: string; name: string; qty: number; min_stock: number; unit: string }>(
      "select sku, name, qty, min_stock, unit from v_low_stock where kind in ('raw','packaging') order by qty / nullif(min_stock, 0)",
    ),
    query<{ id: string; short_name: string; is_vat_payer: boolean }>(
      `select id, short_name, is_vat_payer from legal_entities where is_active order by short_name`,
    ),
  ]);

  const inTransit = orders.filter((o) => o.status === 'ordered');

  return (
    <>
      <PageHeader
        title="Закупівлі"
        subtitle="Заявки постачальникам і оприбуткування сировини"
        action={<LinkButton href="/purchasing/suppliers">Постачальники</LinkButton>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Заявок у дорозі" value={String(inTransit.length)} />
        <Stat
          label="Сума в дорозі"
          value={fmtMoney(inTransit.reduce((s, o) => s + o.total_amount, 0))}
        />
        <Stat
          label="Позицій у дефіциті"
          value={String(shortages.length)}
          tone={shortages.length > 0 ? 'danger' : 'good'}
        />
      </div>

      {shortages.length > 0 && (
        <div className="mb-4">
          <Card title="Треба закупити">
            <Table head={['Позиція', 'Залишок', 'Мінімум', 'Дозамовити']}>
              {shortages.map((s) => (
                <Row key={s.sku}>
                  <Cell>
                    <div className="font-semibold">{s.name}</div>
                    <div className="text-xs text-emerald-800/50">{s.sku}</div>
                  </Cell>
                  <Cell align="right" className="font-semibold text-red-600">
                    {fmtQty(s.qty, s.unit)}
                  </Cell>
                  <Cell align="right">{fmtQty(s.min_stock, s.unit)}</Cell>
                  <Cell align="right" className="font-semibold">
                    {fmtQty(Math.max(0, s.min_stock - s.qty), s.unit)}
                  </Cell>
                </Row>
              ))}
            </Table>
          </Card>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card title="Заявки">
          {orders.length === 0 ? (
            <Empty>Заявок ще немає</Empty>
          ) : (
            <Table head={['Номер', 'Постачальник', 'Сума', 'Прийнято', 'Статус']}>
              {orders.map((o) => (
                <Row key={o.id}>
                  <Cell>
                    <Link href={`/purchasing/${o.id}`} className="font-semibold text-emerald-700 hover:underline">
                      {o.number}
                    </Link>
                    <div className="text-xs text-emerald-800/50">
                      {o.expected_on ? `очікуємо ${fmtDate(o.expected_on)}` : fmtDate(o.ordered_on)}
                    </div>
                  </Cell>
                  <Cell>{o.supplier}</Cell>
                  <Cell align="right">{fmtMoney(o.total_amount)}</Cell>
                  <Cell align="right">
                    {fmtQty(o.received_qty)} / {fmtQty(o.total_qty)}
                  </Cell>
                  <Cell>
                    <Badge tone={statusTone[o.status]}>{PO_STATUS[o.status]}</Badge>
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Нова заявка">
          {suppliers.length === 0 ? (
            <Empty>Спершу додайте постачальника</Empty>
          ) : (
            <ActionForm action={createPurchaseOrder} submitLabel="Створити заявку">
                <Field label="Юрособа" hint="від кого оформлюється документ — визначає номер і ПДВ">
                  <select name="entity_id" className={inputClass} defaultValue={session.eid}>
                    {entities.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.short_name} · {e.is_vat_payer ? 'з ПДВ' : 'без ПДВ'}
                      </option>
                    ))}
                  </select>
                </Field>
              <Field label="Постачальник">
                <select name="supplier_id" required className={inputClass} defaultValue="">
                  <option value="" disabled>
                    Оберіть постачальника…
                  </option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Очікувана дата">
                <input name="expected_on" type="date" className={inputClass} />
              </Field>
              <Field label="Примітка">
                <input name="note" className={inputClass} />
              </Field>
              <label className="flex items-center gap-2 py-1">
                <input
                  name="prices_include_vat"
                  type="checkbox"
                  defaultChecked
                  className="size-5 accent-emerald-700"
                />
                <span className="text-sm font-semibold text-emerald-900">Ціни вказані з ПДВ</span>
              </label>
            </ActionForm>
          )}
        </Card>
      </div>
    </>
  );
}
