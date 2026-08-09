import Link from 'next/link';
import { Badge, Card, Cell, Empty, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { fmtDate, fmtQty, unitLabel } from '@/lib/format';
import { INSPECTION_STATUS, QUALITY_STATUS } from '@/lib/quality';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function QualityPage() {
  const session = await requireRole('warehouse', 'production');

  const [acts, blocked, expiring, unapproved] = await Promise.all([
    query<{
      id: string;
      number: string;
      received_on: string;
      status: string;
      supplier: string | null;
      purchase_number: string | null;
      lines: number;
      accepted: number;
      rejected: number;
      pending: number;
      without_docs: number;
    }>(
      `select a.id, a.number, a.received_on, a.status,
              s.name as supplier, p.number as purchase_number,
              g.lines, g.accepted, g.rejected, g.pending, g.without_docs
         from incoming_inspections a
         left join suppliers s on s.id = a.supplier_id
         left join purchase_orders p on p.id = a.po_id
         join v_inspection_summary g on g.inspection_id = a.id
        where a.legal_entity_id = $1
        order by a.received_on desc, a.number desc
        limit 40`,
      [session.eid],
    ),
    query<{
      batch_id: string;
      code: string;
      quality_status: string;
      quality_note: string | null;
      item_name: string;
      unit: string;
      qty: number;
      valid_docs: number | null;
      supplier_name: string | null;
      purchase_number: string | null;
      inspection_id: string | null;
    }>(
      `select b.*, l.inspection_id
         from v_blocked_batches b
         left join lateral (
           select l.inspection_id from incoming_inspection_lines l
            where l.batch_id = b.batch_id
            order by l.id desc limit 1
         ) l on true
        where b.legal_entity_id = $1
        order by b.quality_status, b.item_name`,
      [session.eid],
    ),
    query<{
      id: string;
      number: string;
      kind: string;
      valid_until: string;
      batch_code: string;
      item_name: string;
      days_left: number;
    }>(
      `select d.id, d.number, d.kind, d.valid_until, b.code as batch_code, i.name as item_name,
              (d.valid_until - current_date) as days_left
         from batch_documents d
         join batches b on b.id = d.batch_id
         join items i on i.id = b.item_id
         join v_stock_batches sb on sb.batch_id = b.id and sb.legal_entity_id = $1
        where d.valid_until is not null and d.valid_until < current_date + 30
        order by d.valid_until`,
      [session.eid],
    ),
    query<{ id: string; name: string; approved_until: string | Date | null }>(
      `select id, name, approved_until from suppliers
        where is_active
          and (not is_approved or (approved_until is not null and approved_until < current_date))
        order by name`,
    ),
  ]);

  const quarantine = blocked.filter((b) => b.quality_status === 'quarantine');
  const rejected = blocked.filter((b) => b.quality_status === 'rejected');
  const openActs = acts.filter((a) => a.status === 'draft');

  return (
    <>
      <PageHeader
        title="Вхідний контроль"
        subtitle="Партія без документа й перевірки у виробництво не потрапляє"
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="У карантині"
          value={String(quarantine.length)}
          hint="чекають перевірки"
          tone={quarantine.length > 0 ? 'warn' : 'good'}
        />
        <Stat
          label="Забраковано"
          value={String(rejected.length)}
          hint="лежать на складі, до використання не допущені"
          tone={rejected.length > 0 ? 'danger' : 'default'}
        />
        <Stat
          label="Актів у роботі"
          value={String(openActs.length)}
          tone={openActs.length > 0 ? 'warn' : 'good'}
        />
        <Stat
          label="Документи спливають"
          value={String(expiring.length)}
          hint="менше 30 днів"
          tone={expiring.length > 0 ? 'warn' : 'default'}
        />
      </div>

      {unapproved.length > 0 && (
        <Card className="mb-4" title="Постачальники поза переліком затверджених">
          <p className="mb-3 text-sm text-emerald-800/70">
            Приймати сировину можна лише від затверджених постачальників — це передумова системи
            НАССР. Поки постачальника не затверджено, акт вхідного контролю не дасть прийняти його
            партію.
          </p>
          <div className="flex flex-wrap gap-2">
            {unapproved.map((s) => (
              <Link
                key={s.id}
                href={`/purchasing/suppliers/${s.id}`}
                className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-200"
              >
                {s.name}
                {s.approved_until ? ` · до ${fmtDate(s.approved_until)}` : ''}
              </Link>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Не допущені партії">
          {blocked.length === 0 ? (
            <Empty>Усе, що лежить на складі, перевірене</Empty>
          ) : (
            <Table head={['Позиція', 'Партія', 'Кількість', 'Стан']}>
              {blocked.map((b) => (
                <Row key={b.batch_id}>
                  <Cell>
                    <Link
                      href={`/traceability/${b.batch_id}`}
                      className="font-semibold text-emerald-800 hover:underline"
                    >
                      {b.item_name}
                    </Link>
                    <div className="text-xs text-emerald-800/50">
                      {b.supplier_name ?? '—'}
                      {b.purchase_number ? ` · ${b.purchase_number}` : ''}
                    </div>
                  </Cell>
                  <Cell>
                    <div className="text-xs">{b.code}</div>
                    <div className="text-xs text-emerald-800/50">
                      {Number(b.valid_docs ?? 0) > 0
                        ? `документів: ${b.valid_docs}`
                        : 'документів немає'}
                    </div>
                  </Cell>
                  <Cell align="right">
                    {fmtQty(b.qty)} {unitLabel(b.unit)}
                  </Cell>
                  <Cell>
                    <Badge tone={b.quality_status === 'rejected' ? 'red' : 'amber'}>
                      {QUALITY_STATUS[b.quality_status]}
                    </Badge>
                    {b.inspection_id && (
                      <div className="mt-1">
                        <Link
                          href={`/quality/${b.inspection_id}`}
                          className="text-xs text-emerald-700 hover:underline"
                        >
                          перейти до акта
                        </Link>
                      </div>
                    )}
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Акти вхідного контролю">
          {acts.length === 0 ? (
            <Empty>Приймань ще не було</Empty>
          ) : (
            <Table head={['Акт', 'Постачальник', 'Позиції', 'Стан']}>
              {acts.map((a) => (
                <Row key={a.id}>
                  <Cell>
                    <Link
                      href={`/quality/${a.id}`}
                      className="font-semibold text-emerald-800 hover:underline"
                    >
                      {a.number}
                    </Link>
                    <div className="text-xs text-emerald-800/50">{fmtDate(a.received_on)}</div>
                  </Cell>
                  <Cell>
                    <div className="text-xs">{a.supplier ?? '—'}</div>
                    <div className="text-xs text-emerald-800/50">{a.purchase_number ?? ''}</div>
                  </Cell>
                  <Cell align="right">
                    <div className="text-xs">
                      {a.accepted > 0 && <span className="text-emerald-700">✓ {a.accepted}</span>}
                      {a.rejected > 0 && <span className="ml-2 text-red-600">✕ {a.rejected}</span>}
                      {a.pending > 0 && <span className="ml-2 text-amber-600">? {a.pending}</span>}
                    </div>
                    <div className="text-xs text-emerald-800/50">усього {a.lines}</div>
                  </Cell>
                  <Cell>
                    <Badge
                      tone={
                        a.status === 'completed' ? 'green' : a.status === 'cancelled' ? 'gray' : 'amber'
                      }
                    >
                      {INSPECTION_STATUS[a.status]}
                    </Badge>
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>
      </div>

      {expiring.length > 0 && (
        <Card className="mt-4" title="Документи, що спливають">
          <Table head={['Партія', 'Документ', 'Дійсний до']}>
            {expiring.map((d) => (
              <Row key={d.id}>
                <Cell>
                  <div className="text-sm">{d.item_name}</div>
                  <div className="text-xs text-emerald-800/50">{d.batch_code}</div>
                </Cell>
                <Cell>{d.number}</Cell>
                <Cell align="right">
                  <span className={d.days_left < 0 ? 'font-semibold text-red-600' : 'text-amber-700'}>
                    {fmtDate(d.valid_until)}
                  </span>
                  <div className="text-xs text-emerald-800/50">
                    {d.days_left < 0 ? 'прострочений' : `лишилось ${d.days_left} дн.`}
                  </div>
                </Cell>
              </Row>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}
