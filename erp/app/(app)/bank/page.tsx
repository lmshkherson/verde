import Link from 'next/link';
import { autoMatch, createBankAccount, importStatement } from '@/app/actions/bank';
import { ActionForm } from '@/components/action-form';
import { BankRow, type BankTx, type Party } from '@/components/bank-row';
import {
  Badge,
  Card,
  Cell,
  Empty,
  Field,
  PageHeader,
  Row,
  Stat,
  Table,
  inputClass,
} from '@/components/ui';
import { query } from '@/lib/db';
import { fmtDate, fmtMoney } from '@/lib/format';
import { openCustomerOrders, openSupplierOrders } from '@/lib/open-docs';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function BankPage() {
  const session = await requireRole('warehouse', 'sales');

  const [accounts, statements, queue, customers, suppliers, customerOrders, supplierOrders] = await Promise.all([
    query<{
      id: string;
      name: string;
      iban: string | null;
      bank_name: string | null;
      currency: string;
      lines: number;
      unmatched: number;
      net_flow: number;
      last_op: string | null;
    }>(
      `select a.id, a.name, a.iban, a.bank_name, a.currency,
              t.lines, t.unmatched, t.net_flow, t.last_op
         from bank_accounts a
         join v_bank_account_totals t on t.account_id = a.id
        where a.legal_entity_id = $1 and a.is_active
        order by a.is_default desc, a.name`,
      [session.eid],
    ),
    query<{
      id: string;
      file_name: string | null;
      period_from: string | null;
      period_to: string | null;
      imported_at: string;
      account: string;
      rows_new: number;
      rows_duplicate: number;
      lines: number;
      unmatched: number;
    }>(
      `select s.id, s.file_name, s.period_from, s.period_to, s.imported_at,
              a.name as account, s.rows_new, s.rows_duplicate, g.lines, g.unmatched
         from bank_statements s
         join bank_accounts a on a.id = s.account_id
         join v_statement_progress g on g.statement_id = s.id
        where s.legal_entity_id = $1
        order by s.imported_at desc
        limit 20`,
      [session.eid],
    ),
    query<BankTx & { statement_id: string | null }>(
      `select t.id, t.op_date, t.amount, t.counterparty_name, t.counterparty_edrpou,
              t.counterparty_iban, t.purpose, t.doc_number, t.status, t.match_kind, t.other_account, t.note,
              t.statement_id, null::text as matched_name, null::text as matched_doc
         from bank_transactions t
        where t.legal_entity_id = $1 and t.status = 'new'
        order by t.op_date desc, t.id
        limit 60`,
      [session.eid],
    ),
    query<Party>('select id, name, edrpou, iban from customers where is_active order by name'),
    query<Party>('select id, name, edrpou, iban from suppliers where is_active order by name'),
    openCustomerOrders(session.eid),
    openSupplierOrders(session.eid),
  ]);

  const totalUnmatched = accounts.reduce((s, a) => s + Number(a.unmatched), 0);

  return (
    <>
      <PageHeader
        title="Банк"
        subtitle="Виписка як первинний документ: імпорт, рознесення, оплати"
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Рахунків" value={String(accounts.length)} />
        <Stat
          label="Не рознесено"
          value={String(totalUnmatched)}
          hint="рядків чекають рішення"
          tone={totalUnmatched > 0 ? 'warn' : 'good'}
        />
        <Stat
          label="Рух за виписками"
          value={fmtMoney(accounts.reduce((s, a) => s + Number(a.net_flow), 0))}
          hint="надходження мінус списання"
        />
        <Stat label="Імпортів" value={String(statements.length)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card title="Черга рознесення">
            {queue.length > 0 && (
              <div className="mb-3">
                <ActionForm action={autoMatch} submitLabel="Рознести автоматично" variant="ghost">
                  <span />
                </ActionForm>
              </div>
            )}
            <p className="mb-3 text-sm text-emerald-800/70">
              Автоматично розноситься лише те, де контрагент однозначно визначився за ЄДРПОУ.
              Збіг за назвою автомат не використовує: «ТОВ Фора» і «ТОВ Фора Плюс» — різні
              платники, і помилка тут псує дебіторку. Для людини назва лишається підказкою й
              одразу підставляється у список.
            </p>
            {queue.length === 0 ? (
              <Empty>Усе рознесено</Empty>
            ) : (
              <div className="space-y-3">
                {queue.map((tx) => (
                  <BankRow
                    key={tx.id}
                    tx={tx}
                    customers={customers}
                    suppliers={suppliers}
                    customerOrders={customerOrders}
                    supplierOrders={supplierOrders}
                  />
                ))}
              </div>
            )}
          </Card>

          <Card title="Виписки">
            {statements.length === 0 ? (
              <Empty>Виписок ще не імпортували</Empty>
            ) : (
              <Table head={['Імпорт', 'Рахунок', 'Період', 'Рядків', 'Не рознесено']}>
                {statements.map((s) => (
                  <Row key={s.id}>
                    <Cell>
                      <Link
                        href={`/bank/${s.id}`}
                        className="font-semibold text-emerald-800 hover:underline"
                      >
                        {s.file_name ?? 'Вставлено текстом'}
                      </Link>
                      <div className="text-xs text-emerald-800/50">{fmtDate(s.imported_at)}</div>
                    </Cell>
                    <Cell>{s.account}</Cell>
                    <Cell>
                      {s.period_from ? fmtDate(s.period_from) : '—'} —{' '}
                      {s.period_to ? fmtDate(s.period_to) : '—'}
                    </Cell>
                    <Cell align="right">
                      {s.rows_new}
                      {s.rows_duplicate > 0 && (
                        <div className="text-xs text-emerald-800/50">
                          повторних {s.rows_duplicate}
                        </div>
                      )}
                    </Cell>
                    <Cell align="right">
                      {s.unmatched > 0 ? (
                        <Badge tone="amber">{s.unmatched}</Badge>
                      ) : (
                        <Badge tone="green">усе</Badge>
                      )}
                    </Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Імпорт виписки">
            {accounts.length === 0 ? (
              <Empty>Спершу заведіть рахунок</Empty>
            ) : (
              <ActionForm action={importStatement} submitLabel="Імпортувати">
                <Field label="Рахунок">
                  <select name="account_id" className={inputClass} required defaultValue={accounts[0].id}>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Файл виписки" hint="CSV із клієнт-банку, у будь-якому кодуванні">
                  <input type="file" name="file" accept=".csv,.txt" className={inputClass} />
                </Field>
                <Field label="Або вставте текстом">
                  <textarea name="content" rows={4} className={`${inputClass} py-2`} />
                </Field>
                <p className="text-xs text-emerald-800/60">
                  Колонки визначаються за назвами, тож зайва колонка чи інший їх порядок імпорту не
                  заважають. Той самий файл можна заливати повторно: рядки, які вже є, не
                  дублюються.
                </p>
              </ActionForm>
            )}
          </Card>

          <Card title="Рахунки">
            {accounts.length > 0 && (
              <ul className="mb-4 space-y-2">
                {accounts.map((a) => (
                  <li key={a.id} className="rounded-xl border border-emerald-900/10 p-2">
                    <div className="font-semibold text-emerald-950">{a.name}</div>
                    <div className="text-xs text-emerald-800/50">
                      {a.iban ?? 'без IBAN'} · {a.bank_name ?? '—'}
                    </div>
                    <div className="mt-1 text-xs text-emerald-800/70">
                      Рух {fmtMoney(a.net_flow)}
                      {a.last_op ? ` · остання операція ${fmtDate(a.last_op)}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <ActionForm action={createBankAccount} submitLabel="Додати рахунок" variant="ghost">
              <Field label="Назва">
                <input name="name" className={inputClass} placeholder="Основний, ПриватБанк" required />
              </Field>
              <Field label="IBAN">
                <input name="iban" className={inputClass} placeholder="UA123456789012345678901234567" />
              </Field>
              <Field label="Банк">
                <input name="bank_name" className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
