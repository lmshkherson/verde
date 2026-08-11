import { notFound } from 'next/navigation';
import {
  acceptReturn,
  addReturnLineFree,
  addReturnLineFromShipment,
  cancelReturn,
  removeReturnLine,
} from '@/app/actions/returns';
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
import { fmtDate, fmtMoney, fmtQty, RETURN_REASONS, RETURN_STATUS, unitLabel } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole('sales', 'warehouse');
  const { id } = await params;

  const doc = await queryOne<{
    id: string;
    number: string;
    returned_on: string;
    status: string;
    reason: string;
    note: string | null;
    customer: string;
    customer_is_vat_payer: boolean;
    shipment_id: string | null;
    shipment_number: string | null;
    so_id: string | null;
    seller_is_vat_payer: boolean;
  }>(
    `select r.id, r.number, r.returned_on, r.status, r.reason, r.note,
            c.name as customer, c.is_vat_payer as customer_is_vat_payer,
            r.shipment_id, sh.number as shipment_number, r.so_id,
            e.is_vat_payer as seller_is_vat_payer
       from customer_returns r
       join customers c on c.id = r.customer_id
       join legal_entities e on e.id = r.legal_entity_id
       left join shipments sh on sh.id = r.shipment_id
      where r.id = $1 and r.legal_entity_id = $2`,
    [id, session.eid],
  );
  if (!doc) notFound();

  const [lines, available, items, adjustment] = await Promise.all([
    query<{
      id: string;
      name: string;
      unit: string;
      qty: number;
      unit_price: number;
      vat_rate: number;
      unit_cost: number;
      to_stock: boolean;
      batch_code: string | null;
    }>(
      `select l.id, i.name, i.unit, l.qty, l.unit_price, l.vat_rate, l.unit_cost, l.to_stock,
              b.code as batch_code
         from customer_return_lines l
         join items i on i.id = l.item_id
         left join batches b on b.id = l.batch_id
        where l.return_id = $1
        order by i.name`,
      [id],
    ),
    doc.shipment_id
      ? query<{ id: string; name: string; unit: string; shipped: number; returned: number; price: number }>(
          `select sl.id, i.name, i.unit, sl.qty as shipped,
                  coalesce(r.returned_qty, 0) as returned, l.unit_price as price
             from shipment_lines sl
             join items i on i.id = sl.item_id
             join sales_order_lines l on l.id = sl.so_line_id
             left join v_shipment_line_returned r on r.shipment_line_id = sl.id
            where sl.shipment_id = $1
            order by i.name`,
          [doc.shipment_id],
        )
      : Promise.resolve([]),
    query<{ id: string; name: string; unit: string; avg_cost: number; price: number | null }>(
      `select i.id, i.name, i.unit, coalesce(s.avg_cost, 0) as avg_cost, i.price_distributor as price
         from items i
         left join v_item_stock s on s.item_id = i.id and s.legal_entity_id = $1
        where i.is_active and i.kind = 'finished'
        order by i.name`,
      [session.eid],
    ),
    queryOne<{ number: string; registered_by: string; status: string; vat_amount: number }>(
      'select number, registered_by, status, vat_amount from tax_invoices where return_id = $1',
      [id],
    ),
  ]);

  const net = lines.reduce((s, l) => s + Number(l.qty) * Number(l.unit_price), 0);
  const vat = lines.reduce(
    (s, l) => s + (Number(l.qty) * Number(l.unit_price) * Number(l.vat_rate)) / 100,
    0,
  );
  const costBack = lines.filter((l) => l.to_stock).reduce((s, l) => s + Number(l.qty) * Number(l.unit_cost), 0);
  const costLost = lines.filter((l) => !l.to_stock).reduce((s, l) => s + Number(l.qty) * Number(l.unit_cost), 0);
  const isDraft = doc.status === 'draft';

  return (
    <>
      <PageHeader
        title={`Повернення ${doc.number}`}
        subtitle={`${doc.customer} · ${fmtDate(doc.returned_on)} · ${RETURN_REASONS[doc.reason]}`}
        action={
          <div className="flex gap-2">
            <LinkButton href={`/movements/${doc.id}`}>Дт/Кт</LinkButton>
            {doc.so_id && <LinkButton href={`/sales/${doc.so_id}`}>Замовлення</LinkButton>}
            <LinkButton href="/returns">← До повернень</LinkButton>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Badge tone={doc.status === 'accepted' ? 'green' : doc.status === 'cancelled' ? 'gray' : 'amber'}>
          {RETURN_STATUS[doc.status]}
        </Badge>
        {doc.shipment_number ? (
          <span className="text-sm text-emerald-800/70">за відвантаженням {doc.shipment_number}</span>
        ) : (
          <span className="text-sm text-amber-700">
            без прив’язки до відвантаження — ціну й собівартість вводите ви
          </span>
        )}
        {doc.note && <span className="text-sm text-emerald-800/60">{doc.note}</span>}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Вирахування з доходу" value={fmtMoney(net)} hint="без ПДВ" />
        <Stat label="Сторно ПДВ" value={fmtMoney(vat)} />
        <Stat label="Назад на склад" value={fmtMoney(costBack)} hint="за собівартістю" />
        <Stat
          label="У втрати"
          value={fmtMoney(costLost)}
          tone={costLost > 0 ? 'danger' : 'default'}
          hint="непридатне"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card title="Позиції">
            {lines.length === 0 ? (
              <Empty>Порожньо — додайте позиції справа</Empty>
            ) : (
              <Table head={['Позиція', 'Кількість', 'Ціна', 'Собівартість', 'Куди', '']}>
                {lines.map((l) => (
                  <Row key={l.id}>
                    <Cell>
                      <div className="font-semibold">{l.name}</div>
                      {l.batch_code && (
                        <div className="font-mono text-xs text-emerald-800/50">{l.batch_code}</div>
                      )}
                    </Cell>
                    <Cell align="right">{fmtQty(l.qty, unitLabel(l.unit))}</Cell>
                    <Cell align="right">{fmtMoney(l.unit_price)}</Cell>
                    <Cell align="right">{fmtMoney(l.unit_cost)}</Cell>
                    <Cell>
                      <Badge tone={l.to_stock ? 'green' : 'red'}>
                        {l.to_stock ? 'на склад' : 'у втрати'}
                      </Badge>
                    </Cell>
                    <Cell align="right">
                      {isDraft && (
                        <form action={removeReturnLine}>
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

          {doc.status === 'accepted' && (
            <Card title="ПДВ">
              {!doc.seller_is_vat_payer ? (
                <p className="text-sm text-emerald-800/70">
                  Юрособа не платник ПДВ — коригувати нічого.
                </p>
              ) : adjustment ? (
                <>
                  <p className="mb-3 text-sm text-emerald-800/70">
                    Складено розрахунок коригування <strong>{adjustment.number}</strong> на{' '}
                    {fmtMoney(Math.abs(Number(adjustment.vat_amount)))} ПДВ.
                  </p>
                  <Alert tone={adjustment.registered_by === 'buyer' ? 'amber' : 'green'}>
                    {adjustment.registered_by === 'buyer' ? (
                      <>
                        Реєструє його <strong>покупець</strong>: при зменшенні суми компенсації РК
                        подає покупець, а не ви. Зобов’язання зменшиться лише після його реєстрації —
                        простежте, щоб {doc.customer} це зробив.
                      </>
                    ) : (
                      <>
                        Покупець не платник ПДВ, тож РК реєструєте <strong>ви</strong>.
                      </>
                    )}
                  </Alert>
                </>
              ) : (
                <p className="text-sm text-emerald-800/70">Коригування не формувалося.</p>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {isDraft && doc.shipment_id && (
            <Card title="Додати з відвантаження">
              <ActionForm action={addReturnLineFromShipment} submitLabel="Додати">
                <input type="hidden" name="return_id" value={doc.id} />
                <Field label="Позиція">
                  <select name="shipment_line_id" required className={inputClass} defaultValue="">
                    <option value="" disabled>
                      Оберіть…
                    </option>
                    {available
                      .filter((a) => Number(a.shipped) - Number(a.returned) > 0.0005)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} — можна {fmtQty(Number(a.shipped) - Number(a.returned), unitLabel(a.unit))}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Кількість">
                  <input name="qty" type="number" step="0.001" min="0" required className={inputClass} />
                </Field>
                <label className="flex items-center gap-2 py-1">
                  <input name="to_stock" type="checkbox" defaultChecked className="size-5 accent-emerald-700" />
                  <span className="text-sm font-semibold text-emerald-900">Придатний, на склад</span>
                </label>
                <p className="text-xs text-emerald-800/60">
                  Зніміть галочку для браку чи простроченого: тоді вартість піде у втрати, а не назад
                  у запаси.
                </p>
              </ActionForm>
            </Card>
          )}

          {isDraft && !doc.shipment_id && (
            <Card title="Додати позицію">
              <p className="mb-3 text-sm text-emerald-800/70">
                Відвантаження невідоме, тож ціну й собівартість система підказує, але не знає.
                Підказка — середня по складу; якщо продавали за іншою ціною, поставте свою.
              </p>
              <ActionForm action={addReturnLineFree} submitLabel="Додати">
                <input type="hidden" name="return_id" value={doc.id} />
                <Field label="Номенклатура">
                  <select name="item_id" required className={inputClass} defaultValue="">
                    <option value="" disabled>
                      Оберіть…
                    </option>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} — собів. {Number(i.avg_cost).toFixed(2)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Кількість">
                  <input name="qty" type="number" step="0.001" min="0" required className={inputClass} />
                </Field>
                <Field label="Ціна продажу без ПДВ">
                  <input name="unit_price" type="number" step="0.01" min="0" required className={inputClass} />
                </Field>
                <Field label="Собівартість за одиницю">
                  <input name="unit_cost" type="number" step="0.0001" min="0" className={inputClass} />
                </Field>
                <label className="flex items-center gap-2 py-1">
                  <input name="to_stock" type="checkbox" defaultChecked className="size-5 accent-emerald-700" />
                  <span className="text-sm font-semibold text-emerald-900">Придатний, на склад</span>
                </label>
              </ActionForm>
            </Card>
          )}

          {isDraft && (
            <Card title="Провести">
              {lines.length > 0 ? (
                <>
                  <p className="mb-3 text-sm text-emerald-800/70">
                    Товар стане на склад, дохід зменшиться на {fmtMoney(net)}, податкове
                    зобов’язання — на {fmtMoney(vat)}.
                  </p>
                  <ActionForm action={acceptReturn} submitLabel="Прийняти повернення">
                    <input type="hidden" name="return_id" value={doc.id} />
                  </ActionForm>
                </>
              ) : (
                <p className="mb-3 text-sm text-emerald-800/70">
                  Додайте хоча б одну позицію — або скасуйте документ, якщо він зайвий.
                </p>
              )}
              <form action={cancelReturn} className="mt-3">
                <input type="hidden" name="return_id" value={doc.id} />
                <Button variant="ghost">Скасувати документ</Button>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
