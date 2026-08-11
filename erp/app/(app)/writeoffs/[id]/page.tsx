import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  cancelWriteOff,
  postWriteOff,
  removeWriteOffLine,
  saveWriteOffLines,
  updateWriteOffHeader,
} from '@/app/actions/writeoffs';
import { ActionForm } from '@/components/action-form';
import { WriteOffEntry } from '@/components/writeoff-entry';
import {
  Alert,
  Badge,
  Button,
  Card,
  Cell,
  Empty,
  Field,
  LinkButton,
  PageHeader,
  Row,
  Stat,
  Table,
  inputClass,
} from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { EXPENSE_CATEGORIES, fmtDate, fmtMoney, fmtQty, isoDay, unitLabel } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = {
  draft: 'Чернетка',
  posted: 'Проведено',
  cancelled: 'Скасовано',
};

export default async function WriteOffPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('warehouse', 'production', 'sales');
  const { id } = await params;

  const doc = await queryOne<{
    id: string;
    number: string;
    written_off_on: string | Date;
    status: string;
    category: string;
    reason: string | null;
    note: string | null;
    warehouse_id: string | null;
    warehouse_name: string | null;
    so_id: string | null;
    so_number: string | null;
    customer_name: string | null;
    shipment_id: string | null;
    shipment_number: string | null;
    entity_name: string;
    entity_is_vat_payer: boolean;
    cost: number | null;
    vat_amount: number | null;
  }>(
    // Документ живе у своїй юрособі й відкривається незалежно від перемикача.
    `select w.id, w.number, w.written_off_on, w.status, w.category, w.reason, w.note,
            w.warehouse_id, wh.name as warehouse_name,
            w.so_id, o.number as so_number, c.name as customer_name,
            w.shipment_id, sh.number as shipment_number,
            e.short_name as entity_name, e.is_vat_payer as entity_is_vat_payer,
            (select sum(x.amount_net) from expenses x where x.write_off_id = w.id) as cost,
            (select sum(v.vat_amount) from vat_entries v
              where v.doc_type = 'write_off_act' and v.doc_id = w.id) as vat_amount
       from write_offs w
       join legal_entities e on e.id = w.legal_entity_id
       left join warehouses wh on wh.id = w.warehouse_id
       left join sales_orders o on o.id = w.so_id
       left join customers c on c.id = o.customer_id
       left join shipments sh on sh.id = w.shipment_id
      where w.id = $1`,
    [id],
  );
  if (!doc) notFound();

  const [lines, entryItems] = await Promise.all([
    query<{
      id: string;
      item_name: string;
      sku: string;
      unit: string;
      qty: number;
      note: string | null;
      cost: number | null;
    }>(
      `select l.id, i.name as item_name, i.sku, i.unit, l.qty, l.note,
              (select sum(-m.qty * m.unit_cost) from stock_moves m
                where m.doc_type = 'write_off_act' and m.doc_id = l.write_off_id
                  and m.item_id = l.item_id) as cost
         from write_off_lines l
         join items i on i.id = l.item_id
        where l.write_off_id = $1
        order by i.name`,
      [id],
    ),
    query<{ id: string; name: string; sku: string; unit: string; barcode: string | null; available_qty: number | null }>(
      `select i.id, i.name, i.sku, i.unit, i.barcode, a.available_qty
         from items i
         left join v_item_available a on a.item_id = i.id
          and a.legal_entity_id = (select legal_entity_id from write_offs where id = $1)
        where i.is_active and i.kind <> 'service'
        order by i.kind, i.name`,
      [id],
    ),
  ]);

  const open = doc.status === 'draft';
  const totalQty = lines.reduce((s, l) => s + Number(l.qty), 0);

  return (
    <>
      <PageHeader
        title={`Акт списання ${doc.number}`}
        subtitle={`${doc.entity_name} · ${fmtDate(doc.written_off_on)}${
          doc.so_number ? ` · із замовлення ${doc.so_number}` : ''
        }`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={open ? 'amber' : doc.status === 'cancelled' ? 'gray' : 'green'}>
              {STATUS[doc.status]}
            </Badge>
            {doc.status === 'posted' && <LinkButton href={`/movements/${doc.id}`}>Дт/Кт</LinkButton>}
            {doc.status === 'posted' && (
              <LinkButton href={`/writeoffs/${doc.id}/print`}>Друк акта</LinkButton>
            )}
            <LinkButton href="/writeoffs">← До журналу</LinkButton>
          </div>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Стаття витрат" value={EXPENSE_CATEGORIES[doc.category] ?? doc.category} />
        <Stat label="Рядків" value={String(lines.length)} />
        <Stat label="Кількість разом" value={fmtQty(totalQty)} />
        <Stat
          label="Собівартість"
          value={doc.cost != null ? fmtMoney(doc.cost) : '—'}
          hint={doc.status === 'posted' ? 'порахована при проведенні за FEFO' : 'з’явиться після проведення'}
        />
      </div>

      {doc.vat_amount != null && Number(doc.vat_amount) > 0 && (
        <div className="mb-4">
          <Alert tone="amber">
            Безоплатна передача платником ПДВ: нараховано податкове зобов’язання{' '}
            {fmtMoney(doc.vat_amount)} з бази не нижче собівартості (п. 188.1 ПКУ).
          </Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card title="Рядки документа">
            {lines.length === 0 ? (
              <Empty>Додайте позиції до акта</Empty>
            ) : (
              <Table head={['Що', 'Кількість', 'Собівартість', 'Примітка', '']}>
                {lines.map((l) => (
                  <Row key={l.id}>
                    <Cell>
                      <div className="font-semibold">{l.item_name}</div>
                      <div className="text-xs text-emerald-800/50">{l.sku}</div>
                    </Cell>
                    <Cell align="right">{fmtQty(l.qty, unitLabel(l.unit))}</Cell>
                    <Cell align="right">{l.cost != null ? fmtMoney(l.cost) : '—'}</Cell>
                    <Cell>{l.note ?? '—'}</Cell>
                    <Cell align="right">
                      {open && (
                        <form action={removeWriteOffLine}>
                          <input type="hidden" name="write_off_id" value={doc.id} />
                          <input type="hidden" name="line_id" value={l.id} />
                          <button className="text-xs font-semibold text-red-600 hover:underline">
                            Прибрати
                          </button>
                        </form>
                      )}
                    </Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Card>

          {open && (
            <Card title="Введення акта">
              <p className="mb-3 text-sm text-emerald-800/70">
                Позиція шукається за назвою, артикулом або штрихкодом. Ціни вводити не треба:
                собівартість визначать партії на складі при проведенні.
              </p>
              <WriteOffEntry
                docId={doc.id}
                items={entryItems.map((i) => ({
                  id: i.id,
                  name: i.name,
                  sku: i.sku,
                  unit: i.unit,
                  barcode: i.barcode,
                  hint:
                    i.available_qty != null
                      ? `доступно ${fmtQty(i.available_qty, unitLabel(i.unit))}`
                      : undefined,
                }))}
                action={saveWriteOffLines}
              />
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {open && (
            <Card title="Шапка документа">
              <ActionForm action={updateWriteOffHeader} submitLabel="Зберегти шапку" variant="ghost">
                <input type="hidden" name="write_off_id" value={doc.id} />
                <Field label="Стаття витрат">
                  <select name="category" className={inputClass} defaultValue={doc.category}>
                    {Object.entries(EXPENSE_CATEGORIES).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Дата списання">
                  <input
                    name="written_off_on"
                    type="date"
                    defaultValue={isoDay(doc.written_off_on) ?? ''}
                    className={inputClass}
                  />
                </Field>
                <input type="hidden" name="warehouse_id" value={doc.warehouse_id ?? ''} />
                <Field label="Причина">
                  <input name="reason" defaultValue={doc.reason ?? ''} className={inputClass} />
                </Field>
                <Field label="Примітка">
                  <input name="note" defaultValue={doc.note ?? ''} className={inputClass} />
                </Field>
              </ActionForm>
            </Card>
          )}

          {open ? (
            <Card title="Проведення">
              <p className="mb-3 text-sm text-emerald-800/70">
                Товар спишеться зі складу партіями за FEFO, а собівартість ляже у витрати за
                статтею «{EXPENSE_CATEGORIES[doc.category] ?? doc.category}» — саме так сума
                з’явиться у фінрезультаті.
              </p>
              <ActionForm action={postWriteOff} submitLabel="Провести">
                <input type="hidden" name="write_off_id" value={doc.id} />
              </ActionForm>
              <form action={cancelWriteOff} className="mt-3">
                <input type="hidden" name="write_off_id" value={doc.id} />
                <Button variant="ghost">Скасувати документ</Button>
              </form>
            </Card>
          ) : (
            <Card title="Документ">
              <dl className="space-y-2 text-sm">
                {[
                  ['Склад', doc.warehouse_name ?? '—'],
                  ['Причина', doc.reason ?? '—'],
                  ['Замовлення', doc.so_number ?? '—'],
                  ['Отримувач', doc.customer_name ?? '—'],
                  ['Примітка', doc.note ?? '—'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-emerald-800/60">{k}</dt>
                    <dd className="text-right font-medium text-emerald-950">{v}</dd>
                  </div>
                ))}
              </dl>
              {doc.status === 'posted' && (
                <form action={cancelWriteOff} className="mt-4">
                  <input type="hidden" name="write_off_id" value={doc.id} />
                  <Button variant="ghost">Скасувати проведення</Button>
                </form>
              )}
            </Card>
          )}

          {doc.shipment_id && (
            <Card title="Відправка">
              <p className="mb-3 text-sm text-emerald-800/70">
                Для цієї безоплатної відправки створено відвантаження {doc.shipment_number} — з
                нього друкуються супровідні документи.
              </p>
              <div className="flex flex-col gap-2">
                <Link
                  href={`/shipments/${doc.shipment_id}/ttn`}
                  className="font-semibold text-emerald-700 hover:underline"
                >
                  Друк ТТН
                </Link>
                <Link
                  href={`/shipments/${doc.shipment_id}/print`}
                  className="font-semibold text-emerald-700 hover:underline"
                >
                  Видаткова накладна
                </Link>
                {doc.so_id && (
                  <Link
                    href={`/sales/${doc.so_id}`}
                    className="font-semibold text-emerald-700 hover:underline"
                  >
                    Замовлення {doc.so_number}
                  </Link>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
