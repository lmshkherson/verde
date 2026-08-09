import Link from 'next/link';
import { notFound } from 'next/navigation';
import { setRecallStatus, updateRecallLine } from '@/app/actions/recalls';
import { ActionForm } from '@/components/action-form';
import {
  Alert,
  Badge,
  Button,
  Card,
  Cell,
  Empty,
  PageHeader,
  Row,
  Stat,
  Table,
  inputClass,
} from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { fmtDate, fmtQty, unitLabel } from '@/lib/format';
import { RECALL_REASONS, RECALL_STATUS } from '@/lib/traceability';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function RecallPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole('production', 'sales', 'warehouse');
  const { id } = await params;

  const doc = await queryOne<{
    id: string;
    number: string;
    declared_on: string;
    status: string;
    reason: string;
    note: string | null;
    batch_id: string;
    batch_code: string;
    item_name: string;
    lines: number;
    notified: number;
    shipped_qty: number;
    recovered_qty: number;
  }>(
    `select r.id, r.number, r.declared_on, r.status, r.reason, r.note,
            r.batch_id, b.code as batch_code, i.name as item_name,
            p.lines, p.notified, p.shipped_qty, p.recovered_qty
       from recalls r
       join batches b on b.id = r.batch_id
       join items i on i.id = b.item_id
       join v_recall_progress p on p.recall_id = r.id
      where r.id = $1 and r.legal_entity_id = $2`,
    [id, session.eid],
  );
  if (!doc) notFound();

  const lines = await query<{
    id: string;
    customer_name: string;
    customer_phone: string | null;
    shipment_id: string | null;
    shipment_number: string | null;
    shipped_on: string | null;
    item_name: string;
    unit: string;
    batch_code: string;
    shipped_qty: number;
    recovered_qty: number;
    notified_at: string | null;
    note: string | null;
  }>(
    `select l.id, c.name as customer_name, c.phone as customer_phone,
            l.shipment_id, sh.number as shipment_number, sh.shipped_on,
            i.name as item_name, i.unit, b.code as batch_code,
            l.shipped_qty, l.recovered_qty, l.notified_at, l.note
       from recall_lines l
       join customers c on c.id = l.customer_id
       join items i on i.id = l.item_id
       join batches b on b.id = l.batch_id
       left join shipments sh on sh.id = l.shipment_id
      where l.recall_id = $1
      order by l.notified_at nulls first, c.name`,
    [id],
  );

  const open = doc.status === 'draft' || doc.status === 'announced';
  const outstanding = Number(doc.shipped_qty) - Number(doc.recovered_qty);

  return (
    <>
      <PageHeader
        title={`Відкликання ${doc.number}`}
        subtitle={`${doc.item_name} · партія ${doc.batch_code} · ${RECALL_REASONS[doc.reason]}`}
        action={
          <div className="flex gap-2">
            <LinkButtonSafe href={`/traceability/${doc.batch_id}`}>Ланцюжок партії</LinkButtonSafe>
            <LinkButtonSafe href="/recalls">← До журналу</LinkButtonSafe>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Badge tone={doc.status === 'closed' ? 'green' : doc.status === 'cancelled' ? 'gray' : 'red'}>
          {RECALL_STATUS[doc.status]}
        </Badge>
        <span className="text-sm text-emerald-800/70">оголошено {fmtDate(doc.declared_on)}</span>
        {doc.note && <span className="text-sm text-emerald-800/60">{doc.note}</span>}
      </div>

      {doc.status === 'draft' && (
        <div className="mb-4">
          <Alert tone="amber">
            Документ у підготовці. Поки не оголошено — обдзвін формально не почався.
          </Alert>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Повідомлено"
          value={`${doc.notified} / ${doc.lines}`}
          tone={doc.notified < doc.lines ? 'warn' : 'good'}
        />
        <Stat label="Відвантажено" value={fmtQty(doc.shipped_qty)} />
        <Stat label="Вилучено" value={fmtQty(doc.recovered_qty)} tone="good" />
        <Stat
          label="Лишилося в ринку"
          value={fmtQty(outstanding)}
          tone={outstanding > 0.0005 ? 'danger' : 'good'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card title="Чек-лист">
          {lines.length === 0 ? (
            <Empty>Відвантажень цієї партії не було</Empty>
          ) : (
            <Table head={['Клієнт', 'Відвантаження', 'Позиція', 'Відвантажено', 'Вилучення']}>
              {lines.map((l) => (
                <Row key={l.id}>
                  <Cell>
                    <div className="font-semibold">{l.customer_name}</div>
                    {l.customer_phone && (
                      <div className="text-xs text-emerald-800/50">{l.customer_phone}</div>
                    )}
                    {l.notified_at && (
                      <Badge tone="green">повідомлено {fmtDate(l.notified_at)}</Badge>
                    )}
                  </Cell>
                  <Cell>
                    {l.shipment_id ? (
                      <Link
                        href={`/shipments/${l.shipment_id}/print`}
                        className="font-semibold text-emerald-700 hover:underline"
                      >
                        {l.shipment_number}
                      </Link>
                    ) : (
                      '—'
                    )}
                    <div className="text-xs text-emerald-800/50">
                      {l.shipped_on ? fmtDate(l.shipped_on) : ''}
                    </div>
                    <div className="font-mono text-xs text-emerald-800/50">{l.batch_code}</div>
                  </Cell>
                  <Cell>{l.item_name}</Cell>
                  <Cell align="right" className="font-semibold">
                    {fmtQty(l.shipped_qty, unitLabel(l.unit))}
                  </Cell>
                  <Cell>
                    {open ? (
                      <ActionForm action={updateRecallLine} submitLabel="Зберегти" hideSuccess>
                        <input type="hidden" name="recall_id" value={doc.id} />
                        <input type="hidden" name="line_id" value={l.id} />
                        <input
                          name="recovered_qty"
                          type="number"
                          step="0.001"
                          min="0"
                          defaultValue={l.recovered_qty}
                          className={`${inputClass} !min-h-9 text-sm`}
                        />
                        <label className="flex items-center gap-2">
                          <input
                            name="notified"
                            type="checkbox"
                            defaultChecked={Boolean(l.notified_at)}
                            className="size-5 accent-emerald-700"
                          />
                          <span className="text-xs font-semibold text-emerald-900">Повідомлено</span>
                        </label>
                        <input
                          name="note"
                          defaultValue={l.note ?? ''}
                          placeholder="коментар"
                          className={`${inputClass} !min-h-9 text-sm`}
                        />
                      </ActionForm>
                    ) : (
                      <span className="font-semibold">{fmtQty(l.recovered_qty)}</span>
                    )}
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Стан документа">
            <div className="space-y-2">
              {doc.status === 'draft' && (
                <form action={setRecallStatus}>
                  <input type="hidden" name="recall_id" value={doc.id} />
                  <input type="hidden" name="status" value="announced" />
                  <Button variant="danger">Оголосити</Button>
                </form>
              )}
              {doc.status === 'announced' && (
                <>
                  {outstanding > 0.0005 && (
                    <Alert tone="amber">
                      У ринку ще {fmtQty(outstanding)}. Завершувати відкликання з незакритим
                      залишком можна, але причину варто записати в коментарі.
                    </Alert>
                  )}
                  <form action={setRecallStatus}>
                    <input type="hidden" name="recall_id" value={doc.id} />
                    <input type="hidden" name="status" value="closed" />
                    <Button>Завершити</Button>
                  </form>
                </>
              )}
              {open && (
                <form action={setRecallStatus}>
                  <input type="hidden" name="recall_id" value={doc.id} />
                  <input type="hidden" name="status" value="cancelled" />
                  <Button variant="ghost">Скасувати документ</Button>
                </form>
              )}
            </div>
          </Card>

          <Card title="Що робити з поверненим">
            <p className="text-sm text-emerald-800/80">
              Вилучений товар оформлюється звичайним <strong>поверненням від клієнта</strong> зі
              знятою галочкою «придатний»: тоді вартість піде у втрати, а не назад у запаси, і дохід
              з ПДВ сторнуються як належить.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

/** Локальна обгортка, щоб не тягнути LinkButton у шапку через два імпорти. */
function LinkButtonSafe({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center justify-center rounded-xl border border-emerald-900/15 bg-white px-4 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-50"
    >
      {children}
    </Link>
  );
}
