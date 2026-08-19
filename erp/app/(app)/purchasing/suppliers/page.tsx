import Link from 'next/link';
import { createSupplier } from '@/app/actions/purchasing';
import { recordSupplierPayment } from '@/app/actions/finance';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Cell, Empty, Field, inputClass, LinkButton, PageHeader, Row, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { fmtDate, fmtMoney, PAY_METHODS } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ inactive?: string }>;
}) {
  const session = await requireRole('warehouse');
  const showInactive = (await searchParams).inactive === '1';

  const suppliers = await query<{
    id: string;
    name: string;
    edrpou: string | null;
    contact: string | null;
    phone: string | null;
    payment_terms_days: number;
    is_vat_payer: boolean;
    is_active: boolean;
    orders: number;
    billed_gross: number;
    paid_amount: number;
    balance_due: number;
    last_order: string | null;
  }>(
    `select s.id, s.name, s.edrpou, s.contact, s.phone, s.payment_terms_days, s.is_vat_payer, s.is_active,
            (select count(*) from purchase_orders p
              where p.supplier_id = s.id and p.legal_entity_id = $1 and p.status <> 'cancelled')::int as orders,
            (select max(p.ordered_on) from purchase_orders p
              where p.supplier_id = s.id and p.legal_entity_id = $1) as last_order,
            coalesce(b.billed_gross, 0) as billed_gross,
            coalesce(b.paid_amount, 0)  as paid_amount,
            coalesce(b.balance_due, 0)  as balance_due
       from suppliers s
       left join v_supplier_balance b on b.supplier_id = s.id and b.legal_entity_id = $1
      where $2::bool or s.is_active
      order by s.is_active desc, coalesce(b.balance_due, 0) desc, s.name`,
    [session.eid, showInactive],
  );

  return (
    <>
      <PageHeader
        title="Постачальники"
        subtitle="Хто постачає сировину й на яких умовах"
        action={
          <div className="flex gap-2">
            <LinkButton href={showInactive ? '/purchasing/suppliers' : '/purchasing/suppliers?inactive=1'}>
              {showInactive ? 'Лише активні' : 'Показати деактивованих'}
            </LinkButton>
            <LinkButton href="/purchasing/returns">Повернення</LinkButton>
            <LinkButton href="/purchasing">← До закупівель</LinkButton>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card title="Список">
          {suppliers.length === 0 ? (
            <Empty>Постачальників ще немає</Empty>
          ) : (
            <Table head={['Постачальник', 'Контакт', 'Умови', 'Нараховано з ПДВ', 'Сплачено', 'Борг']}>
              {suppliers.map((s) => (
                <Row key={s.id}>
                  <Cell>
                    <Link
                      href={`/purchasing/suppliers/${s.id}`}
                      className="font-semibold text-emerald-800 hover:underline"
                    >
                      {s.name}
                    </Link>
                    {s.edrpou && <div className="text-xs text-emerald-800/50">ЄДРПОУ {s.edrpou}</div>}
                    {!s.is_active && <Badge tone="amber">деактивований</Badge>}
                  </Cell>
                  <Cell>
                    {s.contact ?? '—'}
                    {s.phone && <div className="text-xs text-emerald-800/50">{s.phone}</div>}
                  </Cell>
                  <Cell>
                    <div>
                      {s.payment_terms_days > 0
                        ? `відтермінування ${s.payment_terms_days} дн.`
                        : 'передоплата'}
                    </div>
                    <div className="text-xs text-emerald-800/50">
                      {s.is_vat_payer ? 'платник ПДВ' : 'без ПДВ'}
                    </div>
                  </Cell>
                  <Cell align="right">
                    {fmtMoney(s.billed_gross)}
                    <div className="text-xs text-emerald-800/50">
                      {s.orders} заявок{s.last_order ? ` · ост. ${fmtDate(s.last_order)}` : ''}
                    </div>
                  </Cell>
                  <Cell align="right">{fmtMoney(s.paid_amount)}</Cell>
                  <Cell align="right">
                    {s.balance_due > 0.01 ? (
                      <span className="font-bold text-amber-600">{fmtMoney(s.balance_due)}</span>
                    ) : (
                      '—'
                    )}
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Оплата постачальнику">
            <p className="mb-3 text-sm text-emerald-800/70">
              Сума завжди з ПДВ — зменшує кредиторку. На фінансовий результат оплата не впливає:
              витрати визнані ще на приході.
            </p>
            <ActionForm action={recordSupplierPayment} submitLabel="Записати оплату">
              <Field label="Постачальник">
                <select name="supplier_id" required className={inputClass} defaultValue="">
                  <option value="" disabled>
                    Оберіть…
                  </option>
                  {suppliers.filter((s) => s.is_active).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.balance_due > 0.01 ? ` — борг ${fmtMoney(s.balance_due)}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Сума з ПДВ">
                <input name="amount" type="number" step="0.01" required className={inputClass} />
              </Field>
              <Field label="Дата">
                <input
                  name="paid_on"
                  type="date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  className={inputClass}
                />
              </Field>
              <Field label="Спосіб">
                <select name="method" className={inputClass} defaultValue="bank">
                  {Object.entries(PAY_METHODS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </ActionForm>
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
            <label className="flex items-center gap-2 py-1">
              <input
                name="is_vat_payer"
                type="checkbox"
                defaultChecked
                className="size-5 accent-emerald-700"
              />
              <span className="text-sm font-semibold text-emerald-900">Платник ПДВ</span>
            </label>
            <Field label="Відтермінування оплати, дн.">
              <input name="payment_terms_days" type="number" min="0" defaultValue="0" className={inputClass} />
            </Field>
            <Field label="Примітка">
              <input name="note" className={inputClass} />
            </Field>
          </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
