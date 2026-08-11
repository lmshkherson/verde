import Link from 'next/link';
import { notFound } from 'next/navigation';
import { setCustomerActive, updateCustomer } from '@/app/actions/sales';
import { ActionForm } from '@/components/action-form';
import { Alert, Badge, Card, Cell, Empty, Field, inputClass, LinkButton, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { SALES_CHANNELS, fmtDate, fmtMoney, SO_STATUS } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function CustomerEditPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  await requireRole('sales');
  const { customerId } = await params;

  const customer = await queryOne<{
    id: string;
    name: string;
    channel: string;
    edrpou: string | null;
    ipn: string | null;
    is_vat_payer: boolean;
    contact: string | null;
    phone: string | null;
    payment_terms_days: number;
    credit_limit: number;
    address: string | null;
    delivery_address: string | null;
    iban: string | null;
    bank_name: string | null;
    note: string | null;
    is_active: boolean;
    legal_entity_id: string | null;
    own_entity: string | null;
    shipped_amount: number;
    paid_amount: number;
    balance_due: number;
  }>(
    `select c.*, e.short_name as own_entity,
            coalesce(b.shipped_amount, 0) as shipped_amount,
            coalesce(b.paid_amount, 0)    as paid_amount,
            coalesce(b.balance_due, 0)    as balance_due
       from customers c
       left join legal_entities e on e.id = c.legal_entity_id
       left join v_customer_balance b on b.customer_id = c.id
      where c.id = $1`,
    [customerId],
  );
  if (!customer) notFound();

  const orders = await query<{
    id: string;
    number: string;
    ordered_on: string;
    status: string;
    shipped_amount: number;
  }>(
    `select o.id, o.number, o.ordered_on, o.status, coalesce(t.shipped_amount, 0) as shipped_amount
       from sales_orders o
       left join v_so_totals t on t.so_id = o.id
      where o.customer_id = $1
      order by o.ordered_on desc, o.number desc
      limit 15`,
    [customerId],
  );

  return (
    <>
      <PageHeader
        title={customer.name}
        subtitle={SALES_CHANNELS[customer.channel] ?? customer.channel}
        action={<LinkButton href="/sales/customers">← До клієнтів</LinkButton>}
      />

      {!customer.is_active && (
        <div className="mb-4">
          <Alert tone="amber">
            Клієнт деактивований: нові замовлення на нього оформити не можна, історія збережена.
          </Alert>
        </div>
      )}

      {customer.own_entity && (
        <div className="mb-4">
          <Alert tone="green">
            Це наша юрособа «{customer.own_entity}». Продаж їй одночасно оприбутковує товар у неї —
            налаштовується на сторінці{' '}
            <Link href="/entities" className="underline">
              Юрособи
            </Link>
            .
          </Alert>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Відвантажено" value={fmtMoney(customer.shipped_amount)} hint="з ПДВ" />
        <Stat label="Оплачено" value={fmtMoney(customer.paid_amount)} />
        <Stat
          label="Борг"
          value={fmtMoney(customer.balance_due)}
          tone={
            customer.credit_limit > 0 && customer.balance_due > customer.credit_limit
              ? 'danger'
              : customer.balance_due > 0.01
                ? 'warn'
                : 'default'
          }
          hint={customer.credit_limit > 0 ? `ліміт ${fmtMoney(customer.credit_limit)}` : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card title="Редагування">
            <ActionForm action={updateCustomer} submitLabel="Зберегти">
              <input type="hidden" name="customer_id" value={customer.id} />
              <Field label="Назва">
                <input name="name" required defaultValue={customer.name} className={inputClass} />
              </Field>

              <Field
                label="Канал продажу"
                hint="і аналітика, і прайс: ціни в номенклатурі діляться по каналах; діє на нові замовлення"
              >
                <select name="channel" defaultValue={customer.channel} className={inputClass}>
                  {Object.entries(SALES_CHANNELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="ЄДРПОУ / РНОКПП">
                  <input name="edrpou" defaultValue={customer.edrpou ?? ''} className={inputClass} />
                </Field>
                <Field label="ІПН платника ПДВ" hint="потрібен для податкової накладної">
                  <input name="ipn" defaultValue={customer.ipn ?? ''} className={inputClass} />
                </Field>
              </div>

              <label className="flex items-center gap-2 py-1">
                <input
                  name="is_vat_payer"
                  type="checkbox"
                  defaultChecked={customer.is_vat_payer}
                  className="size-5 accent-emerald-700"
                />
                <span className="text-sm font-semibold text-emerald-900">Платник ПДВ</span>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Контактна особа">
                  <input name="contact" defaultValue={customer.contact ?? ''} className={inputClass} />
                </Field>
                <Field label="Телефон">
                  <input name="phone" defaultValue={customer.phone ?? ''} className={inputClass} />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Відтермінування, дн.">
                  <input
                    name="payment_terms_days"
                    type="number"
                    min="0"
                    defaultValue={customer.payment_terms_days}
                    className={inputClass}
                  />
                </Field>
                <Field label="Кредитний ліміт">
                  <input
                    name="credit_limit"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={customer.credit_limit}
                    className={inputClass}
                  />
                </Field>
              </div>

              <Field label="Юридична адреса" hint="друкується у видатковій накладній">
                <input name="address" defaultValue={customer.address ?? ''} className={inputClass} />
              </Field>

              <Field
                label="Адреса доставки"
                hint="порожньо — возимо на юридичну; у мереж це майже завжди РЦ"
              >
                <input
                  name="delivery_address"
                  defaultValue={customer.delivery_address ?? ''}
                  className={inputClass}
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="IBAN">
                  <input
                    name="iban"
                    defaultValue={customer.iban ?? ''}
                    className={inputClass}
                    placeholder="UA903052990000026007018811777"
                  />
                </Field>
                <Field label="Банк">
                  <input name="bank_name" defaultValue={customer.bank_name ?? ''} className={inputClass} />
                </Field>
              </div>
              <p className="text-sm text-emerald-800/70">
                IBAN потрібен не для краси: у банківській виписці ЄДРПОУ часто немає, і саме рахунок
                дозволяє рознести платіж автоматично.
              </p>

              <Field label="Примітка">
                <input name="note" defaultValue={customer.note ?? ''} className={inputClass} />
              </Field>
            </ActionForm>
          </Card>

          <Card title="Останні замовлення">
            {orders.length === 0 ? (
              <Empty>Замовлень ще не було</Empty>
            ) : (
              <Table head={['Номер', 'Дата', 'Статус', 'Відвантажено']}>
                {orders.map((o) => (
                  <Row key={o.id}>
                    <Cell>
                      <Link href={`/sales/${o.id}`} className="font-semibold text-emerald-800 hover:underline">
                        {o.number}
                      </Link>
                    </Cell>
                    <Cell>{fmtDate(o.ordered_on)}</Cell>
                    <Cell>
                      <Badge tone={o.status === 'shipped' ? 'green' : o.status === 'cancelled' ? 'gray' : 'amber'}>
                        {SO_STATUS[o.status]}
                      </Badge>
                    </Cell>
                    <Cell align="right">{fmtMoney(o.shipped_amount)}</Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title={customer.is_active ? 'Деактивація' : 'Активація'}>
            <p className="mb-3 text-sm text-emerald-800/70">
              {customer.is_active
                ? 'Клієнт зникне зі списків вибору, але всі його замовлення, відвантаження й оплати лишаються в обліку. Видалення не передбачене свідомо.'
                : 'Клієнт повернеться у списки вибору.'}
            </p>
            {customer.is_active && customer.balance_due > 0.01 && (
              <div className="mb-3">
                <Alert tone="amber">
                  За клієнтом борг {fmtMoney(customer.balance_due)} — деактивувати не можна, бо він
                  зник би з дебіторки.
                </Alert>
              </div>
            )}
            <ActionForm
              action={setCustomerActive}
              submitLabel={customer.is_active ? 'Деактивувати' : 'Активувати'}
              variant={customer.is_active ? 'danger' : 'primary'}
            >
              <input type="hidden" name="customer_id" value={customer.id} />
              <input type="hidden" name="active" value={customer.is_active ? 'false' : 'true'} />
            </ActionForm>
          </Card>

          <Card title="Стан">
            <Badge tone={customer.is_active ? 'green' : 'gray'}>
              {customer.is_active ? 'Активний' : 'Деактивований'}
            </Badge>
          </Card>
        </div>
      </div>
    </>
  );
}
