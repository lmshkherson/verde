import Link from 'next/link';
import {
  generateTaxInvoices,
  prepareVatDeclaration,
  setInvoiceStatus,
  submitVatDeclaration,
  updateItemTaxCodes,
} from '@/app/actions/tax';
import { ActionForm } from '@/components/action-form';
import { Alert, Badge, Button, Card, Cell, Empty, Field, inputClass, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { fmtDate, fmtMoney, fmtQty } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const monthFmt = new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric' });

const URGENCY: Record<string, { label: string; tone: 'gray' | 'green' | 'amber' | 'red' | 'blue' }> = {
  registered: { label: 'Зареєстрована', tone: 'green' },
  overdue: { label: 'Строк минув', tone: 'red' },
  due_soon: { label: 'Горить', tone: 'amber' },
  pending: { label: 'Чекає реєстрації', tone: 'blue' },
  rejected: { label: 'Відхилена', tone: 'red' },
  cancelled: { label: 'Скасована', tone: 'gray' },
};

export default async function VatPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await requireRole();
  const { period } = await searchParams;

  const now = new Date();
  const current = period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const from = `${current}-01`;

  const [invoices, pending, declaration, missingCodes, periods] = await Promise.all([
    query<{
      id: string;
      number: string;
      issued_on: string;
      counterparty_name: string;
      counterparty_ipn: string | null;
      base_amount: number;
      vat_amount: number;
      total_amount: number;
      status: string;
      urgency: string;
      days_left: number | null;
      register_deadline: string | null;
      registered_on: string | null;
    }>(
      `select id, number, issued_on, counterparty_name, counterparty_ipn, base_amount, vat_amount,
              total_amount, status, urgency, days_left, register_deadline, registered_on
         from v_tax_invoice_status
        where legal_entity_id = $1
          and issued_on >= $2::date and issued_on < ($2::date + interval '1 month')
        order by issued_on, number::bigint`,
      [session.eid, from],
    ),
    query<{ shipment_id: string; number: string; shipped_on: string; customer_name: string; vat_amount: number }>(
      `select shipment_id, number, shipped_on, customer_name, vat_amount
         from v_shipments_without_invoice
        where legal_entity_id = $1
          and shipped_on >= $2::date and shipped_on < ($2::date + interval '1 month')
        order by shipped_on`,
      [session.eid, from],
    ),
    queryOne<{
      id: string;
      status: string;
      liability_base: number;
      liability_vat: number;
      credit_base: number;
      credit_vat: number;
      prev_negative: number;
      payable: number;
      negative_carry: number;
      prepared_on: string | null;
      submitted_on: string | null;
    }>(
      `select id, status, liability_base, liability_vat, credit_base, credit_vat,
              prev_negative, payable, negative_carry, prepared_on, submitted_on
         from vat_declarations where legal_entity_id = $1 and period = $2::date`,
      [session.eid, from],
    ),
    query<{ id: string; sku: string; name: string; unit: string; uktzed: string | null; uom_code: string | null }>(
      `select id, sku, name, unit, uktzed, uom_code
         from items
        where kind = 'finished' and is_active and (uktzed is null or uom_code is null)
        order by name`,
    ),
    query<{ period: string }>(
      `select distinct date_trunc('month', issued_on)::date as period
         from tax_invoices where legal_entity_id = $1 order by period desc limit 12`,
      [session.eid],
    ),
  ]);

  const overdue = invoices.filter((i) => i.urgency === 'overdue').length;
  const unregistered = invoices.filter((i) => i.status === 'draft').length;
  const totalVat = invoices.reduce((s, i) => s + Number(i.vat_amount), 0);

  if (!session.vat) {
    return (
      <>
        <PageHeader title="ПДВ" subtitle={session.ename} />
        <Alert tone="amber">
          Ця юрособа не є платником ПДВ — податкові накладні не виписуються, декларація не
          подається. Перемкніть юрособу в шапці.
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="ПДВ: накладні й декларація"
        subtitle={`${session.ename} · ${monthFmt.format(new Date(from))}`}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {periods.map((p) => {
          const key = String(p.period).slice(0, 7);
          return (
            <Link
              key={key}
              href={`/vat?period=${key}`}
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

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Накладних за період" value={String(invoices.length)} />
        <Stat label="ПДВ у накладних" value={fmtMoney(totalVat)} />
        <Stat
          label="Не зареєстровано"
          value={String(unregistered)}
          tone={unregistered > 0 ? 'warn' : 'good'}
        />
        <Stat label="Прострочено" value={String(overdue)} tone={overdue > 0 ? 'danger' : 'good'} />
      </div>

      {overdue > 0 && (
        <div className="mb-4">
          <Alert tone="red">
            Є накладні з простроченим строком реєстрації. Штраф рахується від суми ПДВ у
            накладній і зростає з кількістю днів прострочення.
          </Alert>
        </div>
      )}

      {missingCodes.length > 0 && (
        <div className="mb-4">
          <Alert tone="amber">
            У {missingCodes.length} позицій готової продукції не заповнені УКТЗЕД або код одиниці
            виміру. Без них накладну не приймуть — заповніть у блоці нижче.
          </Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card title="Податкові накладні">
            {invoices.length === 0 ? (
              <Empty>Накладних за цей період немає</Empty>
            ) : (
              <Table head={['№', 'Дата', 'Покупець', 'База', 'ПДВ', 'Строк', 'Статус', '']}>
                {invoices.map((i) => {
                  const u = URGENCY[i.urgency] ?? URGENCY.pending;
                  return (
                    <Row key={i.id}>
                      <Cell className="font-mono font-semibold">{i.number}</Cell>
                      <Cell>{fmtDate(i.issued_on)}</Cell>
                      <Cell>
                        <div className="font-semibold">{i.counterparty_name}</div>
                        <div className="font-mono text-xs text-emerald-800/50">
                          {i.counterparty_ipn ?? 'без ІПН'}
                        </div>
                      </Cell>
                      <Cell align="right">{fmtMoney(i.base_amount)}</Cell>
                      <Cell align="right" className="font-semibold">
                        {fmtMoney(i.vat_amount)}
                      </Cell>
                      <Cell align="right">
                        {i.registered_on ? (
                          <span className="text-emerald-700">{fmtDate(i.registered_on)}</span>
                        ) : (
                          <>
                            <div>{fmtDate(i.register_deadline)}</div>
                            {i.days_left !== null && i.status === 'draft' && (
                              <div className={`text-xs ${i.days_left < 0 ? 'text-red-600' : 'text-emerald-800/50'}`}>
                                {i.days_left < 0 ? `${-i.days_left} дн. прострочення` : `${i.days_left} дн.`}
                              </div>
                            )}
                          </>
                        )}
                      </Cell>
                      <Cell>
                        <Badge tone={u.tone}>{u.label}</Badge>
                      </Cell>
                      <Cell align="right">
                        {i.status === 'draft' && (
                          <form action={setInvoiceStatus}>
                            <input type="hidden" name="invoice_id" value={i.id} />
                            <input type="hidden" name="status" value="registered" />
                            <Button className="!min-h-9 !px-3 text-xs">Зареєстровано</Button>
                          </form>
                        )}
                      </Cell>
                    </Row>
                  );
                })}
              </Table>
            )}
            <p className="mt-4 text-xs text-emerald-800/60">
              Строк реєстрації рахується за правилом: накладні першої половини місяця — до 5 числа
              наступного, другої — до 18. Дні задані в налаштуваннях, бо змінюються законом.
              Поки що статус реєстрації відмічається вручну: інтеграція з M.E.Doc або «Вчасно»
              підставить його автоматично.
            </p>
          </Card>

          <Card title="Декларація з ПДВ">
            {!declaration ? (
              <Empty>Декларацію за цей період ще не готували</Empty>
            ) : (
              <>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between border-b border-emerald-900/10 py-1.5">
                    <span>Податкові зобов’язання</span>
                    <span className="tabular-nums font-semibold">{fmtMoney(declaration.liability_vat)}</span>
                  </div>
                  <div className="flex justify-between border-b border-emerald-900/10 py-1.5">
                    <span>Податковий кредит</span>
                    <span className="tabular-nums font-semibold">{fmtMoney(declaration.credit_vat)}</span>
                  </div>
                  <div className="flex justify-between border-b border-emerald-900/10 py-1.5">
                    <span>Від’ємне значення попереднього періоду</span>
                    <span className="tabular-nums">{fmtMoney(declaration.prev_negative)}</span>
                  </div>
                  <div className="flex justify-between pt-2 text-base">
                    <span className="font-bold">
                      {declaration.payable > 0 ? 'До сплати в бюджет' : 'До перенесення на наступний період'}
                    </span>
                    <span
                      className={`tabular-nums text-lg font-black ${
                        declaration.payable > 0 ? 'text-amber-600' : 'text-emerald-700'
                      }`}
                    >
                      {fmtMoney(declaration.payable > 0 ? declaration.payable : declaration.negative_carry)}
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <Badge tone={declaration.status === 'submitted' ? 'green' : 'gray'}>
                    {declaration.status === 'submitted' ? 'Подана' : 'Чернетка'}
                  </Badge>
                  {declaration.prepared_on && (
                    <span className="text-xs text-emerald-800/50">
                      підготовлено {fmtDate(declaration.prepared_on)}
                      {declaration.submitted_on ? ` · подано ${fmtDate(declaration.submitted_on)}` : ''}
                    </span>
                  )}
                  {declaration.status === 'draft' && (
                    <form action={submitVatDeclaration}>
                      <input type="hidden" name="declaration_id" value={declaration.id} />
                      <Button className="!min-h-9 !px-3 text-xs">Позначити поданою</Button>
                    </form>
                  )}
                </div>
              </>
            )}
          </Card>

          {missingCodes.length > 0 && (
            <Card title="Коди для податкової накладної">
              <p className="mb-3 text-sm text-emerald-800/70">
                УКТЗЕД і код одиниці виміру за класифікатором. Значення треба звірити з
                довідниками — помилковий код є підставою не прийняти накладну.
              </p>
              <div className="space-y-3">
                {missingCodes.map((i) => (
                  <ActionForm key={i.id} action={updateItemTaxCodes} submitLabel="Зберегти" hideSuccess>
                    <input type="hidden" name="item_id" value={i.id} />
                    <div className="font-semibold text-emerald-950">{i.name}</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Field label="УКТЗЕД">
                        <input name="uktzed" defaultValue={i.uktzed ?? ''} className={inputClass} placeholder="1806 32 90 00" />
                      </Field>
                      <Field label={`Код одиниці (${i.unit})`}>
                        <input name="uom_code" defaultValue={i.uom_code ?? ''} className={inputClass} placeholder="2009" />
                      </Field>
                    </div>
                  </ActionForm>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Виписати накладні">
            <p className="mb-3 text-sm text-emerald-800/70">
              На кожне відвантаження періоду, якому ще бракує накладної. Повторний запуск нічого
              не дублює.
            </p>
            {pending.length > 0 ? (
              <div className="mb-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
                Без накладної: {pending.length} відвантажень на{' '}
                {fmtMoney(pending.reduce((s, p) => s + Number(p.vat_amount), 0))} ПДВ
              </div>
            ) : (
              <div className="mb-3 rounded-xl bg-emerald-50/60 p-3 text-xs text-emerald-800/70">
                Усі відвантаження періоду мають накладні.
              </div>
            )}
            <ActionForm action={generateTaxInvoices} submitLabel="Виписати накладні">
              <input type="hidden" name="period" value={current} />
            </ActionForm>
          </Card>

          <Card title="Підготувати декларацію">
            <p className="mb-3 text-sm text-emerald-800/70">
              Зобов’язання й кредит беруться з реєстру ПДВ, від’ємне значення підтягується з
              декларації попереднього періоду.
            </p>
            <ActionForm action={prepareVatDeclaration} submitLabel="Підготувати за місяць">
              <input type="hidden" name="period" value={current} />
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
