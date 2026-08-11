import { notFound } from 'next/navigation';
import {
  addGoodsLine,
  addServiceLine,
  cancelReceipt,
  postReceipt,
  removeReceiptLine,
  updateReceiptHeader,
} from '@/app/actions/receipts';
import { ActionForm } from '@/components/action-form';
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

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole('warehouse');
  const { id } = await params;

  const doc = await queryOne<{
    id: string;
    number: string;
    received_on: string | Date;
    status: string;
    supplier: string;
    supplier_id: string;
    supplier_is_vat_payer: boolean;
    supplier_doc_number: string | null;
    supplier_doc_date: string | Date | null;
    prices_include_vat: boolean;
    note: string | null;
    net_amount: number;
    vat_amount: number;
    gross_amount: number;
    goods_lines: number;
    service_lines: number;
    warehouse_id: string | null;
  }>(
    `select r.id, r.number, r.received_on, r.status, s.name as supplier, s.id as supplier_id,
            s.is_vat_payer as supplier_is_vat_payer, r.warehouse_id,
            r.supplier_doc_number, r.supplier_doc_date, r.prices_include_vat, r.note,
            a.net_amount, a.vat_amount, a.gross_amount, a.goods_lines, a.service_lines
       from receipts r
       join suppliers s on s.id = r.supplier_id
       join v_receipt_amounts a on a.receipt_id = r.id
      where r.id = $1 and r.legal_entity_id = $2`,
    [id, session.eid],
  );
  if (!doc) notFound();

  const [lines, items, warehouses] = await Promise.all([
    query<{
      id: string;
      kind: string;
      item_name: string | null;
      sku: string | null;
      unit: string | null;
      description: string | null;
      category: string | null;
      qty: number;
      unit_price: number;
      vat_rate: number;
      batch_code: string | null;
      expires_on: string | null;
    }>(
      `select l.id, l.kind, i.name as item_name, i.sku, i.unit, l.description, l.category,
              l.qty, l.unit_price, l.vat_rate, l.batch_code, l.expires_on
         from receipt_lines l
         left join items i on i.id = l.item_id
        where l.receipt_id = $1
        order by l.kind desc, i.name, l.description`,
      [id],
    ),
    query<{ id: string; name: string; sku: string; unit: string }>(
      `select id, name, sku, unit from items
        where is_active and kind in ('raw', 'packaging', 'semi', 'finished')
        order by kind, name`,
    ),
    query<{ id: string; name: string; is_default: boolean }>(
      `select id, name, is_default from warehouses
        where is_active order by is_default desc, code`,
    ),
  ]);

  const open = doc.status === 'draft';
  const vatHint = doc.supplier_is_vat_payer
    ? 'Постачальник — платник ПДВ'
    : 'Постачальник не платник ПДВ: податкового кредиту з цієї суми не буде';

  return (
    <>
      <PageHeader
        title={`Надходження ${doc.number}`}
        subtitle={`${doc.supplier} · ${fmtDate(doc.received_on)}${
          doc.supplier_doc_number ? ` · їх документ № ${doc.supplier_doc_number}` : ''
        }`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={open ? 'amber' : doc.status === 'cancelled' ? 'gray' : 'green'}>
              {STATUS[doc.status]}
            </Badge>
            <LinkButton href={`/purchasing/suppliers/${doc.supplier_id}`}>Постачальник</LinkButton>
            {!open && <LinkButton href={`/movements/${doc.id}`}>Рухи документа</LinkButton>}
            <LinkButton href="/receipts">← До журналу</LinkButton>
          </div>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Без ПДВ" value={fmtMoney(doc.net_amount)} />
        <Stat label="ПДВ" value={fmtMoney(doc.vat_amount)} hint={vatHint} />
        <Stat label="Разом до сплати" value={fmtMoney(doc.gross_amount)} />
        <Stat
          label="Рядків"
          value={`${doc.goods_lines} + ${doc.service_lines}`}
          hint="товар + послуги"
        />
      </div>

      {!doc.supplier_is_vat_payer && doc.vat_amount > 0 && (
        <div className="mb-4">
          <Alert tone="amber">
            У рядках стоїть ставка ПДВ, але постачальник не платник податку. При проведенні
            податкового кредиту не буде, а вся сума ляже в собівартість — так і має бути.
          </Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card title="Рядки документа">
            {lines.length === 0 ? (
              <Empty>Додайте товар або послугу</Empty>
            ) : (
              <Table head={['Що', 'Кількість', 'Ціна', 'Сума', '']}>
                {lines.map((l) => (
                  <Row key={l.id}>
                    <Cell>
                      {l.kind === 'goods' ? (
                        <>
                          <div className="font-semibold">{l.item_name}</div>
                          <div className="text-xs text-emerald-800/50">
                            {l.sku}
                            {l.batch_code ? ` · партія ${l.batch_code}` : ''}
                            {l.expires_on ? ` · до ${fmtDate(l.expires_on)}` : ''}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="font-semibold">{l.description}</div>
                          <div className="text-xs text-emerald-800/50">
                            послуга · {EXPENSE_CATEGORIES[l.category ?? ''] ?? l.category}
                          </div>
                        </>
                      )}
                    </Cell>
                    <Cell align="right">
                      {l.kind === 'goods' ? fmtQty(l.qty, unitLabel(l.unit ?? '')) : '—'}
                    </Cell>
                    <Cell align="right">{fmtMoney(l.unit_price)}</Cell>
                    <Cell align="right">{fmtMoney(Number(l.qty) * Number(l.unit_price))}</Cell>
                    <Cell align="right">
                      {open && (
                        <form action={removeReceiptLine}>
                          <input type="hidden" name="receipt_id" value={doc.id} />
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
            <>
              <Card title="Додати товар">
                <ActionForm action={addGoodsLine} submitLabel="Додати товар" variant="ghost">
                  <input type="hidden" name="receipt_id" value={doc.id} />
                  <Field label="Номенклатура">
                    <select name="item_id" required className={inputClass} defaultValue="">
                      <option value="" disabled>
                        Оберіть позицію…
                      </option>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name} ({i.sku}, {unitLabel(i.unit)})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Кількість" hint="в одиниці, вказаній біля позиції">
                      <input name="qty" type="number" step="0.001" min="0" className={inputClass} />
                    </Field>
                    <Field
                      label="Ціна за одиницю"
                      hint={doc.prices_include_vat ? 'з ПДВ' : 'без ПДВ'}
                    >
                      <input name="unit_price" type="number" step="0.0001" min="0" className={inputClass} />
                    </Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Номер партії" hint="з документа постачальника">
                      <input name="batch_code" className={inputClass} />
                    </Field>
                    <Field label="Придатний до" hint="порожньо — порахується з терміну придатності">
                      <input name="expires_on" type="date" className={inputClass} />
                    </Field>
                  </div>
                </ActionForm>
              </Card>

              <Card title="Додати послугу">
                <p className="mb-3 text-sm text-emerald-800/70">
                  Послуга на склад не потрапляє: вона одразу лягає у витрати періоду за обраною
                  статтею й у борг перед постачальником. Саме так проводяться оренда, доставка,
                  реклама, банківське обслуговування.
                </p>
                <ActionForm action={addServiceLine} submitLabel="Додати послугу" variant="ghost">
                  <input type="hidden" name="receipt_id" value={doc.id} />
                  <Field label="Опис">
                    <input
                      name="description"
                      className={inputClass}
                      placeholder="Доставка сировини за березень"
                      required
                    />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Стаття витрат">
                      <select name="category" required className={inputClass} defaultValue="services">
                        {Object.entries(EXPENSE_CATEGORIES).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Поведінка витрати" hint="змінна росте з обсягом випуску">
                      <select name="cost_behavior" className={inputClass} defaultValue="fixed">
                        <option value="fixed">Постійна</option>
                        <option value="variable">Змінна</option>
                      </select>
                    </Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Сума" hint={doc.prices_include_vat ? 'з ПДВ' : 'без ПДВ'}>
                      <input name="amount" type="number" step="0.01" min="0" className={inputClass} />
                    </Field>
                    <Field label="Ставка ПДВ, %">
                      <select name="vat_rate" className={inputClass} defaultValue={session.vat ? '20' : '0'}>
                        <option value="20">20</option>
                        <option value="7">7</option>
                        <option value="0">0 / без ПДВ</option>
                      </select>
                    </Field>
                  </div>
                </ActionForm>
              </Card>
            </>
          )}
        </div>

        <div className="space-y-4">
          {open && (
            <Card title="Шапка документа">
              <ActionForm action={updateReceiptHeader} submitLabel="Зберегти шапку" variant="ghost">
                <input type="hidden" name="receipt_id" value={doc.id} />
                <Field label="Дата надходження">
                  <input
                    name="received_on"
                    type="date"
                    defaultValue={isoDay(doc.received_on) ?? ''}
                    className={inputClass}
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Номер їх документа">
                    <input
                      name="supplier_doc_number"
                      defaultValue={doc.supplier_doc_number ?? ''}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Дата їх документа">
                    <input
                      name="supplier_doc_date"
                      type="date"
                      defaultValue={isoDay(doc.supplier_doc_date) ?? ''}
                      className={inputClass}
                    />
                  </Field>
                </div>
                <Field label="Склад">
                  <select
                    name="warehouse_id"
                    className={inputClass}
                    defaultValue={doc.warehouse_id ?? warehouses.find((w) => w.is_default)?.id ?? ''}
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <label className="flex items-center gap-2 py-1">
                  <input
                    name="prices_include_vat"
                    type="checkbox"
                    defaultChecked={doc.prices_include_vat}
                    className="size-5 accent-emerald-700"
                  />
                  <span className="text-sm font-semibold text-emerald-900">Ціни вказані з ПДВ</span>
                </label>
                <Field label="Примітка">
                  <input name="note" defaultValue={doc.note ?? ''} className={inputClass} />
                </Field>
              </ActionForm>
            </Card>
          )}

          {open ? (
            <Card title="Проведення">
              <p className="mb-3 text-sm text-emerald-800/70">
                Товар ляже на склад партіями, послуги — у витрати періоду, ПДВ — у податковий
                кредит, а борг перед постачальником зросте на повну суму з податком.
              </p>
              <p className="mb-3 text-sm text-emerald-800/70">
                Позиції, що потребують вхідного контролю, стануть у карантин — система сама
                створить акт приймання.
              </p>
              <ActionForm action={postReceipt} submitLabel="Провести">
                <input type="hidden" name="receipt_id" value={doc.id} />
              </ActionForm>
              <form action={cancelReceipt} className="mt-3">
                <input type="hidden" name="receipt_id" value={doc.id} />
                <Button variant="ghost">Скасувати документ</Button>
              </form>
            </Card>
          ) : (
            <Card title="Документ">
              <dl className="space-y-2 text-sm">
                {[
                  ['Постачальник', doc.supplier],
                  ['Їх документ', doc.supplier_doc_number ?? '—'],
                  ['Дата їх документа', doc.supplier_doc_date ? fmtDate(doc.supplier_doc_date) : '—'],
                  ['Ціни', doc.prices_include_vat ? 'з ПДВ' : 'без ПДВ'],
                  ['Примітка', doc.note ?? '—'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-emerald-800/60">{k}</dt>
                    <dd className="text-right font-medium text-emerald-950">{v}</dd>
                  </div>
                ))}
              </dl>
              {doc.status === 'posted' && (
                <form action={cancelReceipt} className="mt-4">
                  <input type="hidden" name="receipt_id" value={doc.id} />
                  <Button variant="ghost">Скасувати проведення</Button>
                </form>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
