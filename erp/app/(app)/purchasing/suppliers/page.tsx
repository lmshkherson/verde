import { createSupplier } from '@/app/actions/purchasing';
import { ActionForm } from '@/components/action-form';
import { Card, Cell, Empty, Field, inputClass, LinkButton, PageHeader, Row, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { fmtDate, fmtMoney } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function SuppliersPage() {
  await requireRole('warehouse');

  const suppliers = await query<{
    id: string;
    name: string;
    edrpou: string | null;
    contact: string | null;
    phone: string | null;
    payment_terms_days: number;
    orders: number;
    total_amount: number;
    last_order: string | null;
  }>(`
    select s.id, s.name, s.edrpou, s.contact, s.phone, s.payment_terms_days,
           count(p.id)::int as orders,
           coalesce(sum(t.received_amount), 0) as total_amount,
           max(p.ordered_on) as last_order
      from suppliers s
      left join purchase_orders p on p.supplier_id = s.id and p.status <> 'cancelled'
      left join v_po_totals t on t.po_id = p.id
     where s.is_active
     group by s.id
     order by s.name
  `);

  return (
    <>
      <PageHeader
        title="Постачальники"
        subtitle="Хто постачає сировину й на яких умовах"
        action={<LinkButton href="/purchasing">← До закупівель</LinkButton>}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card title="Список">
          {suppliers.length === 0 ? (
            <Empty>Постачальників ще немає</Empty>
          ) : (
            <Table head={['Постачальник', 'Контакт', 'Умови', 'Заявок', 'Закуплено']}>
              {suppliers.map((s) => (
                <Row key={s.id}>
                  <Cell>
                    <div className="font-semibold">{s.name}</div>
                    {s.edrpou && <div className="text-xs text-emerald-800/50">ЄДРПОУ {s.edrpou}</div>}
                  </Cell>
                  <Cell>
                    {s.contact ?? '—'}
                    {s.phone && <div className="text-xs text-emerald-800/50">{s.phone}</div>}
                  </Cell>
                  <Cell>
                    {s.payment_terms_days > 0 ? `відтермінування ${s.payment_terms_days} дн.` : 'передоплата'}
                  </Cell>
                  <Cell align="right">
                    {s.orders}
                    {s.last_order && (
                      <div className="text-xs text-emerald-800/50">ост. {fmtDate(s.last_order)}</div>
                    )}
                  </Cell>
                  <Cell align="right" className="font-semibold">
                    {fmtMoney(s.total_amount)}
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Новий постачальник">
          <ActionForm action={createSupplier} submitLabel="Додати">
            <Field label="Назва">
              <input name="name" required className={inputClass} />
            </Field>
            <Field label="ЄДРПОУ">
              <input name="edrpou" className={inputClass} />
            </Field>
            <Field label="Контактна особа">
              <input name="contact" className={inputClass} />
            </Field>
            <Field label="Телефон">
              <input name="phone" className={inputClass} />
            </Field>
            <Field label="Відтермінування оплати, дн.">
              <input name="payment_terms_days" type="number" min="0" defaultValue="0" className={inputClass} />
            </Field>
            <Field label="Примітка">
              <input name="note" className={inputClass} />
            </Field>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
