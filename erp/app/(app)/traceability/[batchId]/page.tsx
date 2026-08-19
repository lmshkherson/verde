import Link from 'next/link';
import { notFound } from 'next/navigation';
import { declareRecall } from '@/app/actions/recalls';
import { setBatchQuality } from '@/app/actions/quality';
import { ActionForm } from '@/components/action-form';
import {
  Alert,
  Badge,
  Card,
  Cell,
  Empty,
  Field,
  inputClass,
  LinkButton,
  PageHeader,
  Row,
  Stat,
  Table,
} from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { fmtDate, fmtQty, unitLabel } from '@/lib/format';
import { DOC_KINDS, QUALITY_STATUS } from '@/lib/quality';
import { affectedShipments, ancestors, descendants, RECALL_REASONS } from '@/lib/traceability';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function BatchTracePage({ params }: { params: Promise<{ batchId: string }> }) {
  const session = await requireRole('production', 'sales', 'warehouse');
  const { batchId } = await params;

  const batch = await queryOne<{
    id: string;
    code: string;
    item_name: string;
    sku: string;
    unit: string;
    produced_on: string | null;
    expires_on: string | null;
    source: string;
    supplier_name: string | null;
    supplier_edrpou: string | null;
    purchase_number: string | null;
    purchase_order_id: string | null;
    production_number: string | null;
    production_order_id: string | null;
    quality_status: string;
    quality_note: string | null;
    on_hand: number;
  }>(
    `select b.id, b.code, i.name as item_name, i.sku, i.unit, b.produced_on, b.expires_on, b.source,
            b.quality_status, b.quality_note,
            o.supplier_name, o.supplier_edrpou, o.purchase_number, o.purchase_order_id,
            o.production_number, o.production_order_id,
            coalesce((select sum(m.qty) from stock_moves m
                       where m.batch_id = b.id and m.legal_entity_id = $2), 0) as on_hand
       from batches b
       join items i on i.id = b.item_id
       left join v_batch_origin o on o.batch_id = b.id
      where b.id = $1`,
    [batchId, session.eid],
  );
  if (!batch) notFound();

  const [back, forward, affected, existingRecall, documents] = await Promise.all([
    ancestors(batchId),
    descendants(batchId),
    affectedShipments(batchId, session.eid),
    queryOne<{ id: string; number: string; status: string }>(
      `select id, number, status from recalls
        where batch_id = $1 and legal_entity_id = $2 and status <> 'cancelled'
        order by declared_on desc limit 1`,
      [batchId, session.eid],
    ),
    query<{
      id: string;
      kind: string;
      number: string;
      issuer: string | null;
      valid_until: string | null;
    }>(
      `select id, kind, number, issuer, valid_until from batch_documents
        where batch_id = $1 order by kind, number`,
      [batchId],
    ),
  ]);

  const customers = new Set(affected.map((a) => a.customer_id));
  const totalQty = affected.reduce((s, a) => s + Number(a.qty), 0);

  return (
    <>
      <PageHeader
        title={batch.code}
        subtitle={`${batch.item_name} · ${batch.sku}`}
        action={
          <div className="flex gap-2">
            <LinkButton href={`/stock/${batch.id}`}>Картка позиції</LinkButton>
            <LinkButton href="/traceability">← До пошуку</LinkButton>
          </div>
        }
      />

      {existingRecall && (
        <div className="mb-4">
          <Alert tone="amber">
            По цій партії вже є відкликання{' '}
            <Link href={`/recalls/${existingRecall.id}`} className="font-semibold underline">
              {existingRecall.number}
            </Link>
            .
          </Alert>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Залишок партії" value={fmtQty(batch.on_hand, unitLabel(batch.unit))} />
        <Stat
          label="Придатна до"
          value={batch.expires_on ? fmtDate(batch.expires_on) : '—'}
          tone={
            batch.expires_on && new Date(batch.expires_on) < new Date() ? 'danger' : 'default'
          }
        />
        <Stat
          label="Відвантажено клієнтам"
          value={fmtQty(totalQty)}
          hint={`${affected.length} відвантажень`}
          tone={affected.length > 0 ? 'warn' : 'default'}
        />
        <Stat
          label="Клієнтів зачеплено"
          value={String(customers.size)}
          tone={customers.size > 0 ? 'warn' : 'default'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card title="Крок назад — звідки взялося">
            {batch.source === 'purchase' && batch.supplier_name ? (
              <p className="mb-3 text-sm text-emerald-800/80">
                Партія прийшла від <strong>{batch.supplier_name}</strong>
                {batch.supplier_edrpou ? ` (ЄДРПОУ ${batch.supplier_edrpou})` : ''} за заявкою{' '}
                {batch.purchase_order_id ? (
                  <Link href={`/purchasing/${batch.purchase_order_id}`} className="underline">
                    {batch.purchase_number}
                  </Link>
                ) : (
                  batch.purchase_number
                )}
                .
              </p>
            ) : batch.production_number ? (
              <p className="mb-3 text-sm text-emerald-800/80">
                Партію випущено варкою{' '}
                {batch.production_order_id ? (
                  <Link href={`/production/${batch.production_order_id}`} className="underline">
                    {batch.production_number}
                  </Link>
                ) : (
                  batch.production_number
                )}
                .
              </p>
            ) : (
              <p className="mb-3 text-sm text-emerald-800/80">
                Вхідний залишок — партія існувала до запуску системи.
              </p>
            )}

            {back.length === 0 ? (
              <Empty>Сировини під нею немає — це початок ланцюжка</Empty>
            ) : (
              <Table head={['Рівень', 'Партія сировини', 'Позиція', 'Через варку']}>
                {back.map((n) => (
                  <Row key={n.batch_id}>
                    <Cell>
                      <Badge tone="gray">−{n.depth}</Badge>
                    </Cell>
                    <Cell>
                      <Link
                        href={`/traceability/${n.batch_id}`}
                        className="font-mono text-xs font-semibold text-emerald-800 hover:underline"
                      >
                        {n.code}
                      </Link>
                    </Cell>
                    <Cell>{n.item_name}</Cell>
                    <Cell className="text-xs text-emerald-800/60">
                      {n.production_number ?? '—'}
                    </Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Card>

          <Card title="Крок вперед — що з неї зроблено">
            {forward.length === 0 ? (
              <Empty>У виробництво не йшла — це кінець ланцюжка</Empty>
            ) : (
              <Table head={['Рівень', 'Партія', 'Позиція', 'Варка', 'Придатна до']}>
                {forward.map((n) => (
                  <Row key={n.batch_id}>
                    <Cell>
                      <Badge tone="green">+{n.depth}</Badge>
                    </Cell>
                    <Cell>
                      <Link
                        href={`/traceability/${n.batch_id}`}
                        className="font-mono text-xs font-semibold text-emerald-800 hover:underline"
                      >
                        {n.code}
                      </Link>
                    </Cell>
                    <Cell>{n.item_name}</Cell>
                    <Cell className="text-xs text-emerald-800/60">{n.production_number ?? '—'}</Cell>
                    <Cell>{n.expires_on ? fmtDate(n.expires_on) : '—'}</Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Card>

          <Card title="Куди поїхало — клієнти">
            {affected.length === 0 ? (
              <Empty>Нічого з цієї партії клієнтам ще не відвантажували</Empty>
            ) : (
              <Table head={['Клієнт', 'Відвантаження', 'Позиція', 'Партія', 'Кількість']}>
                {affected.map((a) => (
                  <Row key={`${a.shipment_id}-${a.batch_id}-${a.item_id}`}>
                    <Cell>
                      <div className="font-semibold">{a.customer_name}</div>
                      {a.customer_phone && (
                        <div className="text-xs text-emerald-800/50">{a.customer_phone}</div>
                      )}
                    </Cell>
                    <Cell>
                      <Link
                        href={`/shipments/${a.shipment_id}/print`}
                        className="font-semibold text-emerald-700 hover:underline"
                      >
                        {a.shipment_number}
                      </Link>
                      <div className="text-xs text-emerald-800/50">{fmtDate(a.shipped_on)}</div>
                    </Cell>
                    <Cell>{a.item_name}</Cell>
                    <Cell className="font-mono text-xs">{a.batch_code}</Cell>
                    <Cell align="right" className="font-semibold">
                      {fmtQty(a.qty, unitLabel(a.unit))}
                    </Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card
            title="Стан партії"
            action={
              <Badge
                tone={
                  batch.quality_status === 'released'
                    ? 'green'
                    : batch.quality_status === 'rejected'
                      ? 'red'
                      : 'amber'
                }
              >
                {QUALITY_STATUS[batch.quality_status]}
              </Badge>
            }
          >
            {batch.quality_note && (
              <p className="mb-3 text-sm text-emerald-800/70">{batch.quality_note}</p>
            )}

            {documents.length > 0 ? (
              <ul className="mb-3 space-y-1 text-sm text-emerald-800/80">
                {documents.map((d) => (
                  <li key={d.id}>
                    {DOC_KINDS[d.kind] ?? d.kind} № {d.number}
                    {d.valid_until ? ` · до ${fmtDate(d.valid_until)}` : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-3 text-sm text-emerald-800/60">Документів якості на партію немає.</p>
            )}

            <p className="mb-3 text-sm text-emerald-800/70">
              Партія в карантині або в браку не підбирається ні у варку, ні у відвантаження. Це та
              сама кнопка, якої бракує в день скарги: зупинити зараз, розібратися потім.
            </p>

            <ActionForm action={setBatchQuality} submitLabel="Змінити стан" variant="ghost">
              <input type="hidden" name="batch_id" value={batch.id} />
              <Field label="Стан">
                <select name="quality_status" className={inputClass} defaultValue={batch.quality_status}>
                  {Object.entries(QUALITY_STATUS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Підстава" hint="обов'язкова для карантину й браку">
                <input name="quality_note" className={inputClass} />
              </Field>
            </ActionForm>
          </Card>

          <Card title="Оголосити відкликання">
            <p className="mb-3 text-sm text-emerald-800/70">
              Документ зафіксує цей самий перелік як чек-лист: кого повідомили, скільки повернули.
              Список копіюється, а не перераховується щоразу — у день відкликання він не має
              «пливти» від нового відвантаження.
            </p>
            {affected.length === 0 && (
              <div className="mb-3">
                <Alert tone="green">
                  Нічого не відвантажено — досить списати залишок на складі, відкликання не
                  потрібне.
                </Alert>
              </div>
            )}
            <ActionForm action={declareRecall} submitLabel="Оголосити відкликання" variant="danger">
              <input type="hidden" name="batch_id" value={batch.id} />
              <Field label="Причина">
                <select name="reason" className={inputClass} defaultValue="quality">
                  {Object.entries(RECALL_REASONS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Дата">
                <input
                  name="declared_on"
                  type="date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  className={inputClass}
                />
              </Field>
              <Field label="Опис проблеми">
                <input name="note" className={inputClass} />
              </Field>
            </ActionForm>
          </Card>

          <Card title="Що це доводить">
            <p className="text-sm text-emerald-800/80">
              Закон вимагає від виробника харчових продуктів простежуваності «крок назад — крок
              вперед». Цей екран і є відповіддю: за партією сировини видно всіх клієнтів, за
              партією батончика — всіх постачальників. Ланцюжок проходить крізь напівфабрикати на
              будь-яку глибину, бо будується рекурсивно з журналу рухів.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
