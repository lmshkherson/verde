import Link from 'next/link';
import { Badge, Card, Cell, Empty, LinkButton, PageHeader, Row, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { fmtDate, fmtMoney } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const BOOK_LABELS: Record<string, string> = {
  both: 'Обидві книги',
  accounting: 'Тільки бухгалтерський',
  management: 'Тільки управлінський',
};

const DOC_LABELS: Record<string, string> = {
  purchase_receipt: 'Прихід від постачальника',
  internal_purchase: 'Придбання у власної юрособи',
  vat_credit: 'Податковий кредит',
  supplier_payment: 'Оплата постачальнику',
  production_consume: 'Списання у виробництво',
  production_output: 'Випуск продукції',
  shipment: 'Відвантаження',
  customer_payment: 'Оплата від покупця',
  expense: 'Витрати',
  write_off: 'Списання втрат',
  period_close: 'Закриття періоду',
};

export default async function PostingsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; book?: string }>;
}) {
  const session = await requireRole();
  const { period, book } = await searchParams;

  const now = new Date();
  const current = period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const from = `${current}-01`;

  const rows = await query<{
    id: number;
    posted_on: string;
    book: string;
    debit_code: string;
    debit_name: string;
    credit_code: string;
    credit_name: string;
    amount: number;
    note: string | null;
    doc_type: string;
    description: string | null;
  }>(
    `select p.id, p.posted_on, p.book, p.debit_code, da.name as debit_name,
            p.credit_code, ca.name as credit_name, p.amount, p.note,
            b.doc_type, b.description
       from postings p
       join posting_batches b on b.id = p.batch_id
       join chart_of_accounts da on da.code = p.debit_code
       join chart_of_accounts ca on ca.code = p.credit_code
      where p.legal_entity_id = $1
        and p.posted_on >= $2::date and p.posted_on < ($2::date + interval '1 month')
        and ($3::text is null or p.book = $3 or ($3 <> 'both' and p.book = 'both'))
      order by p.posted_on, b.doc_type, p.id`,
    [session.eid, from, book ?? null],
  );

  const divergent = rows.filter((r) => r.book !== 'both').length;

  return (
    <>
      <PageHeader
        title="Журнал проводок"
        subtitle={`Проводки з ознакою книги. Розбіжних із загальними: ${divergent}`}
        action={<LinkButton href={`/accounting?period=${current}`}>← До оборотки</LinkButton>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { key: '', label: 'Усі' },
          { key: 'accounting', label: 'Бухгалтерські' },
          { key: 'management', label: 'Управлінські' },
        ].map((f) => (
          <Link
            key={f.key}
            href={`/accounting/postings?period=${current}${f.key ? `&book=${f.key}` : ''}`}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              (book ?? '') === f.key
                ? 'bg-emerald-700 text-white'
                : 'border border-emerald-900/15 bg-white text-emerald-900'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <Card>
        {rows.length === 0 ? (
          <Empty>Проводок немає — згенеруйте період на сторінці оборотки</Empty>
        ) : (
          <Table head={['Дата', 'Документ', 'Дебет', 'Кредит', 'Сума', 'Книга']}>
            {rows.map((r) => (
              <Row key={r.id}>
                <Cell>{fmtDate(r.posted_on)}</Cell>
                <Cell>
                  <div className="font-semibold">{DOC_LABELS[r.doc_type] ?? r.doc_type}</div>
                  {r.description && <div className="text-xs text-emerald-800/50">{r.description}</div>}
                </Cell>
                <Cell>
                  <span className="font-mono font-semibold">{r.debit_code}</span>
                  <div className="text-xs text-emerald-800/50">{r.debit_name}</div>
                </Cell>
                <Cell>
                  <span className="font-mono font-semibold">{r.credit_code}</span>
                  <div className="text-xs text-emerald-800/50">{r.credit_name}</div>
                </Cell>
                <Cell align="right" className="font-semibold">
                  {fmtMoney(r.amount)}
                  {r.note && <div className="text-xs font-normal text-emerald-800/50">{r.note}</div>}
                </Cell>
                <Cell>
                  <Badge tone={r.book === 'both' ? 'gray' : r.book === 'accounting' ? 'blue' : 'amber'}>
                    {BOOK_LABELS[r.book]}
                  </Badge>
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
