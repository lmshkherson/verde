import Link from 'next/link';
import { Badge, Card, Cell, Empty, LinkButton, PageHeader, Row, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { fmtDate, fmtQty } from '@/lib/format';
import { RECALL_REASONS, RECALL_STATUS } from '@/lib/traceability';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function RecallsPage() {
  const session = await requireRole('production', 'sales', 'warehouse');

  const recalls = await query<{
    id: string;
    number: string;
    declared_on: string;
    status: string;
    reason: string;
    batch_code: string;
    item_name: string;
    lines: number;
    notified: number;
    shipped_qty: number;
    recovered_qty: number;
  }>(
    `select r.id, r.number, r.declared_on, r.status, r.reason,
            b.code as batch_code, i.name as item_name,
            p.lines, p.notified, p.shipped_qty, p.recovered_qty
       from recalls r
       join batches b on b.id = r.batch_id
       join items i on i.id = b.item_id
       join v_recall_progress p on p.recall_id = r.id
      where r.legal_entity_id = $1
      order by r.declared_on desc, r.number desc`,
    [session.eid],
  );

  return (
    <>
      <PageHeader
        title="Відкликання продукту"
        subtitle="Чек-лист обдзвону й вилучення по кожному відвантаженню"
        action={<LinkButton href="/traceability">Простежуваність</LinkButton>}
      />

      <Card title="Журнал">
        {recalls.length === 0 ? (
          <Empty>
            Відкликань не було. Оголошується з картки партії на сторінці простежуваності.
          </Empty>
        ) : (
          <Table head={['Документ', 'Партія', 'Причина', 'Обдзвін', 'Вилучено', 'Стан']}>
            {recalls.map((r) => (
              <Row key={r.id}>
                <Cell>
                  <Link
                    href={`/recalls/${r.id}`}
                    className="font-semibold text-emerald-800 hover:underline"
                  >
                    {r.number}
                  </Link>
                  <div className="text-xs text-emerald-800/50">{fmtDate(r.declared_on)}</div>
                </Cell>
                <Cell>
                  <div className="font-mono text-xs">{r.batch_code}</div>
                  <div className="text-xs text-emerald-800/50">{r.item_name}</div>
                </Cell>
                <Cell>
                  <Badge tone="red">{RECALL_REASONS[r.reason]}</Badge>
                </Cell>
                <Cell align="right">
                  <span className={r.notified < r.lines ? 'font-semibold text-amber-600' : ''}>
                    {r.notified} / {r.lines}
                  </span>
                </Cell>
                <Cell align="right">
                  {fmtQty(r.recovered_qty)} / {fmtQty(r.shipped_qty)}
                </Cell>
                <Cell>
                  <Badge
                    tone={
                      r.status === 'closed' ? 'green' : r.status === 'cancelled' ? 'gray' : 'amber'
                    }
                  >
                    {RECALL_STATUS[r.status]}
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
