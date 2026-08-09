import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, Card, Cell, Empty, LinkButton, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { fmtDate, fmtMoney, fmtQty, MOVE_TYPES, unitLabel } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const BOOK_LABELS: Record<string, string> = {
  both: 'Обидві книги',
  accounting: 'Тільки бухгалтерський',
  management: 'Тільки управлінський',
};

/**
 * Документ шукаємо перебором по таблицях: у проводках і рухах лежить лише
 * ідентифікатор, а назва потрібна людині. Запитів кілька, але вони точкові.
 */
async function resolveDocument(docId: string) {
  const candidates: { sql: string; kind: string; href: (id: string) => string | null }[] = [
    {
      kind: 'Заявка постачальнику',
      sql: `select number as title, ordered_on as date from purchase_orders where id = $1`,
      href: (id) => `/purchasing/${id}`,
    },
    {
      kind: 'Виробниче замовлення',
      sql: `select number as title, coalesce(finished_at::date, planned_for) as date from production_orders where id = $1`,
      href: (id) => `/production/${id}`,
    },
    {
      kind: 'Відвантаження',
      sql: `select number as title, shipped_on as date from shipments where id = $1`,
      href: () => null,
    },
    {
      kind: 'Повернення постачальнику',
      sql: `select number as title, returned_on as date from supplier_returns where id = $1`,
      href: (id) => `/purchasing/returns/${id}`,
    },
    {
      kind: 'Повернення від клієнта',
      sql: `select number as title, returned_on as date from customer_returns where id = $1`,
      href: (id) => `/returns/${id}`,
    },
    {
      kind: 'Замовлення клієнта',
      sql: `select number as title, ordered_on as date from sales_orders where id = $1`,
      href: (id) => `/sales/${id}`,
    },
    {
      kind: 'Основний засіб',
      sql: `select name as title, acquired_on as date from fixed_assets where id = $1`,
      href: () => '/assets',
    },
    {
      kind: 'Податкова накладна',
      sql: `select number as title, issued_on as date from tax_invoices where id = $1`,
      href: () => '/vat',
    },
    {
      kind: 'Витрата',
      sql: `select coalesce(description, category) as title, spent_on as date from expenses where id = $1`,
      href: () => '/pl',
    },
    {
      kind: 'Нарахування зарплати',
      sql: `select to_char(period, 'MM.YYYY') as title, period as date from payroll_runs where id = $1`,
      href: () => '/payroll',
    },
    {
      kind: 'Амортизація',
      sql: `select to_char(period, 'MM.YYYY') as title, period as date from depreciation_runs where id = $1`,
      href: () => '/assets',
    },
    {
      kind: 'Оплата постачальнику',
      sql: `select to_char(paid_on, 'DD.MM.YYYY') as title, paid_on as date from supplier_payments where id = $1`,
      href: () => '/purchasing/suppliers',
    },
    {
      kind: 'Оплата від покупця',
      sql: `select to_char(paid_on, 'DD.MM.YYYY') as title, paid_on as date from payments where id = $1`,
      href: () => '/sales',
    },
    {
      kind: 'Запис реєстру ПДВ',
      sql: `select coalesce(doc_number, 'запис') as title, occurred_on as date from vat_entries where id = $1`,
      href: () => '/vat',
    },
  ];

  for (const c of candidates) {
    const row = await queryOne<{ title: string; date: string | null }>(c.sql, [docId]);
    if (row) return { kind: c.kind, title: row.title, date: row.date, href: c.href(docId) };
  }
  return null;
}

export default async function DocumentMovementsPage({ params }: { params: Promise<{ docId: string }> }) {
  const session = await requireRole();
  const { docId } = await params;

  const doc = await resolveDocument(docId);
  if (!doc) notFound();

  const [postings, stockMoves, vatEntries] = await Promise.all([
    query<{
      id: number;
      posted_on: string;
      book: string;
      debit_code: string;
      debit_name: string;
      credit_code: string;
      credit_name: string;
      amount: number;
      note: string | null;
      description: string | null;
    }>(
      `select p.id, p.posted_on, p.book, p.debit_code, da.name as debit_name,
              p.credit_code, ca.name as credit_name, p.amount, p.note, b.description
         from postings p
         join posting_batches b on b.id = p.batch_id
         join chart_of_accounts da on da.code = p.debit_code
         join chart_of_accounts ca on ca.code = p.credit_code
        where b.doc_id = $1 and p.legal_entity_id = $2
        order by p.posted_on, p.id`,
      [docId, session.eid],
    ),
    query<{
      id: number;
      moved_at: string;
      move_type: string;
      qty: number;
      unit_cost: number;
      note: string | null;
      item_id: string;
      name: string;
      unit: string;
      batch_code: string | null;
      warehouse: string;
    }>(
      `select m.id, m.moved_at, m.move_type, m.qty, m.unit_cost, m.note,
              i.id as item_id, i.name, i.unit, b.code as batch_code, w.name as warehouse
         from stock_moves m
         join items i on i.id = m.item_id
         join warehouses w on w.id = m.warehouse_id
         left join batches b on b.id = m.batch_id
        where m.doc_id = $1 and m.legal_entity_id = $2
        order by m.moved_at, m.id`,
      [docId, session.eid],
    ),
    query<{ id: string; kind: string; occurred_on: string; base_amount: number; vat_amount: number; counterparty_name: string | null }>(
      `select id, kind, occurred_on, base_amount, vat_amount, counterparty_name
         from vat_entries
        where (doc_id = $1 or id = $1) and legal_entity_id = $2
        order by occurred_on`,
      [docId, session.eid],
    ),
  ]);

  // Документ має бути збалансований у кожній книзі окремо.
  const balance = (book: 'accounting' | 'management') =>
    postings
      .filter((p) => p.book === 'both' || p.book === book)
      .reduce((acc, p) => acc + Number(p.amount), 0);

  const accountingTotal = balance('accounting');
  const managementTotal = balance('management');
  const divergent = postings.filter((p) => p.book !== 'both');

  return (
    <>
      <PageHeader
        title={`Рухи документа ${doc.title}`}
        subtitle={`${doc.kind} · ${fmtDate(doc.date)}`}
        action={doc.href ? <LinkButton href={doc.href}>← До документа</LinkButton> : undefined}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Проводок" value={String(postings.length)} />
        <Stat label="Складських рухів" value={String(stockMoves.length)} />
        <Stat label="Сума в бухобліку" value={fmtMoney(accountingTotal)} />
        <Stat
          label="Сума в управлінському"
          value={fmtMoney(managementTotal)}
          tone={Math.abs(accountingTotal - managementTotal) > 0.01 ? 'warn' : 'default'}
          hint={
            Math.abs(accountingTotal - managementTotal) > 0.01
              ? 'книги розходяться на цьому документі'
              : 'книги збігаються'
          }
        />
      </div>

      {divergent.length > 0 && (
        <div className="mb-4">
          <Alert tone="amber">
            Цей документ проводиться по-різному в двох обліках — нижче такі проводки позначені.
          </Alert>
        </div>
      )}

      <div className="grid gap-4">
        <Card title="Бухгалтерські проводки">
          {postings.length === 0 ? (
            <Empty>
              Проводок немає. Можливо, період ще не згенеровано — це робиться на сторінці оборотки.
            </Empty>
          ) : (
            <Table head={['Дата', 'Дебет', 'Кредит', 'Сума', 'Книга', 'Пояснення']}>
              {postings.map((p) => (
                <Row key={p.id}>
                  <Cell>{fmtDate(p.posted_on)}</Cell>
                  <Cell>
                    <span className="font-mono font-semibold">{p.debit_code}</span>
                    <div className="text-xs text-emerald-800/50">{p.debit_name}</div>
                  </Cell>
                  <Cell>
                    <span className="font-mono font-semibold">{p.credit_code}</span>
                    <div className="text-xs text-emerald-800/50">{p.credit_name}</div>
                  </Cell>
                  <Cell align="right" className="font-semibold">
                    {fmtMoney(p.amount)}
                  </Cell>
                  <Cell>
                    <Badge tone={p.book === 'both' ? 'gray' : p.book === 'accounting' ? 'blue' : 'amber'}>
                      {BOOK_LABELS[p.book]}
                    </Badge>
                  </Cell>
                  <Cell className="text-xs text-emerald-800/60">{p.note ?? p.description ?? '—'}</Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Рухи по складу">
          {stockMoves.length === 0 ? (
            <Empty>Цей документ складу не торкався</Empty>
          ) : (
            <Table head={['Дата', 'Позиція', 'Операція', 'Склад', 'Кількість', 'Сума']}>
              {stockMoves.map((m) => (
                <Row key={m.id}>
                  <Cell>{fmtDate(m.moved_at)}</Cell>
                  <Cell>
                    <Link href={`/stock/${m.item_id}`} className="font-semibold text-emerald-800 hover:underline">
                      {m.name}
                    </Link>
                    <div className="font-mono text-xs text-emerald-800/50">{m.batch_code ?? '—'}</div>
                  </Cell>
                  <Cell>{MOVE_TYPES[m.move_type] ?? m.move_type}</Cell>
                  <Cell>{m.warehouse}</Cell>
                  <Cell
                    align="right"
                    className={m.qty > 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-red-600'}
                  >
                    {m.qty > 0 ? '+' : ''}
                    {fmtQty(m.qty, unitLabel(m.unit))}
                  </Cell>
                  <Cell align="right">{fmtMoney(Math.abs(m.qty) * m.unit_cost)}</Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Реєстр ПДВ">
          {vatEntries.length === 0 ? (
            <Empty>Записів у реєстрі ПДВ немає</Empty>
          ) : (
            <Table head={['Дата', 'Вид', 'Контрагент', 'База', 'ПДВ']}>
              {vatEntries.map((v) => (
                <Row key={v.id}>
                  <Cell>{fmtDate(v.occurred_on)}</Cell>
                  <Cell>
                    <Badge tone={v.kind === 'liability' ? 'amber' : 'green'}>
                      {v.kind === 'liability' ? 'Зобов’язання' : 'Податковий кредит'}
                    </Badge>
                  </Cell>
                  <Cell>{v.counterparty_name ?? '—'}</Cell>
                  <Cell align="right">{fmtMoney(v.base_amount)}</Cell>
                  <Cell align="right" className="font-semibold">
                    {fmtMoney(v.vat_amount)}
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
