import { Card, Cell, Empty, LinkButton, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { fmtMoney } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const monthFmt = new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric' });

export default async function BookDifferencePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await requireRole();
  const { period } = await searchParams;

  const now = new Date();
  const current = period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const from = `${current}-01`;

  const [diffs, results, divergent] = await Promise.all([
    query<{ code: string; name: string; accounting_balance: number; management_balance: number; difference: number }>(
      `select d.code, a.name, d.accounting_balance, d.management_balance, d.difference
         from v_book_difference d
         join chart_of_accounts a on a.code = d.code
        where d.legal_entity_id = $1 and d.period = $2::date and abs(d.difference) > 0.005
        order by abs(d.difference) desc`,
      [session.eid, from],
    ),
    queryOne<{ accounting: number; management: number }>(
      `select
         coalesce(sum(credit - debit) filter (where book = 'accounting'), 0) as accounting,
         coalesce(sum(credit - debit) filter (where book = 'management'), 0) as management
       from v_account_turnover
      where legal_entity_id = $1 and code = '791'
        and posted_on >= $2::date and posted_on < ($2::date + interval '1 month')`,
      [session.eid, from],
    ),
    query<{ book: string; doc_type: string; description: string | null; debit_code: string; credit_code: string; amount: number }>(
      `select p.book, b.doc_type, b.description, p.debit_code, p.credit_code, p.amount
         from postings p join posting_batches b on b.id = p.batch_id
        where p.legal_entity_id = $1 and p.book <> 'both'
          and p.posted_on >= $2::date and p.posted_on < ($2::date + interval '1 month')
        order by p.book, p.amount desc`,
      [session.eid, from],
    ),
  ]);

  const acc = results?.accounting ?? 0;
  const mgmt = results?.management ?? 0;
  const gap = acc - mgmt;

  return (
    <>
      <PageHeader
        title="Розбіжності між обліками"
        subtitle={`${session.ename} · ${monthFmt.format(new Date(from))}`}
        action={<LinkButton href={`/accounting?period=${current}`}>← До оборотки</LinkButton>}
      />

      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Stat label="Бухгалтерський результат" value={fmtMoney(acc)} tone={acc >= 0 ? 'good' : 'danger'} />
        <Stat label="Управлінський результат" value={fmtMoney(mgmt)} tone={mgmt >= 0 ? 'good' : 'danger'} />
        <Stat
          label="Розбіжність"
          value={fmtMoney(gap)}
          tone={Math.abs(gap) < 0.01 ? 'good' : 'warn'}
          hint="осіла у вартості запасів"
        />
      </div>

      <div className="grid gap-4">
        <Card title="Чому результати різні">
          {Math.abs(gap) < 0.01 ? (
            <Empty>Розбіжностей немає — обидві книги дали однаковий результат</Empty>
          ) : (
            <>
              <p className="mb-4 text-sm text-emerald-800/70">
                Витрати цеху в бухгалтерському обліку йдуть у вартість продукції й зменшують
                прибуток лише в міру продажу. В управлінському вони списуються одразу. Тому доки
                частина випуску лежить на складі, бухгалтерський прибуток вищий рівно на вартість
                цеху, що осіла в цих залишках.
              </p>
              <Table head={['Рахунок', 'Бухгалтерський', 'Управлінський', 'Різниця']}>
                {diffs.map((d) => (
                  <Row key={d.code}>
                    <Cell>
                      <span className="font-mono font-semibold">{d.code}</span>
                      <div className="text-xs text-emerald-800/50">{d.name}</div>
                    </Cell>
                    <Cell align="right">{fmtMoney(d.accounting_balance)}</Cell>
                    <Cell align="right">{fmtMoney(d.management_balance)}</Cell>
                    <Cell align="right" className="font-semibold">
                      {fmtMoney(d.difference)}
                    </Cell>
                  </Row>
                ))}
              </Table>
            </>
          )}
        </Card>

        <Card title="Проводки, які є лише в одній книзі">
          {divergent.length === 0 ? (
            <Empty>Усі проводки періоду спільні для обох обліків</Empty>
          ) : (
            <Table head={['Книга', 'Операція', 'Дт', 'Кт', 'Сума']}>
              {divergent.map((d, i) => (
                <Row key={i}>
                  <Cell className="font-semibold">
                    {d.book === 'accounting' ? 'Бухгалтерський' : 'Управлінський'}
                  </Cell>
                  <Cell>{d.description ?? d.doc_type}</Cell>
                  <Cell className="font-mono">{d.debit_code}</Cell>
                  <Cell className="font-mono">{d.credit_code}</Cell>
                  <Cell align="right" className="font-semibold">
                    {fmtMoney(d.amount)}
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
          <p className="mt-4 text-xs text-emerald-800/60">
            У бухгалтерській книзі змінні витрати цеху лягають на випуск повністю, а постійні —
            у частці фактичного завантаження до нормальної потужності; нерозподілений залишок
            іде прямо в собівартість реалізації. В управлінській книзі весь цех є витратою
            періоду. Норматив і базу розподілу задано на сторінці «Юрособи».
          </p>
        </Card>
      </div>
    </>
  );
}
