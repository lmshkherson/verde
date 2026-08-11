import Link from 'next/link';
import { Alert, Card, Cell, Empty, LinkButton, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { fmtMoney } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const monthFmt = new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric' });

const BOOKS = [
  { key: 'accounting', label: 'Бухгалтерський' },
  { key: 'management', label: 'Управлінський' },
];

export default async function StatementsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; book?: string; scope?: string }>;
}) {
  const session = await requireRole();
  const { period, book = 'accounting', scope } = await searchParams;

  const now = new Date();
  const current = period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const from = `${current}-01`;

  // «Вся група» — консолідований управлінський баланс: гроші, запаси й борги
  // всіх юросіб однією сумою. Бухгалтерська звітність — завжди по одній.
  const groupScope = scope === 'group' && book === 'management';
  const entityIds = groupScope
    ? (await query<{ id: string }>('select id from legal_entities where is_active')).map((e) => e.id)
    : [session.eid];

  const [balances, pl] = await Promise.all([
    // Баланс — накопичені залишки на кінець періоду: вхідні плюс усі оберти.
    query<{ code: string; name: string; kind: string; balance: number }>(
      `with turnover as (
         select code, sum(debit) - sum(credit) as balance
           from v_account_turnover
          where legal_entity_id = any($1::uuid[]) and book = $3
            and posted_on < ($2::date + interval '1 month')
          group by code
       ),
       opening as (
         select code, sum(debit) - sum(credit) as balance
           from opening_balances
          where legal_entity_id = any($1::uuid[]) and as_of < ($2::date + interval '1 month')
          group by code
       ),
       merged as (
         select coalesce(t.code, o.code) as code,
                coalesce(t.balance, 0) + coalesce(o.balance, 0) as balance
           from turnover t full join opening o on o.code = t.code
       )
       select m.code, a.name, a.kind, m.balance
         from merged m join chart_of_accounts a on a.code = m.code
        where abs(m.balance) > 0.005 and a.kind in ('asset','liability','equity')
        order by m.code`,
      [entityIds, from, book],
    ),
    // Звіт про фінансові результати — оберти доходів і витрат без закриття періоду.
    query<{ code: string; name: string; kind: string; amount: number }>(
      `select t.code, a.name, a.kind, sum(t.credit) - sum(t.debit) as amount
         from v_postings_by_book p
         join posting_batches b on b.id = p.batch_id
         join lateral (
           select p.debit_code as code, p.amount as debit, 0::numeric as credit
           union all select p.credit_code, 0::numeric, p.amount
         ) t on true
         join chart_of_accounts a on a.code = t.code
        where p.legal_entity_id = any($1::uuid[]) and p.book = $3
          and p.posted_on >= $2::date and p.posted_on < ($2::date + interval '1 month')
          and b.doc_type <> 'period_close'
          and a.kind in ('income','expense')
        group by t.code, a.name, a.kind
        order by a.kind desc, t.code`,
      [entityIds, from, book],
    ),
  ]);

  const assets = balances.filter((b) => b.kind === 'asset');
  const liabilities = balances.filter((b) => b.kind === 'liability');
  const equity = balances.filter((b) => b.kind === 'equity');

  const assetTotal = assets.reduce((s, b) => s + Number(b.balance), 0);
  const liabilityTotal = liabilities.reduce((s, b) => s - Number(b.balance), 0);
  const equityTotal = equity.reduce((s, b) => s - Number(b.balance), 0);
  const balanced = Math.abs(assetTotal - liabilityTotal - equityTotal) < 0.02;

  const income = pl.filter((r) => r.kind === 'income');
  const expenses = pl.filter((r) => r.kind === 'expense');
  const incomeTotal = income.reduce((s, r) => s + Number(r.amount), 0);
  const expenseTotal = expenses.reduce((s, r) => s - Number(r.amount), 0);
  const profit = incomeTotal - expenseTotal;

  return (
    <>
      <PageHeader
        title="Фінансова звітність"
        subtitle={`${groupScope ? 'Вся група разом' : session.ename} · ${monthFmt.format(new Date(from))}`}
        action={<LinkButton href={`/accounting?period=${current}&book=${book}`}>← До оборотки</LinkButton>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {BOOKS.map((b) => (
          <Link
            key={b.key}
            href={`/accounting/statements?period=${current}&book=${b.key}`}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              book === b.key && !groupScope
                ? 'bg-emerald-700 text-white'
                : 'border border-emerald-900/15 bg-white text-emerald-900'
            }`}
          >
            {b.label} облік
          </Link>
        ))}
        <Link
          href={`/accounting/statements?period=${current}&book=management&scope=group`}
          className={`rounded-full px-4 py-2 text-sm font-semibold ${
            groupScope
              ? 'bg-emerald-700 text-white'
              : 'border border-emerald-900/15 bg-white text-emerald-900'
          }`}
        >
          Управлінський · вся група
        </Link>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Актив" value={fmtMoney(assetTotal)} />
        <Stat label="Пасив" value={fmtMoney(liabilityTotal + equityTotal)} />
        <Stat
          label="Баланс"
          value={balanced ? 'зійшовся' : fmtMoney(assetTotal - liabilityTotal - equityTotal)}
          tone={balanced ? 'good' : 'danger'}
        />
        <Stat
          label="Результат періоду"
          value={fmtMoney(profit)}
          tone={profit >= 0 ? 'good' : 'danger'}
        />
      </div>

      {!balanced && (
        <div className="mb-4">
          <Alert tone="red">
            Актив не дорівнює пасиву. Найчастіша причина — не внесені вхідні залишки або
            неперегенерований період.
          </Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Баланс">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-emerald-800/60">Актив</h3>
          <Table head={['Рахунок', 'Сума']}>
            {assets.map((b) => (
              <Row key={b.code}>
                <Cell>
                  <span className="font-mono font-semibold">{b.code}</span>
                  <div className="text-xs text-emerald-800/50">{b.name}</div>
                </Cell>
                <Cell align="right">{fmtMoney(b.balance)}</Cell>
              </Row>
            ))}
            <Row>
              <Cell className="font-bold">Разом актив</Cell>
              <Cell align="right" className="font-bold">
                {fmtMoney(assetTotal)}
              </Cell>
            </Row>
          </Table>

          <h3 className="mb-2 mt-6 text-xs font-bold uppercase tracking-wide text-emerald-800/60">
            Пасив
          </h3>
          <Table head={['Рахунок', 'Сума']}>
            {[...equity, ...liabilities].map((b) => (
              <Row key={b.code}>
                <Cell>
                  <span className="font-mono font-semibold">{b.code}</span>
                  <div className="text-xs text-emerald-800/50">{b.name}</div>
                </Cell>
                <Cell align="right">{fmtMoney(-b.balance)}</Cell>
              </Row>
            ))}
            <Row>
              <Cell className="font-bold">Разом пасив</Cell>
              <Cell align="right" className="font-bold">
                {fmtMoney(liabilityTotal + equityTotal)}
              </Cell>
            </Row>
          </Table>
        </Card>

        <Card title="Звіт про фінансові результати">
          {pl.length === 0 ? (
            <Empty>Операцій за період немає</Empty>
          ) : (
            <>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-emerald-800/60">
                Доходи
              </h3>
              <Table head={['Рахунок', 'Сума']}>
                {income.map((r) => (
                  <Row key={r.code}>
                    <Cell>
                      <span className="font-mono font-semibold">{r.code}</span>
                      <div className="text-xs text-emerald-800/50">{r.name}</div>
                    </Cell>
                    <Cell align="right">{fmtMoney(r.amount)}</Cell>
                  </Row>
                ))}
              </Table>

              <h3 className="mb-2 mt-6 text-xs font-bold uppercase tracking-wide text-emerald-800/60">
                Витрати
              </h3>
              <Table head={['Рахунок', 'Сума']}>
                {expenses.map((r) => (
                  <Row key={r.code}>
                    <Cell>
                      <span className="font-mono font-semibold">{r.code}</span>
                      <div className="text-xs text-emerald-800/50">{r.name}</div>
                    </Cell>
                    <Cell align="right">{fmtMoney(-r.amount)}</Cell>
                  </Row>
                ))}
              </Table>

              <div className="mt-6 flex items-baseline justify-between border-t border-emerald-900/15 pt-3">
                <span className="text-lg font-black text-emerald-900">Фінансовий результат</span>
                <span
                  className={`text-lg font-black tabular-nums ${
                    profit >= 0 ? 'text-emerald-700' : 'text-red-600'
                  }`}
                >
                  {fmtMoney(profit)}
                </span>
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
