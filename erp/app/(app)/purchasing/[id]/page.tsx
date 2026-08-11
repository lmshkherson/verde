import { notFound } from 'next/navigation';
import { addPurchaseLines, cancelPurchaseOrder, markOrdered, receivePurchaseOrder, removePurchaseLine } from '@/app/actions/purchasing';
import { LinesEntry } from '@/components/lines-entry';
import { recordSupplierPayment } from '@/app/actions/finance';
import { ActionForm } from '@/components/action-form';
import { Badge, Button, Card, Cell, Empty, Field, inputClass, LinkButton, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { fmtDate, fmtMoney, fmtQty, PAY_METHODS, PO_STATUS, unitLabel } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const statusTone: Record<string, 'gray' | 'amber' | 'green' | 'red'> = {
  draft: 'gray',
  ordered: 'amber',
  received: 'green',
  cancelled: 'red',
};

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('warehouse');
  const { id } = await params;

  const po = await queryOne<{
    id: string;
    number: string;
    status: string;
    ordered_on: string;
    expected_on: string | null;
    note: string | null;
    supplier: string;
    payment_terms_days: number;
    supplier_id: string;
    net_amount: number;
    gross_amount: number;
    received_net: number;
    received_gross: number;
    paid_amount: number;
    prices_include_vat: boolean;
    buyer_is_vat_payer: boolean;
    supplier_is_vat_payer: boolean;
  }>(
    `select p.id, p.number, p.status, p.ordered_on, p.expected_on, p.note,
            s.name as supplier, s.payment_terms_days,
            p.supplier_id,
            a.net_amount, a.gross_amount, a.received_net, a.received_gross,
            coalesce((select sum(sp.amount) from supplier_payments sp where sp.po_id = p.id), 0) as paid_amount,
            p.prices_include_vat, s.is_vat_payer as supplier_is_vat_payer,
            e.is_vat_payer as buyer_is_vat_payer
       from purchase_orders p
       join suppliers s on s.id = p.supplier_id
       join legal_entities e on e.id = p.legal_entity_id
       left join v_po_amounts a on a.po_id = p.id
      where p.id = $1`,
    [id],
  );
  if (!po) notFound();

  const [lines, items] = await Promise.all([
    query<{
      id: string;
      item_id: string;
      name: string;
      sku: string;
      unit: string;
      qty: number;
      unit_price: number;
      received_qty: number;
      shelf_life_days: number | null;
    }>(
      `select l.id, l.item_id, i.name, i.sku, i.unit, l.qty, l.unit_price, l.received_qty, i.shelf_life_days
         from purchase_order_lines l
         join items i on i.id = l.item_id
        where l.po_id = $1
        order by i.name`,
      [id],
    ),
    query<{ id: string; sku: string; name: string; unit: string; kind: string; vat_rate: number; barcode: string | null }>(
      "select id, sku, name, unit, kind, vat_rate, barcode from items where kind in ('raw','packaging','semi') and is_active order by name",
    ),
  ]);

  const isDraft = po.status === 'draft';
  const canReceive = po.status === 'ordered' || (po.status === 'draft' && lines.length > 0);
  const pending = lines.filter((l) => l.qty - l.received_qty > 0.0005);

  // Найчастіше джерело здивування: чому на складі ціна не така, як у заявці.
  const reclaimsVat = po.buyer_is_vat_payer && po.supplier_is_vat_payer;
  const vatNote = reclaimsVat
    ? po.prices_include_vat
      ? 'Ціни в заявці з ПДВ. На склад партія стане за базою без ПДВ — податок піде в податковий кредит, а не в собівартість.'
      : 'Ціни в заявці без ПДВ і саме вони стануть собівартістю партії; ПДВ зверху піде в податковий кредит.'
    : po.buyer_is_vat_payer
      ? 'Постачальник не платник ПДВ, тож кредиту немає — у собівартість піде вся ціна.'
      : 'Юрособа не платник ПДВ, тож податок постачальника не відшкодовується і повністю входить у собівартість.';

  return (
    <>
      <PageHeader
        title={`Заявка ${po.number}`}
        subtitle={`${po.supplier} · від ${fmtDate(po.ordered_on)}`}
        action={
          <div className="flex gap-2">
            <LinkButton href={`/movements/${po.id}`}>Рухи документа</LinkButton>
            <LinkButton href="/purchasing">← До списку</LinkButton>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Сума з ПДВ"
          value={fmtMoney(po.gross_amount)}
          hint={`база ${fmtMoney(po.net_amount)} + ПДВ ${fmtMoney(po.gross_amount - po.net_amount)}`}
        />
        <Stat
          label="У собівартість"
          value={fmtMoney(po.buyer_is_vat_payer ? po.received_net : po.received_gross)}
          hint="оприбутковано без ПДВ"
        />
        <Stat
          label="Борг постачальнику"
          value={fmtMoney(po.received_gross - po.paid_amount)}
          tone={po.received_gross - po.paid_amount > 0.01 ? 'warn' : 'good'}
          hint={po.payment_terms_days > 0 ? `відтермінування ${po.payment_terms_days} дн.` : 'з ПДВ'}
        />
        <div className="rounded-2xl border border-emerald-900/10 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-800/60">Статус</div>
          <div className="mt-2">
            <Badge tone={statusTone[po.status]}>{PO_STATUS[po.status]}</Badge>
          </div>
          {(isDraft || po.status === 'ordered') && (
            <div className="mt-3 flex gap-2">
              {isDraft && lines.length > 0 && (
                <form action={markOrdered}>
                  <input type="hidden" name="po_id" value={po.id} />
                  <Button className="!min-h-9 !px-3 text-xs">Замовлено</Button>
                </form>
              )}
              <form action={cancelPurchaseOrder}>
                <input type="hidden" name="po_id" value={po.id} />
                <Button variant="ghost" className="!min-h-9 !px-3 text-xs">
                  Скасувати
                </Button>
              </form>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4">
        <Card title="Позиції заявки">
          {lines.length === 0 ? (
            <Empty>Додайте позиції</Empty>
          ) : (
            <Table head={['Позиція', 'Кількість', 'Ціна', 'Сума', 'Прийнято', ...(isDraft ? [''] : [])]}>
              {lines.map((l) => (
                <Row key={l.id}>
                  <Cell>
                    <div className="font-semibold">{l.name}</div>
                    <div className="text-xs text-emerald-800/50">{l.sku}</div>
                  </Cell>
                  <Cell align="right">{fmtQty(l.qty, unitLabel(l.unit))}</Cell>
                  <Cell align="right">{fmtMoney(l.unit_price)}</Cell>
                  <Cell align="right" className="font-semibold">
                    {fmtMoney(l.qty * l.unit_price)}
                  </Cell>
                  <Cell align="right">{fmtQty(l.received_qty)}</Cell>
                  {isDraft && (
                    <Cell align="right">
                      <form action={removePurchaseLine}>
                        <input type="hidden" name="line_id" value={l.id} />
                        <input type="hidden" name="po_id" value={po.id} />
                        <Button variant="ghost" className="!min-h-9 !px-3 text-xs">
                          Видалити
                        </Button>
                      </form>
                    </Cell>
                  )}
                </Row>
              ))}
            </Table>
          )}
        </Card>

        {po.received_gross - po.paid_amount > 0.01 && (
          <Card title="Оплата постачальнику">
            <p className="mb-3 text-sm text-emerald-800/70">
              Платимо повну суму з ПДВ — {fmtMoney(po.received_gross)}, з яких{' '}
              {fmtMoney(po.received_gross - po.received_net)} податок. У витрати й собівартість
              пішла лише база.
            </p>
            <ActionForm action={recordSupplierPayment} submitLabel="Записати оплату" className="sm:max-w-md">
              <input type="hidden" name="po_id" value={po.id} />
              <input type="hidden" name="supplier_id" value={po.supplier_id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Сума з ПДВ">
                  <input
                    name="amount"
                    type="number"
                    step="0.01"
                    defaultValue={(po.received_gross - po.paid_amount).toFixed(2)}
                    required
                    className={inputClass}
                  />
                </Field>
                <Field label="Дата">
                  <input
                    name="paid_on"
                    type="date"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    className={inputClass}
                  />
                </Field>
              </div>
              <Field label="Спосіб">
                <select name="method" className={inputClass} defaultValue="bank">
                  {Object.entries(PAY_METHODS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </ActionForm>
          </Card>
        )}

        {isDraft && (
          <Card title="Введення заявки">
            <p className="mb-3 text-sm text-emerald-800/70">
              Заповнюйте рядки як із рахунку постачальника: позиція шукається за назвою, артикулом
              або штрихкодом, ціни {po.prices_include_vat ? 'з ПДВ' : 'без ПДВ'} — будь-яку з
              чотирьох сум можна ввести, решта перерахуються.
            </p>
            <LinesEntry
              docField="po_id"
              docId={po.id}
              items={items}
              pricesIncludeVat={po.prices_include_vat}
              showBatch={false}
              submitLabel="Додати рядки в заявку"
              action={addPurchaseLines}
            />
          </Card>
        )}

        {canReceive && pending.length > 0 && (
          <Card title="Оприбуткування">
            <ActionForm action={receivePurchaseOrder} submitLabel="Оприбуткувати на склад">
              <input type="hidden" name="po_id" value={po.id} />
              <Field label="Дата приходу">
                <input
                  name="received_on"
                  type="date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  className={`${inputClass} sm:max-w-xs`}
                />
              </Field>
              <div className="space-y-2">
                {pending.map((l) => (
                  <div key={l.id} className="rounded-xl border border-emerald-900/10 bg-emerald-50/40 p-3">
                    <div className="mb-2 font-semibold text-emerald-950">
                      {l.name}
                      <span className="ml-2 text-xs font-normal text-emerald-800/60">
                        очікується {fmtQty(l.qty - l.received_qty, unitLabel(l.unit))} по{' '}
                        {fmtMoney(l.unit_price)}
                      </span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Field label="Прийнято">
                        <input
                          name={`qty_${l.id}`}
                          type="number"
                          step="0.001"
                          min="0"
                          defaultValue={l.qty - l.received_qty}
                          className={inputClass}
                        />
                      </Field>
                      <Field label="Номер партії">
                        <input name={`batch_${l.id}`} className={inputClass} placeholder="від постачальника" />
                      </Field>
                      <Field
                        label="Придатна до"
                        hint={l.shelf_life_days ? `за замовчуванням +${l.shelf_life_days} дн.` : undefined}
                      >
                        <input name={`expires_${l.id}`} type="date" className={inputClass} />
                      </Field>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-emerald-800/60">
                {vatNote}
              </p>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
