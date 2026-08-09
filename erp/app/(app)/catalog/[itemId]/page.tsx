import Link from 'next/link';
import { notFound } from 'next/navigation';
import { setItemActive, updateItem } from '@/app/actions/catalog';
import { Barcode } from '@/components/barcode';
import { ActionForm } from '@/components/action-form';
import { Alert, Badge, Card, Cell, Empty, Field, inputClass, LinkButton, PageHeader, Row, Table } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { fmtMoney, fmtQty, ITEM_KINDS, UNITS, unitLabel } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function ItemEditPage({ params }: { params: Promise<{ itemId: string }> }) {
  await requireRole('production', 'sales', 'warehouse');
  const { itemId } = await params;

  const item = await queryOne<{
    id: string;
    sku: string;
    name: string;
    kind: string;
    unit: string;
    shelf_life_days: number | null;
    min_stock: number;
    weight_g: number | null;
    pcs_per_box: number | null;
    price_distributor: number | null;
    price_network: number | null;
    price_rrp: number | null;
    vat_rate: number;
    uktzed: string | null;
    uom_code: string | null;
    barcode: string | null;
    temp_min_c: number | null;
    temp_max_c: number | null;
    temp_note: string | null;
    note: string | null;
    is_active: boolean;
    moves: number;
  }>(
    `select i.*, (select count(*) from stock_moves m where m.item_id = i.id)::int as moves
       from items i where i.id = $1`,
    [itemId],
  );
  if (!item) notFound();

  const stock = await query<{ entity: string; qty: number; value: number }>(
    `select e.short_name as entity, s.qty, s.value
       from v_item_stock s join legal_entities e on e.id = s.legal_entity_id
      where s.item_id = $1
      order by e.short_name`,
    [itemId],
  );

  const onHand = stock.reduce((sum, s) => sum + Number(s.qty), 0);
  const locked = item.moves > 0;

  return (
    <>
      <PageHeader
        title={item.name}
        subtitle={`${item.sku} · ${ITEM_KINDS[item.kind]}`}
        action={
          <div className="flex gap-2">
            <LinkButton href={`/stock/${item.id}`}>Картка залишків</LinkButton>
            <LinkButton href="/catalog">← До номенклатури</LinkButton>
          </div>
        }
      />

      {!item.is_active && (
        <div className="mb-4">
          <Alert tone="amber">
            Позиція деактивована: у виборі документів її немає, але вся її історія збережена.
          </Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card title="Редагування">
          <ActionForm action={updateItem} submitLabel="Зберегти">
            <input type="hidden" name="item_id" value={item.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Артикул (SKU)">
                <input name="sku" required defaultValue={item.sku} className={inputClass} />
              </Field>
              <Field label="Назва">
                <input name="name" required defaultValue={item.name} className={inputClass} />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Тип"
                hint={locked ? 'Заблоковано: по позиції вже є рухи' : undefined}
              >
                <select
                  name="kind"
                  required
                  defaultValue={item.kind}
                  disabled={locked}
                  className={`${inputClass} disabled:bg-emerald-900/5`}
                >
                  {Object.entries(ITEM_KINDS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Одиниця"
                hint={locked ? 'Заблоковано: залишок рахується в цих одиницях' : undefined}
              >
                <select
                  name="unit"
                  required
                  defaultValue={item.unit}
                  disabled={locked}
                  className={`${inputClass} disabled:bg-emerald-900/5`}
                >
                  {Object.entries(UNITS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {/* Заблоковані поля браузер не надсилає — повертаємо значення прихованими,
                інакше збереження стерло б тип і одиницю. */}
            {locked && (
              <>
                <input type="hidden" name="kind" value={item.kind} />
                <input type="hidden" name="unit" value={item.unit} />
              </>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Термін придатності, дн.">
                <input
                  name="shelf_life_days"
                  type="number"
                  min="0"
                  defaultValue={item.shelf_life_days ?? ''}
                  className={inputClass}
                />
              </Field>
              <Field label="Мінімальний залишок">
                <input
                  name="min_stock"
                  type="number"
                  step="0.001"
                  min="0"
                  defaultValue={item.min_stock}
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Вага, г">
                <input
                  name="weight_g"
                  type="number"
                  step="0.1"
                  min="0"
                  defaultValue={item.weight_g ?? ''}
                  className={inputClass}
                />
              </Field>
              <Field label="Шт. у шоубоксі">
                <input
                  name="pcs_per_box"
                  type="number"
                  min="0"
                  defaultValue={item.pcs_per_box ?? ''}
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Ціна дистриб'ютора" hint="без ПДВ">
                <input
                  name="price_distributor"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={item.price_distributor ?? ''}
                  className={inputClass}
                />
              </Field>
              <Field label="Ціна на мережу" hint="без ПДВ">
                <input
                  name="price_network"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={item.price_network ?? ''}
                  className={inputClass}
                />
              </Field>
              <Field label="РРЦ" hint="без ПДВ">
                <input
                  name="price_rrp"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={item.price_rrp ?? ''}
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Ставка ПДВ, %" hint="діє на нові документи">
                <input
                  name="vat_rate"
                  type="number"
                  step="0.1"
                  min="0"
                  defaultValue={item.vat_rate}
                  className={inputClass}
                />
              </Field>
              <Field label="УКТ ЗЕД" hint="для податкової накладної">
                <input name="uktzed" defaultValue={item.uktzed ?? ''} className={inputClass} />
              </Field>
              <Field label="Код одиниці" hint="КСПОВО: кг — 0301, шт — 2009">
                <input name="uom_code" defaultValue={item.uom_code ?? ''} className={inputClass} />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Температура від, °C" hint="порожньо — режим не задано">
                <input
                  name="temp_min_c"
                  type="number"
                  step="0.1"
                  defaultValue={item.temp_min_c ?? ''}
                  className={inputClass}
                />
              </Field>
              <Field label="Температура до, °C">
                <input
                  name="temp_max_c"
                  type="number"
                  step="0.1"
                  defaultValue={item.temp_max_c ?? ''}
                  className={inputClass}
                />
              </Field>
              <Field label="Уточнення з етикетки">
                <input
                  name="temp_note"
                  defaultValue={item.temp_note ?? ''}
                  className={inputClass}
                  placeholder="вологість не вище 75%"
                />
              </Field>
            </div>

            <Field
              label="Штрихкод (EAN-13 / EAN-8)"
              hint="Можна ввести 12 цифр від GS1 — контрольну система дорахує сама"
            >
              <input
                name="barcode"
                inputMode="numeric"
                defaultValue={item.barcode ?? ''}
                className={inputClass}
                placeholder="4820024700016"
              />
            </Field>
            {item.barcode && (
              <div className="rounded-xl border border-emerald-900/10 bg-white p-3 text-center">
                <Barcode value={item.barcode} barHeight={50} />
              </div>
            )}

            <Field label="Примітка">
              <input name="note" defaultValue={item.note ?? ''} className={inputClass} />
            </Field>
          </ActionForm>
        </Card>

        <div className="space-y-4">
          <Card title="Залишки по юрособах">
            {stock.length === 0 ? (
              <Empty>Залишків немає</Empty>
            ) : (
              <Table head={['Юрособа', 'Кількість', 'Вартість']}>
                {stock.map((s) => (
                  <Row key={s.entity}>
                    <Cell className="font-semibold">{s.entity}</Cell>
                    <Cell align="right">{fmtQty(s.qty, unitLabel(item.unit))}</Cell>
                    <Cell align="right">{fmtMoney(s.value)}</Cell>
                  </Row>
                ))}
              </Table>
            )}
            <p className="mt-3 text-sm text-emerald-800/70">
              Рухів за весь час: <span className="font-semibold">{item.moves}</span>.{' '}
              <Link href={`/stock/${item.id}`} className="text-emerald-700 hover:underline">
                Переглянути
              </Link>
            </p>
          </Card>

          <Card title={item.is_active ? 'Деактивація' : 'Активація'}>
            <p className="mb-3 text-sm text-emerald-800/70">
              {item.is_active
                ? 'Позиція зникне зі списків вибору в документах. Історія, партії та проводки лишаються недоторканими — саме тому видалення тут не передбачене.'
                : 'Позиція повернеться у списки вибору.'}
            </p>
            {item.is_active && Math.abs(onHand) > 0.0005 && (
              <div className="mb-3">
                <Alert tone="amber">
                  На складі ще {fmtQty(onHand, unitLabel(item.unit))} — деактивувати не можна,
                  бо залишок зник би зі складських екранів разом із вартістю.
                </Alert>
              </div>
            )}
            <ActionForm
              action={setItemActive}
              submitLabel={item.is_active ? 'Деактивувати' : 'Активувати'}
              variant={item.is_active ? 'danger' : 'primary'}
            >
              <input type="hidden" name="item_id" value={item.id} />
              <input type="hidden" name="active" value={item.is_active ? 'false' : 'true'} />
            </ActionForm>
          </Card>

          <Card title="Стан">
            <Badge tone={item.is_active ? 'green' : 'gray'}>
              {item.is_active ? 'Активна' : 'Деактивована'}
            </Badge>
          </Card>
        </div>
      </div>
    </>
  );
}
