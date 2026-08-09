import Link from 'next/link';
import { rebuildPostings, saveOpeningBalance } from '@/app/actions/accounting';
import { ActionForm } from '@/components/action-form';
import { Alert, Card, Cell, Empty, Field, inputClass, LinkButton, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { fmtMoney } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const monthFmt = new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('uk-UA', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const BOOKS = [
  { key: 'accounting', label: 'Бухгалтерський' },
  { key: 'management', label: 'Управлінський' },
];

export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; book?: string }>;
}) {
  const session = await requireRole(); // лише власник
  const { period, book = 'accounting' } = await searchParams;

  const now = new Date();
  const current = period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const from = `${current}-01`;

  const [rows, opening, run, accounts, periods] = await Promise.all([
    query<{ code: string; name: string; kind: string; debit: number; credit: number }>(
      `select t.code, a.name, a.kind, sum(t.debit) as debit, sum(t.credit) as credit
         from v_account_turnover t
         join chart_of_accounts a on a.code = t.code
        where t.legal_entity_id = $1 and t.book = $3
          and t.posted_on >= $2::date and t.posted_on < ($2::date + interval '1 month')
        group by t.code, a.name, a.kind
        order by t.code`,
      [session.eid, from, book],
    ),
    query<{ code: string; name: string; debit: number; credit: number }>(
      `select o.code, a.name, o.debit, o.credit
         from opening_balances o join chart_of_accounts a on a.code = o.code
        where o.legal_entity_id = $1 and o.as_of <= $2::date
        order by o.code`,
      [session.eid, from],
    ),
    queryOne<{ generated_at: string; postings_count: number; author: string | null }>(
      `select r.generated_at, r.postings_count, u.full_name as author
         from posting_runs r left join app_users u on u.id = r.generated_by
        where r.legal_entity_id = $1 and r.period = $2::date`,
      [session.eid, from],
    ),
    query<{ code: string; name: string }>(
      'select code, name from chart_of_accounts where is_active order by code',
    ),
    query<{ period: string }>(
      `select distinct date_trunc('month', posted_on)::date as period
         from postings where legal_entity_id = $1 order by period desc limit 12`,
      [session.eid],
    ),
  ]);

  const totalDebit = rows.reduce((s, r) => s + Number(r.debit), 0);
  const totalCredit = rows.reduce((s, r) => s + Number(r.credit), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const openingByCode = new Map(opening.map((o) => [o.code, o]));
  const result = rows.find((r) => r.code === '791');
  const financialResult = result ? Number(result.credit) - Number(result.debit) : 0;

  return (
    <>
      <PageHeader
        title="Оборотно-сальдова відомість"
        subtitle={`${session.ename} · ${monthFmt.format(new Date(from))}`}
        action={
          <div className="flex gap-2">
            <LinkButton href={`/accounting/postings?period=${current}&book=${book}`}>Проводки</LinkButton>
            <LinkButton href={`/accounting/statements?period=${current}&book=${book}`}>
              Звітність
            </LinkButton>
            <LinkButton href={`/accounting/difference?period=${current}`} variant="primary">
              Розбіжності
            </LinkButton>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {BOOKS.map((b) => (
          <Link
            key={b.key}
            href={`/accounting?period=${current}&book=${b.key}`}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              book === b.key
                ? 'bg-emerald-700 text-white'
                : 'border border-emerald-900/15 bg-white text-emerald-900'
            }`}
          >
            {b.label} облік
          </Link>
        ))}
        {periods.map((p) => {
          const key = String(p.period).slice(0, 7);
          return (
            <Link
              key={key}
              href={`/accounting?period=${key}&book=${book}`}
              className={`rounded-full px-3 py-2 text-sm font-semibold ${
                key === current
                  ? 'bg-emerald-900 text-white'
                  : 'border border-emerald-900/15 bg-white text-emerald-800/70'
              }`}
            >
              {monthFmt.format(new Date(`${key}-01`))}
            </Link>
          );
        })}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Оберти за дебетом" value={fmtMoney(totalDebit)} />
        <Stat label="Оберти за кредитом" value={fmtMoney(totalCredit)} />
        <Stat
          label="Баланс"
          value={balanced ? 'зійшовся' : fmtMoney(totalDebit - totalCredit)}
          tone={balanced ? 'good' : 'danger'}
        />
        <Stat
          label="Результат на 791"
          value={fmtMoney(financialResult)}
          tone={financialResult >= 0 ? 'good' : 'danger'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {!balanced && rows.length > 0 && (
            <Alert tone="red">
              Дебет не дорівнює кредиту — у правилах генерації є помилка. Перегенеруйте період
              і перевірте журнал проводок.
            </Alert>
          )}

          <Card title="Оборотка">
            {rows.length === 0 ? (
              <Empty>Проводок за цей період немає — згенеруйте їх праворуч</Empty>
            ) : (
              <Table head={['Рахунок', 'Сальдо на початок', 'Оберт Дт', 'Оберт Кт', 'Сальдо на кінець']}>
                {rows.map((r) => {
                  const open = openingByCode.get(r.code);
                  const openBalance = Number(open?.debit ?? 0) - Number(open?.credit ?? 0);
                  const closing = openBalance + Number(r.debit) - Number(r.credit);
                  return (
                    <Row key={r.code}>
                      <Cell>
                        <span className="font-mono font-semibold">{r.code}</span>
                        <div className="text-xs text-emerald-800/50">{r.name}</div>
                      </Cell>
                      <Cell align="right">{openBalance !== 0 ? fmtMoney(openBalance) : '—'}</Cell>
                      <Cell align="right">{Number(r.debit) > 0 ? fmtMoney(r.debit) : '—'}</Cell>
                      <Cell align="right">{Number(r.credit) > 0 ? fmtMoney(r.credit) : '—'}</Cell>
                      <Cell align="right" className="font-semibold">
                        {fmtMoney(closing)}
                      </Cell>
                    </Row>
                  );
                })}
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Генерація проводок">
            <p className="mb-3 text-sm text-emerald-800/70">
              Проводки — похідна від документів, а не окремий ручний ввід. Тому вони не можуть
              розійтися з первинкою: змінили документ — перегенеруйте період.
            </p>
            {run ? (
              <p className="mb-3 rounded-xl bg-emerald-50/60 p-3 text-xs text-emerald-900/80">
                Останній раз: {dateTimeFmt.format(new Date(run.generated_at))}, проводок{' '}
                {run.postings_count}
                {run.author ? `, ${run.author}` : ''}
              </p>
            ) : (
              <p className="mb-3 text-xs text-emerald-800/60">Цей період ще не генерувався.</p>
            )}
            <ActionForm action={rebuildPostings} submitLabel="Перегенерувати період">
              <input type="hidden" name="period" value={current} />
            </ActionForm>
          </Card>

          <Card title="Початкові залишки">
            <p className="mb-3 text-sm text-emerald-800/70">
              Гроші й капітал нізвідки не беруться. Без вхідних залишків актив не зійдеться
              з пасивом.
            </p>
            <ActionForm action={saveOpeningBalance} submitLabel="Зберегти залишок">
              <Field label="Рахунок">
                <select name="code" required className={inputClass} defaultValue="">
                  <option value="" disabled>
                    Оберіть…
                  </option>
                  {accounts.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Дата">
                <input name="as_of" type="date" defaultValue={from} className={inputClass} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Дебет">
                  <input name="debit" type="number" step="0.01" min="0" defaultValue="0" className={inputClass} />
                </Field>
                <Field label="Кредит">
                  <input name="credit" type="number" step="0.01" min="0" defaultValue="0" className={inputClass} />
                </Field>
              </div>
            </ActionForm>
            {opening.length > 0 && (
              <div className="mt-4">
                <Table head={['Рахунок', 'Дт', 'Кт']}>
                  {opening.map((o) => (
                    <Row key={o.code}>
                      <Cell className="font-mono">{o.code}</Cell>
                      <Cell align="right">{Number(o.debit) > 0 ? fmtMoney(o.debit) : '—'}</Cell>
                      <Cell align="right">{Number(o.credit) > 0 ? fmtMoney(o.credit) : '—'}</Cell>
                    </Row>
                  ))}
                </Table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
