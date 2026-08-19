import { notFound } from 'next/navigation';
import {
  acceptSupplierReturn,
  addSupplierReturnLine,
  cancelSupplierReturn,
  removeSupplierReturnLine,
} from '@/app/actions/supplier-returns';
import { ActionForm } from '@/components/action-form';
import {
  Alert,
  Badge,
  Button,
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
import { fmtDate, fmtMoney, fmtQty, RETURN_STATUS, SUPPLIER_RETURN_REASONS, unitLabel } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function SupplierReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole('warehouse');
  const { id } = await params;

  const doc = await queryOne<{
    id: string;
    number: string;
    returned_on: string;
    status: string;
    reason: string;
    note: string | null;
    supplier: string;
    supplier_is_vat_payer: boolean;
    po_id: string | null;
    po_number: string | null;
    buyer_is_vat_payer: boolean;
  }>(
    `select r.id, r.number, r.returned_on, r.status, r.reason, r.note,
            s.name as supplier, s.is_vat_payer as supplier_is_vat_payer,
            r.po_id, p.number as po_number, e.is_vat_payer as buyer_is_vat_payer
       from supplier_returns r
       join suppliers s on s.id = r.supplier_id
       join legal_entities e on e.id = r.legal_entity_id
       left join purchase_orders p on p.id = r.po_id
      where r.id = $1 and r.legal_entity_id = $2`,
    [id, session.eid],
  );
  if (!doc) notFound();

  const [lines, available, items] = await Promise.all([
    query<{
      id: string;
      name: string;
      unit: string;
      qty: number;
      unit_cost: number;
      unit_vat: number;
      batch_code: string | null;
    }>(
      `select l.id, i.name, i.unit, l.qty, l.unit_cost, l.unit_vat, b.code as batch_code
         from supplier_return_lines l
         join items i on i.id = l.item_id
         left join batches b on b.id = l.batch_id
        where l.return_id = $1
        order by i.name`,
      [id],
    ),
    doc.po_id
      ? query<{ id: string; name: string; unit: string; received: number; returned: number }>(
          `select l.id, i.name, i.unit, l.received_qty as received,
                  coalesce(r.returned_qty, 0) as returned
             from purchase_order_lines l
             join items i on i.id = l.item_id
             left join v_po_line_returned r on r.po_line_id = l.id
            where l.po_id = $1 and l.received_qty > 0
            order by i.name`,
          [doc.po_id],
        )
      : Promise.resolve([]),
    query<{ id: string; name: string; unit: string; qty: number; avg_cost: number }>(
      `select i.id, i.name, i.unit, s.qty, s.avg_cost
         from items i
         join v_item_stock s on s.item_id = i.id and s.legal_entity_id = $1
        where i.is_active and i.kind in ('raw','packaging') and s.qty > 0
        order by i.name`,
      [session.eid],
    ),
  ]);

  const net = lines.reduce((s, l) => s + Number(l.qty) * Number(l.unit_cost), 0);
  const vat = lines.reduce((s, l) => s + Number(l.qty) * Number(l.unit_vat), 0);
  const isDraft = doc.status === 'draft';
  const creditable = doc.buyer_is_vat_payer && doc.supplier_is_vat_payer;

  return (
    <>
      <PageHeader
        title={`Повернення ${doc.number}`}
        subtitle={`${doc.supplier} · ${fmtDate(doc.returned_on)} · ${SUPPLIER_RETURN_REASONS[doc.reason]}`}
        action={
          <div className="flex gap-2">
            <LinkButton href={`/movements/${doc.id}`}>Дт/Кт</LinkButton>
            {doc.po_id && <LinkButton href={`/purchasing/${doc.po_id}`}>Заявка</LinkButton>}
            <LinkButton href="/purchasing/returns">← До повернень</LinkButton>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Badge tone={doc.status === 'accepted' ? 'green' : doc.status === 'cancelled' ? 'gray' : 'amber'}>
          {RETURN_STATUS[doc.status]}
        </Badge>
        {doc.po_number ? (
          <span className="text-sm text-emerald-800/70">за заявкою {doc.po_number}</span>
        ) : (
          <span className="text-sm text-amber-700">без прив’язки — партії підбираються за FEFO</span>
        )}
        {doc.note && <span className="text-sm text-emerald-800/60">{doc.note}</span>}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Вартість запасів" value={fmtMoney(net)} hint="за собівартістю оприбуткування" />
        <Stat label="Сторно кредиту з ПДВ" value={fmtMoney(vat)} />
        <Stat label="Кредиторка зменшиться на" value={fmtMoney(net + vat)} tone="good" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card title="Позиції">
            {lines.length === 0 ? (
              <Empty>Порожньо — додайте позиції справа</Empty>
            ) : (
              <Table head={['Позиція', 'Партія', 'Кількість', 'Собівартість', 'ПДВ', '']}>
                {lines.map((l) => (
                  <Row key={l.id}>
                    <Cell className="font-semibold">{l.name}</Cell>
                    <Cell className="font-mono text-xs">{l.batch_code ?? '—'}</Cell>
                    <Cell align="right">{fmtQty(l.qty, unitLabel(l.unit))}</Cell>
                    <Cell align="right">{fmtMoney(l.unit_cost)}</Cell>
                    <Cell align="right">{fmtMoney(l.unit_vat)}</Cell>
                    <Cell align="right">
                      {isDraft && (
                        <form action={removeSupplierReturnLine}>
                          <input type="hidden" name="line_id" value={l.id} />
                          <input type="hidden" name="return_id" value={doc.id} />
                          <Button variant="ghost" className="!min-h-9 !px-3">
                            ✕
                          </Button>
                        </form>
                      )}
                    </Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Card>

          <Card title="Як це вплине на облік">
            <Table head={['Дебет', 'Кредит', 'Сума', 'Що це']}>
              <Row>
                <Cell className="font-mono font-semibold">631</Cell>
                <Cell className="font-mono">201 / 204</Cell>
                <Cell align="right">{fmtMoney(net)}</Cell>
                <Cell className="text-xs">запаси повернуто, борг меншає</Cell>
              </Row>
              {creditable && (
                <Row>
                  <Cell className="font-mono font-semibold">631</Cell>
                  <Cell className="font-mono">6441</Cell>
                  <Cell align="right">{fmtMoney(vat)}</Cell>
                  <Cell className="text-xs">сторно податкового кредиту</Cell>
                </Row>
              )}
            </Table>
            {!creditable && (
              <div className="mt-3">
                <Alert tone="amber">
                  {!doc.buyer_is_vat_payer
                    ? 'Юрособа не платник ПДВ: податок сидів у собівартості, знімати з кредиту нічого.'
                    : 'Постачальник не платник ПДВ: кредиту з цієї поставки не було.'}
                </Alert>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {isDraft && (
            <Card title="Додати позицію">
              <ActionForm action={addSupplierReturnLine} submitLabel="Додати">
                <input type="hidden" name="return_id" value={doc.id} />
                {doc.po_id ? (
                  <Field label="Позиція із заявки">
                    <select name="po_line_id" required className={inputClass} defaultValue="">
                      <option value="" disabled>
                        Оберіть…
                      </option>
                      {available
                        .filter((a) => Number(a.received) - Number(a.returned) > 0.0005)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} — можна {fmtQty(Number(a.received) - Number(a.returned), unitLabel(a.unit))}
                          </option>
                        ))}
                    </select>
                  </Field>
                ) : (
                  <Field label="Номенклатура" hint="лише те, що зараз є на складі">
                    <select name="item_id" required className={inputClass} defaultValue="">
                      <option value="" disabled>
                        Оберіть…
                      </option>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name} — є {fmtQty(i.qty, unitLabel(i.unit))} по {Number(i.avg_cost).toFixed(2)}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label="Кількість">
                  <input name="qty" type="number" step="0.001" min="0" required className={inputClass} />
                </Field>
                <p className="text-xs text-emerald-800/60">
                  Собівартість система бере з приходу — за скільки партія стала на облік. Вводити її
                  руками не треба, і саме тому повернення не створює прибутку зі складу.
                </p>
              </ActionForm>
            </Card>
          )}

          {isDraft && (
            <Card title="Провести">
              {lines.length > 0 ? (
                <>
                  <p className="mb-3 text-sm text-emerald-800/70">
                    Товар піде зі складу, борг перед постачальником зменшиться на{' '}
                    {fmtMoney(net + vat)}.
                  </p>
                  <ActionForm action={acceptSupplierReturn} submitLabel="Провести повернення">
                    <input type="hidden" name="return_id" value={doc.id} />
                  </ActionForm>
                </>
              ) : (
                <p className="mb-3 text-sm text-emerald-800/70">
                  Додайте хоча б одну позицію — або скасуйте документ.
                </p>
              )}
              <form action={cancelSupplierReturn} className="mt-3">
                <input type="hidden" name="return_id" value={doc.id} />
                <Button variant="ghost">Скасувати документ</Button>
              </form>
            </Card>
          )}

          {doc.status === 'accepted' && creditable && (
            <Card title="ПДВ">
              <Alert tone="amber">
                Розрахунок коригування складає <strong>постачальник</strong>, а реєструєте його{' '}
                <strong>ви</strong>: при зменшенні суми компенсації РК подає покупець. Поки він не
                зареєстрований, кредит формально не знятий.
              </Alert>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
