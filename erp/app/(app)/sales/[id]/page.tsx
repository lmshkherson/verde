import Link from 'next/link';
import { notFound } from 'next/navigation';
import { addSalesLines, cancelSalesOrder, confirmSalesOrder, recordPayment, removeSalesLine, shipSalesOrder } from '@/app/actions/sales';
import { giftShipFromOrder } from '@/app/actions/writeoffs';
import { ActionForm } from '@/components/action-form';
import { LinesEntry } from '@/components/lines-entry';
import { Badge, Button, Card, Cell, Empty, Field, inputClass, LinkButton, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { EXPENSE_CATEGORIES, fmtDate, fmtMoney, fmtQty, SALES_CHANNELS, SO_STATUS, unitLabel } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const statusTone: Record<string, 'gray' | 'amber' | 'green' | 'red'> = {
  draft: 'gray',
  confirmed: 'amber',
  shipped: 'green',
  cancelled: 'red',
};

export default async function SalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('sales');
  const { id } = await params;

  const order = await queryOne<{
    id: string;
    number: string;
    status: string;
    ordered_on: string;
    ship_by: string | null;
    customer_id: string;
    customer_name: string;
    channel: string;
    payment_terms_days: number;
    net_amount: number;
    vat_amount: number;
    total_amount: number;
    shipped_net: number;
    shipped_amount: number;
    cogs: number;
    margin: number;
    margin_pct: number;
    paid_amount: number;
    balance_due: number;
    due_date: string | null;
    legal_entity_id: string;
    entity_name: string;
    seller_is_vat_payer: boolean;
  }>(
    `select f.*, c.channel, e.short_name as entity_name, e.is_vat_payer as seller_is_vat_payer
       from v_sales_orders_full f
       join customers c on c.id = f.customer_id
       join legal_entities e on e.id = f.legal_entity_id
      where f.id = $1`,
    [id],
  );
  if (!order) notFound();

  const [lines, available, shipments, payments] = await Promise.all([
    query<{
      id: string;
      item_id: string;
      name: string;
      sku: string;
      unit: string;
      qty: number;
      unit_price: number;
      vat_rate: number;
      shipped_qty: number;
      stock_available: number;
    }>(
      `select l.id, l.item_id, i.name, i.sku, i.unit, l.qty, l.unit_price, l.vat_rate, l.shipped_qty,
              coalesce(a.available_qty, 0) as stock_available
         from sales_order_lines l
         join items i on i.id = l.item_id
         left join v_item_available a on a.item_id = l.item_id and a.legal_entity_id = $2
        where l.so_id = $1
        order by i.name`,
      [id, order.legal_entity_id],
    ),
    query<{
      id: string;
      sku: string;
      name: string;
      available_qty: number;
      unit: string;
      vat_rate: number;
      barcode: string | null;
      channel_price: number | null;
    }>(
      `select a.item_id as id, a.sku, a.name, a.available_qty, a.unit,
              i.vat_rate, i.barcode, ip.price as channel_price
         from v_item_available a
         join items i on i.id = a.item_id
         left join item_prices ip on ip.item_id = a.item_id and ip.channel = $2
        where a.kind = 'finished' and i.is_active and a.legal_entity_id = $1
        order by a.name`,
      [order.legal_entity_id, order.channel],
    ),
    query<{ id: string; number: string; shipped_on: string; ttn_number: string | null; carrier: string | null }>(
      'select id, number, shipped_on, ttn_number, carrier from shipments where so_id = $1 order by shipped_on',
      [id],
    ),
    query<{ id: string; paid_on: string; amount: number; method: string; note: string | null }>(
      'select id, paid_on, amount, method, note from payments where so_id = $1 order by paid_on',
      [id],
    ),
  ]);

  const isDraft = order.status === 'draft';
  const canShip = order.status === 'confirmed';
  const remaining = lines.reduce((s, l) => s + (l.qty - l.shipped_qty), 0);

  return (
    <>
      <PageHeader
        title={`Замовлення ${order.number}`}
        subtitle={`${order.entity_name} → ${order.customer_name} · ${SALES_CHANNELS[order.channel] ?? order.channel} · від ${fmtDate(order.ordered_on)}`}
        action={<LinkButton href="/sales">← До списку</LinkButton>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Сума з ПДВ"
          value={fmtMoney(order.total_amount)}
          hint={
            order.vat_amount > 0
              ? `база ${fmtMoney(order.net_amount)} + ПДВ ${fmtMoney(order.vat_amount)}`
              : 'без ПДВ'
          }
        />
        <Stat
          label="Відвантажено"
          value={fmtMoney(order.shipped_amount)}
          hint={order.status === 'shipped' ? 'повністю' : `лишилось ${fmtQty(remaining)} шт`}
        />
        <Stat
          label="Маржа"
          value={order.shipped_net > 0 ? fmtMoney(order.margin) : '—'}
          hint={
            order.shipped_amount > 0
              ? `${order.margin_pct}% від бази без ПДВ · собівартість ${fmtMoney(order.cogs)}`
              : undefined
          }
          tone={order.margin > 0 ? 'good' : 'default'}
        />
        <div className="rounded-2xl border border-emerald-900/10 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-800/60">Статус</div>
          <div className="mt-2">
            <Badge tone={statusTone[order.status]}>{SO_STATUS[order.status]}</Badge>
          </div>
          {(isDraft || canShip) && (
            <div className="mt-3 flex gap-2">
              {isDraft && (
                <form action={confirmSalesOrder}>
                  <input type="hidden" name="so_id" value={order.id} />
                  <Button className="!min-h-9 !px-3 text-xs">Підтвердити</Button>
                </form>
              )}
              <form action={cancelSalesOrder}>
                <input type="hidden" name="so_id" value={order.id} />
                <Button variant="ghost" className="!min-h-9 !px-3 text-xs">
                  Скасувати
                </Button>
              </form>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4">
        <Card title="Позиції">
          {lines.length === 0 ? (
            <Empty>Додайте товар у замовлення</Empty>
          ) : (
            <Table head={['Товар', 'Кількість', 'Ціна без ПДВ', 'Сума без ПДВ', 'ПДВ', 'Відвантажено', 'Доступно', ...(isDraft ? [''] : [])]}>
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
                  <Cell align="right">
                    {l.vat_rate > 0 ? (
                      <>
                        {fmtMoney((l.qty * l.unit_price * l.vat_rate) / 100)}
                        <div className="text-xs text-emerald-800/50">{l.vat_rate}%</div>
                      </>
                    ) : (
                      '—'
                    )}
                  </Cell>
                  <Cell align="right">{fmtQty(l.shipped_qty)}</Cell>
                  <Cell align="right">
                    <span className={l.stock_available + 0.0005 < l.qty - l.shipped_qty ? 'font-semibold text-red-600' : ''}>
                      {fmtQty(l.stock_available)}
                    </span>
                  </Cell>
                  {isDraft && (
                    <Cell align="right">
                      <form action={removeSalesLine}>
                        <input type="hidden" name="line_id" value={l.id} />
                        <input type="hidden" name="so_id" value={order.id} />
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

        {isDraft && (
          <Card title="Введення замовлення">
            <p className="mb-3 text-sm text-emerald-800/70">
              Заповнюйте рядки як із бланка замовлення: товар шукається за назвою, артикулом або
              штрихкодом, ціна без ПДВ підставляється з прайсу каналу «{SALES_CHANNELS[order.channel] ?? order.channel}»
              — за потреби перекрийте будь-яку з чотирьох сум, решта перерахуються.
            </p>
            <LinesEntry
              docField="so_id"
              docId={order.id}
              items={available.map((a) => ({
                id: a.id,
                name: a.name,
                sku: a.sku,
                unit: a.unit,
                kind: 'finished',
                // Неплатник ПДВ не нараховує податок — колонки «з ПДВ»
                // просто збігаються з «без ПДВ».
                vat_rate: order.seller_is_vat_payer ? Number(a.vat_rate) : 0,
                barcode: a.barcode,
                defaultPrice: a.channel_price,
                hint: `доступно ${fmtQty(a.available_qty, unitLabel(a.unit))}`,
              }))}
              pricesIncludeVat={false}
              showBatch={false}
              submitLabel="Додати рядки в замовлення"
              action={addSalesLines}
            />
          </Card>
        )}

        {canShip && (
          <Card title="Відвантаження">
            <ActionForm action={shipSalesOrder} submitLabel="Провести відвантаження">
              <input type="hidden" name="so_id" value={order.id} />
              <div className="space-y-2">
                {lines
                  .filter((l) => l.qty - l.shipped_qty > 0.0005)
                  .map((l) => (
                    <div
                      key={l.id}
                      className="flex flex-wrap items-end gap-3 rounded-xl border border-emerald-900/10 bg-emerald-50/40 p-3"
                    >
                      <div className="min-w-40 flex-1">
                        <div className="font-semibold text-emerald-950">{l.name}</div>
                        <div className="text-xs text-emerald-800/60">
                          до відвантаження {fmtQty(l.qty - l.shipped_qty)} · на складі{' '}
                          {fmtQty(l.stock_available)}
                        </div>
                      </div>
                      <div className="w-32">
                        <input
                          name={`qty_${l.id}`}
                          type="number"
                          step="0.001"
                          min="0"
                          defaultValue={l.qty - l.shipped_qty}
                          className={inputClass}
                        />
                      </div>
                    </div>
                  ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Дата">
                  <input
                    name="shipped_on"
                    type="date"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Номер ТТН">
                  <input name="ttn_number" className={inputClass} />
                </Field>
                <Field label="Перевізник">
                  <input name="carrier" className={inputClass} placeholder="Нова пошта" />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Довіреність №" hint="друкується у видатковій накладній">
                  <input name="proxy_number" className={inputClass} />
                </Field>
                <Field label="Дата довіреності">
                  <input name="proxy_date" type="date" className={inputClass} />
                </Field>
                <Field label="Отримувач за довіреністю">
                  <input name="proxy_person" className={inputClass} placeholder="Панченко І.В." />
                </Field>
              </div>
              <Field
                label="Посада отримувача"
                hint="обов'язковий реквізит первинного документа — ч. 2 ст. 9 Закону № 996-XIV"
              >
                <input name="proxy_position" className={inputClass} placeholder="Комірник" />
              </Field>
              <p className="text-xs text-emerald-800/60">
                Партії підбираються за FEFO: клієнту поїде те, у чого раніше закінчується термін.
              </p>
            </ActionForm>
          </Card>
        )}

        {(isDraft || canShip) && lines.length > 0 && (
          <Card title="Безоплатна відправка (списання)">
            <p className="mb-3 text-sm text-emerald-800/70">
              Для відправки блогерам, зразків чи подарунків: система створить відвантаження з
              нульовими цінами (щоб надрукувати ТТН і видаткову) і одразу проведе акт списання
              собівартості за обраною статтею. Виручки й дебіторки по замовленню не буде — ціни в
              рядках обнуляться.
            </p>
            <ActionForm action={giftShipFromOrder} submitLabel="Відправити безоплатно">
              <input type="hidden" name="so_id" value={order.id} />
              <Field label="Стаття витрат" hint="куди у фінрезультаті ляже собівартість">
                <select name="category" className={inputClass} defaultValue="marketing">
                  {Object.entries(EXPENSE_CATEGORIES).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </ActionForm>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Відвантаження за замовленням">
            {shipments.length === 0 ? (
              <Empty>Ще не відвантажували</Empty>
            ) : (
              <Table head={['Документ', 'Дата', 'ТТН', 'Друк']}>
                {shipments.map((s) => (
                  <Row key={s.id}>
                    <Cell>
                      <Link
                        href={`/movements/${s.id}`}
                        className="font-semibold text-emerald-700 hover:underline"
                      >
                        {s.number}
                      </Link>
                      <div className="text-xs text-emerald-800/50">Дт/Кт документа</div>
                    </Cell>
                    <Cell>{fmtDate(s.shipped_on)}</Cell>
                    <Cell>
                      {s.ttn_number ?? '—'}
                      {s.carrier && <div className="text-xs text-emerald-800/50">{s.carrier}</div>}
                    </Cell>
                    <Cell>
                      <Link
                        href={`/shipments/${s.id}/print`}
                        className="font-semibold text-emerald-700 hover:underline"
                      >
                        Видаткова
                      </Link>
                      <div>
                        <Link
                          href={`/shipments/${s.id}/ttn`}
                          className="text-xs font-semibold text-emerald-700 hover:underline"
                        >
                          ТТН
                        </Link>
                      </div>
                    </Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Card>

          <Card title="Оплати">
            <div className="mb-4 flex items-center justify-between rounded-xl bg-emerald-50/60 px-3 py-2 text-sm">
              <span className="text-emerald-800/70">
                Оплачено {fmtMoney(order.paid_amount)}
                {order.due_date && ` · термін ${fmtDate(order.due_date)}`}
              </span>
              <span className={`font-bold ${order.balance_due > 0.01 ? 'text-amber-600' : 'text-emerald-700'}`}>
                {order.balance_due > 0.01 ? `борг ${fmtMoney(order.balance_due)}` : 'закрито'}
              </span>
            </div>
            {payments.length > 0 && (
              <div className="mb-4">
                <Table head={['Дата', 'Спосіб', 'Сума']}>
                  {payments.map((p) => (
                    <Row key={p.id}>
                      <Cell>{fmtDate(p.paid_on)}</Cell>
                      <Cell>{p.method === 'bank' ? 'Банк' : p.method === 'cash' ? 'Готівка' : 'Інше'}</Cell>
                      <Cell align="right" className="font-semibold">
                        {fmtMoney(p.amount)}
                      </Cell>
                    </Row>
                  ))}
                </Table>
              </div>
            )}
            <ActionForm action={recordPayment} submitLabel="Записати оплату">
              <input type="hidden" name="so_id" value={order.id} />
              <input type="hidden" name="customer_id" value={order.customer_id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Сума">
                  <input
                    name="amount"
                    type="number"
                    step="0.01"
                    defaultValue={order.balance_due > 0 ? order.balance_due : undefined}
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
                  <option value="bank">Банк</option>
                  <option value="cash">Готівка</option>
                  <option value="other">Інше</option>
                </select>
              </Field>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
