import Link from 'next/link';
import { createCustomer } from '@/app/actions/sales';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Cell, Empty, Field, inputClass, LinkButton, PageHeader, Row, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { SALES_CHANNELS, fmtMoney } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ inactive?: string }>;
}) {
  await requireRole('sales');
  const showInactive = (await searchParams).inactive === '1';

  const customers = await query<{
    id: string;
    name: string;
    channel: string;
    contact: string | null;
    phone: string | null;
    payment_terms_days: number;
    credit_limit: number;
    is_active: boolean;
    shipped_amount: number;
    paid_amount: number;
    balance_due: number;
  }>(
    `select c.id, c.name, c.channel, c.contact, c.phone,
            c.payment_terms_days, c.credit_limit, c.is_active,
            b.shipped_amount, b.paid_amount, b.balance_due
       from customers c
       join v_customer_balance b on b.customer_id = c.id
      where $1::bool or c.is_active
      order by c.is_active desc, b.balance_due desc, c.name`,
    [showInactive],
  );

  return (
    <>
      <PageHeader
        title="Клієнти"
        subtitle="Мережі, дистриб'ютори, аптеки — з умовами оплати й поточним боргом"
        action={
          <div className="flex gap-2">
            <LinkButton href={showInactive ? '/sales/customers' : '/sales/customers?inactive=1'}>
              {showInactive ? 'Лише активні' : 'Показати деактивованих'}
            </LinkButton>
            <LinkButton href="/sales">← До продажів</LinkButton>
          </div>
        }
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
                      <Link
                        href={`/sales/customers/${c.id}`}
                        className="font-semibold text-emerald-800 hover:underline"
                      >
                        {c.name}
                      </Link>
                      <div className="text-xs text-emerald-800/50">
                        {c.contact ?? '—'}
                        {c.phone ? ` · ${c.phone}` : ''}
                      </div>
                    </Cell>
                    <Cell>
                      <Badge>{SALES_CHANNELS[c.channel] ?? c.channel}</Badge>
                      {!c.is_active && (
                        <div className="mt-0.5">
                          <Badge tone="amber">деактивований</Badge>
                        </div>
                      )}
                    </Cell>
                    <Cell>
                      
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
            <Field label="Канал продажу" hint="визначає і аналітику, і прайс — ціни в номенклатурі діляться по каналах">
              <select name="channel" className={inputClass} defaultValue="small_wholesale">
                {Object.entries(SALES_CHANNELS).map(([key, label]) => (
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
