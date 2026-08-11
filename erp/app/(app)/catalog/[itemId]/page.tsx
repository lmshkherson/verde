import Link from 'next/link';
import { notFound } from 'next/navigation';
import { saveItemPrices, setItemActive, updateItem } from '@/app/actions/catalog';
import { saveAllergens, saveNutrition } from '@/app/actions/labeling';
import { Barcode } from '@/components/barcode';
import { ActionForm } from '@/components/action-form';
import { Alert, Badge, Card, Cell, Empty, Field, inputClass, LinkButton, PageHeader, Row, Table } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { EXPENSE_CATEGORIES, fmtDate, fmtMoney, fmtQty, ITEM_KINDS, SALES_CHANNELS, STOCK_ITEM_KINDS, UNITS, unitLabel } from '@/lib/format';
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
    vat_rate: number;
    uktzed: string | null;
    uom_code: string | null;
    barcode: string | null;
    temp_min_c: number | null;
    temp_max_c: number | null;
    temp_note: string | null;
    quality_control: boolean;
    acceptance_spec: string | null;
    label_name: string | null;
    nutrition_source: string | null;
    country_of_origin: string | null;
    kcal_100: number | null;
    protein_100: number | null;
    fat_100: number | null;
    fat_sat_100: number | null;
    carbs_100: number | null;
    sugars_100: number | null;
    polyols_100: number | null;
    fiber_100: number | null;
    salt_100: number | null;
    note: string | null;
    is_active: boolean;
    expense_category: string | null;
    cost_behavior: string;
    moves: number;
  }>(
    `select i.*, (select count(*) from stock_moves m where m.item_id = i.id)::int as moves
       from items i where i.id = $1`,
    [itemId],
  );
  if (!item) notFound();

  // Послуга — інша сутність: без складу, партій і поживних даних. Її картка
  // редагує лише те, що впливає на витрати, і показує історію цих витрат.
  if (item.kind === 'service') {
    const [history, totals] = await Promise.all([
      query<{ spent_on: string | Date; description: string; amount_net: number; entity: string }>(
        `select x.spent_on, x.description, x.amount_net, e.short_name as entity
           from expenses x
           join legal_entities e on e.id = x.legal_entity_id
          where x.item_id = $1
          order by x.spent_on desc, x.created_at desc
          limit 24`,
        [itemId],
      ),
      queryOne<{ total: number; month: number; n: number }>(
        `select coalesce(sum(amount_net), 0) as total,
                coalesce(sum(amount_net) filter (
                  where spent_on >= date_trunc('month', current_date)), 0) as month,
                count(*)::int as n
           from expenses where item_id = $1`,
        [itemId],
      ),
    ]);

    return (
      <>
        <PageHeader
          title={item.name}
          subtitle={`${item.sku} · ${ITEM_KINDS[item.kind]}`}
          action={<LinkButton href="/catalog?kind=service">← До номенклатури</LinkButton>}
        />

        {!item.is_active && (
          <div className="mb-4">
            <Alert tone="amber">
              Послуга деактивована: у виборі документів її немає, але історія витрат збережена.
            </Alert>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            <Card title="Редагування">
              <ActionForm action={updateItem} submitLabel="Зберегти">
                <input type="hidden" name="item_id" value={item.id} />
                <input type="hidden" name="kind" value="service" />
                <input type="hidden" name="unit" value={item.unit} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Артикул (SKU)">
                    <input name="sku" required defaultValue={item.sku} className={inputClass} />
                  </Field>
                  <Field label="Назва">
                    <input name="name" required defaultValue={item.name} className={inputClass} />
                  </Field>
                </div>
                <Field label="Стаття витрат" hint="діє на нові документи, проведені не переписує">
                  <select
                    name="expense_category"
                    required
                    defaultValue={item.expense_category ?? 'services'}
                    className={inputClass}
                  >
                    {Object.entries(EXPENSE_CATEGORIES).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Поведінка витрати" hint="змінна росте з обсягом випуску">
                    <select name="cost_behavior" defaultValue={item.cost_behavior} className={inputClass}>
                      <option value="fixed">Постійна</option>
                      <option value="variable">Змінна</option>
                    </select>
                  </Field>
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
                </div>
                <Field label="Примітка">
                  <input name="note" defaultValue={item.note ?? ''} className={inputClass} />
                </Field>
              </ActionForm>
            </Card>

            <Card title="Витрати за цією послугою">
              {history.length === 0 ? (
                <Empty>Проведених витрат ще немає</Empty>
              ) : (
                <Table head={['Дата', 'Призначення', 'Юрособа', 'Сума без ПДВ']}>
                  {history.map((h, i) => (
                    <Row key={i}>
                      <Cell>{fmtDate(h.spent_on)}</Cell>
                      <Cell className="font-semibold">{h.description}</Cell>
                      <Cell>{h.entity}</Cell>
                      <Cell align="right">{fmtMoney(h.amount_net)}</Cell>
                    </Row>
                  ))}
                </Table>
              )}
            </Card>
          </div>

          <div className="space-y-4">
            <Card title="Разом">
              <dl className="space-y-2 text-sm">
                {(
                  [
                    ['За поточний місяць', fmtMoney(totals?.month ?? 0)],
                    ['За весь час', fmtMoney(totals?.total ?? 0)],
                    ['Проведених витрат', String(totals?.n ?? 0)],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-emerald-800/60">{k}</dt>
                    <dd className="font-semibold text-emerald-950">{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>

            <Card title={item.is_active ? 'Деактивація' : 'Активація'}>
              <p className="mb-3 text-sm text-emerald-800/70">
                {item.is_active
                  ? 'Послуга зникне зі списків вибору в надходженні. Проведені витрати лишаються.'
                  : 'Послуга повернеться у списки вибору.'}
              </p>
              <ActionForm
                action={setItemActive}
                submitLabel={item.is_active ? 'Деактивувати' : 'Активувати'}
                variant={item.is_active ? 'danger' : 'primary'}
              >
                <input type="hidden" name="item_id" value={item.id} />
                <input type="hidden" name="active" value={item.is_active ? 'false' : 'true'} />
              </ActionForm>
            </Card>
          </div>
        </div>
      </>
    );
  }

  const channelPrices = await query<{ channel: string; price: number }>(
    'select channel, price from item_prices where item_id = $1',
    [itemId],
  );
  const priceOf = new Map(channelPrices.map((p) => [p.channel, Number(p.price)]));

  const allergens = await query<{ code: string; name: string; kind: string | null }>(
    `select a.code, a.name, ia.kind
       from allergens a
       left join item_allergens ia on ia.allergen_code = a.code and ia.item_id = $1
      order by a.sort_order`,
    [itemId],
  );

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
                  {STOCK_ITEM_KINDS.map((key) => (
                    <option key={key} value={key}>
                      {ITEM_KINDS[key]}
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

            <div className="rounded-xl border border-emerald-900/10 p-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                <input
                  type="checkbox"
                  name="quality_control"
                  defaultChecked={item.quality_control}
                  className="size-4"
                />
                Потребує вхідного контролю
              </label>
              <p className="mt-1 text-xs text-emerald-800/60">
                Партія такої позиції після приходу стає в карантин і не підбирається у виробництво,
                доки не буде закритий акт вхідного контролю з документом постачальника.
              </p>
              <div className="mt-3">
                <Field label="Вимоги приймання" hint="що саме звіряють із поставкою">
                  <input
                    name="acceptance_spec"
                    defaultValue={item.acceptance_spec ?? ''}
                    className={inputClass}
                    placeholder="Без стороннього запаху, вологість не вище 20%, посвідчення про якість"
                  />
                </Field>
              </div>
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

        {item.kind !== 'service' && (
          <Card title="Ціни по каналах продажу">
            <p className="mb-3 text-sm text-emerald-800/70">
              Ціни без ПДВ. Канал клієнта визначає, яка з них підставиться в замовлення.
              Порожнє поле — «для цього каналу ціни немає»: замовлення такого каналу попросить
              ціну, а не підставить нуль.
            </p>
            <ActionForm action={saveItemPrices} submitLabel="Зберегти прайс" variant="ghost">
              <input type="hidden" name="item_id" value={item.id} />
              <div className="grid gap-3 sm:grid-cols-3">
                {Object.entries(SALES_CHANNELS).map(([key, label]) => (
                  <Field key={key} label={label}>
                    <input
                      name={`price_${key}`}
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={priceOf.get(key) ?? ''}
                      className={inputClass}
                    />
                  </Field>
                ))}
              </div>
            </ActionForm>
          </Card>
        )}

        <Card title="Поживна цінність на 100 г">
          <p className="mb-3 text-sm text-emerald-800/70">
            Дані беруться зі специфікації постачальника або з протоколу досліджень. Порожнє поле —
            це «даних немає», а не нуль: нуль жиру в олії був би брехнею на етикетці, тож
            специфікація продукту з незаповненим інгредієнтом не затвердиться.
          </p>
          <ActionForm action={saveNutrition} submitLabel="Зберегти поживні дані" variant="ghost">
            <input type="hidden" name="item_id" value={item.id} />
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  ['kcal_100', 'Енергія, ккал', item.kcal_100],
                  ['protein_100', 'Білки, г', item.protein_100],
                  ['fat_100', 'Жири, г', item.fat_100],
                  ['fat_sat_100', 'у т.ч. насичені, г', item.fat_sat_100],
                  ['carbs_100', 'Вуглеводи, г', item.carbs_100],
                  ['sugars_100', 'у т.ч. цукри, г', item.sugars_100],
                  ['polyols_100', 'у т.ч. спирти, г', item.polyols_100],
                  ['fiber_100', 'Харчові волокна, г', item.fiber_100],
                  ['salt_100', 'Сіль, г', item.salt_100],
                ] as [string, string, number | null][]
              ).map(([name, label, value]) => (
                <Field key={name} label={label}>
                  <input
                    name={name}
                    type="number"
                    step="0.01"
                    defaultValue={value ?? ''}
                    className={inputClass}
                  />
                </Field>
              ))}
            </div>
            <Field label="Назва для складу на етикетці" hint="«паста фінікова», а не назва з довідника">
              <input name="label_name" defaultValue={item.label_name ?? ''} className={inputClass} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Джерело даних">
                <input
                  name="nutrition_source"
                  defaultValue={item.nutrition_source ?? ''}
                  className={inputClass}
                  placeholder="Специфікація постачальника № 12/2026"
                />
              </Field>
              <Field label="Країна походження">
                <input
                  name="country_of_origin"
                  defaultValue={item.country_of_origin ?? ''}
                  className={inputClass}
                />
              </Field>
            </div>
          </ActionForm>
        </Card>

        <Card title="Алергени">
          <p className="mb-3 text-sm text-emerald-800/70">
            Перелік закритий — це 14 груп із додатка до Закону № 2639-VIII. «Містить» іде у склад
            виділенням, «сліди» — окремим рядком нижче: перше є складом, друге попередженням про
            перехресне забруднення, і плутати їх не можна.
          </p>
          <ActionForm action={saveAllergens} submitLabel="Зберегти алергени" variant="ghost">
            <input type="hidden" name="item_id" value={item.id} />
            <div className="grid gap-2 sm:grid-cols-2">
              {allergens.map((a) => (
                <Field key={a.code} label={a.name}>
                  <select
                    name={`allergen_${a.code}`}
                    defaultValue={a.kind ?? ''}
                    className={inputClass}
                  >
                    <option value="">немає</option>
                    <option value="contains">містить</option>
                    <option value="traces">сліди</option>
                  </select>
                </Field>
              ))}
            </div>
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
