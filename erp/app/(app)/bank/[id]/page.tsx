import { notFound } from 'next/navigation';
import { autoMatch } from '@/app/actions/bank';
import { ActionForm } from '@/components/action-form';
import { BankRow, type BankTx, type Party } from '@/components/bank-row';
import { Card, Empty, LinkButton, PageHeader, Stat } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { fmtDate, fmtMoney } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole('warehouse', 'sales');
  const { id } = await params;

  const statement = await queryOne<{
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
    matched: number;
    ignored: number;
    inflow: number;
    outflow: number;
    imported_by: string | null;
  }>(
    `select s.id, s.file_name, s.period_from, s.period_to, s.imported_at,
            a.name as account, s.rows_new, s.rows_duplicate,
            g.lines, g.unmatched, g.matched, g.ignored, g.inflow, g.outflow,
            u.full_name as imported_by
       from bank_statements s
       join bank_accounts a on a.id = s.account_id
       join v_statement_progress g on g.statement_id = s.id
       left join app_users u on u.id = s.imported_by
      where s.id = $1 and s.legal_entity_id = $2`,
    [id, session.eid],
  );
  if (!statement) notFound();

  const [rows, customers, suppliers] = await Promise.all([
    query<BankTx>(
      `select t.id, t.op_date, t.amount, t.counterparty_name, t.counterparty_edrpou,
              t.purpose, t.doc_number, t.status, t.match_kind, t.other_account, t.note,
              coalesce(c.name, sp.name) as matched_name
         from bank_transactions t
         left join customers c on c.id = t.customer_id
         left join suppliers sp on sp.id = t.supplier_id
        where t.statement_id = $1
        order by t.op_date, t.id`,
      [id],
    ),
    query<Party>('select id, name, edrpou from customers where is_active order by name'),
    query<Party>('select id, name, edrpou from suppliers where is_active order by name'),
  ]);

  const pending = rows.filter((r) => r.status === 'new');

  return (
    <>
      <PageHeader
        title={statement.file_name ?? 'Виписка'}
        subtitle={`${statement.account} · ${
          statement.period_from ? fmtDate(statement.period_from) : '—'
        } — ${statement.period_to ? fmtDate(statement.period_to) : '—'}`}
        action={<LinkButton href="/bank">← До банку</LinkButton>}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Рядків"
          value={String(statement.lines)}
          hint={
            statement.rows_duplicate > 0
              ? `повторних пропущено ${statement.rows_duplicate}`
              : 'усі рядки нові'
          }
        />
        <Stat label="Надходження" value={fmtMoney(statement.inflow)} tone="good" />
        <Stat label="Списання" value={fmtMoney(statement.outflow)} />
        <Stat
          label="Не рознесено"
          value={String(statement.unmatched)}
          tone={statement.unmatched > 0 ? 'warn' : 'good'}
        />
      </div>

      <Card title="Рядки виписки">
        <p className="mb-3 text-sm text-emerald-800/70">
          Імпортував {statement.imported_by ?? '—'} {fmtDate(statement.imported_at)}. Сам рядок не
          змінюється ніколи — змінюється лише його рознесення, тож скасувати й рознести інакше
          можна в будь-який момент.
        </p>

        {pending.length > 0 && (
          <div className="mb-4">
            <ActionForm action={autoMatch} submitLabel="Рознести автоматично" variant="ghost">
              <input type="hidden" name="statement_id" value={statement.id} />
            </ActionForm>
          </div>
        )}

        {rows.length === 0 ? (
          <Empty>У виписці немає рядків</Empty>
        ) : (
          <div className="space-y-3">
            {rows.map((tx) => (
              <BankRow
                key={tx.id}
                tx={tx}
                customers={customers}
                suppliers={suppliers}
                statementId={statement.id}
              />
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
