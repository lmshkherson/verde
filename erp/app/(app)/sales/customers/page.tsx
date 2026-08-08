import { createCustomer } from '@/app/actions/sales';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Cell, Empty, Field, inputClass, LinkButton, PageHeader, Row, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { CUSTOMER_KINDS, fmtMoney, PRICE_LEVELS } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  await requireRole('sales');

  const customers = await query<{
    id: string;
    name: string;
    kind: string;
    contact: string | null;
    phone: string | null;
    price_level: string;
    payment_terms_days: number;
    credit_limit: number;
    shipped_amount: number;
    paid_amount: number;
    balance_due: number;
  }>(`
    select c.id, c.name, c.kind, c.contact, c.phone, c.price_level,
           c.payment_terms_days, c.credit_limit,
           b.shipped_amount, b.paid_amount, b.balance_due
      from customers c
      join v_customer_balance b on b.customer_id = c.id
     where c.is_active
     order by b.balance_due desc, c.name
  `);

  return (
    <>
      <PageHeader
        title="Клієнти"
        subtitle="Мережі, дистриб'ютори, аптеки — з умовами оплати й поточним боргом"
        action={<LinkButton href="/sales">← До продажів</LinkButton>}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card title="База клієнтів">
          {customers.length === 0 ? (
            <Empty>Клієнтів ще немає</Empty>
          ) : (
            <Table head={['Клієнт', 'Тип', 'Прайс', 'Відвантажено', 'Оплачено', 'Борг']}>
              {customers.map((c) => {
                const overLimit = c.credit_limit > 0 && c.balance_due > c.credit_limit;
                return (
                  <Row key={c.id}>
                    <Cell>
                      <div className="font-semibold">{c.name}</div>
                      <div className="text-xs text-emerald-800/50">
                        {c.contact ?? '—'}
                        {c.phone ? ` · ${c.phone}` : ''}
                      </div>
                    </Cell>
                    <Cell>
                      <Badge>{CUSTOMER_KINDS[c.kind]}</Badge>
                    </Cell>
                    <Cell>
                      <div className="text-xs">{PRICE_LEVELS[c.price_level]}</div>
                      {c.payment_terms_days > 0 && (
                        <div className="text-xs text-emerald-800/50">
                          відтермінування {c.payment_terms_days} дн.
                        </div>
                      )}
                    </Cell>
                    <Cell align="right">{fmtMoney(c.shipped_amount)}</Cell>
                    <Cell align="right">{fmtMoney(c.paid_amount)}</Cell>
                    <Cell align="right">
                      {c.balance_due > 0.01 ? (
                        <>
                          <span className={overLimit ? 'font-bold text-red-600' : 'font-semibold text-amber-600'}>
                            {fmtMoney(c.balance_due)}
                          </span>
                          {overLimit && <div className="text-xs text-red-600">понад ліміт</div>}
                        </>
                      ) : (
                        '—'
                      )}
                    </Cell>
                  </Row>
                );
              })}
            </Table>
          )}
        </Card>

        <Card title="Новий клієнт">
          <ActionForm action={createCustomer} submitLabel="Додати клієнта">
            <Field label="Назва">
              <input name="name" required className={inputClass} placeholder="АТБ-Маркет" />
            </Field>
            <Field label="Тип">
              <select name="kind" className={inputClass} defaultValue="network">
                {Object.entries(CUSTOMER_KINDS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Рівень цін">
              <select name="price_level" className={inputClass} defaultValue="distributor">
                {Object.entries(PRICE_LEVELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
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
            <div className="grid grid-cols-2 gap-3">
              <Field label="Відтермінування, дн.">
                <input name="payment_terms_days" type="number" min="0" defaultValue="0" className={inputClass} />
              </Field>
              <Field label="Кредитний ліміт">
                <input name="credit_limit" type="number" step="0.01" min="0" defaultValue="0" className={inputClass} />
              </Field>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
