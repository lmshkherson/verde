import { notFound } from 'next/navigation';
import { updateShipmentTransport } from '@/app/actions/sales';
import { ActionForm } from '@/components/action-form';
import { PrintButton } from '@/components/print-button';
import { Alert, Card, Field, inputClass, LinkButton } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { fmtDate, fmtQty, unitLabel } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Рядок реквізиту бланка: підпис дрібним, значення на лінії. */
function Line({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <div className="text-[9px] uppercase tracking-wide text-black/60">{label}</div>
      <div className="min-h-[1.15rem] border-b border-black text-[11px] leading-tight">{value}</div>
    </div>
  );
}

export default async function TtnPage({ params }: { params: Promise<{ shipmentId: string }> }) {
  await requireRole('sales', 'warehouse');
  const { shipmentId } = await params;

  const doc = await queryOne<{
    id: string;
    number: string;
    shipped_on: string;
    ttn_number: string | null;
    carrier: string | null;
    carrier_edrpou: string | null;
    carrier_storage_place: string | null;
    transport_kind: string | null;
    vehicle_model: string | null;
    vehicle_plate: string | null;
    trailer_model: string | null;
    trailer_plate: string | null;
    driver_name: string | null;
    freight_payer: string | null;
    loading_point: string | null;
    unloading_point: string | null;
    gross_weight_kg: number | null;
    places: number | null;
    temp_mode: string | null;
    body_type: string | null;
    temp_at_loading: number | null;
    temp_at_unloading: number | null;
    order_id: string;
    order_number: string;
    seller_name: string;
    seller_edrpou: string | null;
    seller_address: string | null;
    buyer_name: string;
    buyer_edrpou: string | null;
    buyer_address: string | null;
    buyer_legal_address: string | null;
    warehouse_address: string | null;
    net_weight_kg: number | null;
    calc_places: number | null;
    need_min_c: number | null;
    need_max_c: number | null;
    without_mode: number | null;
  }>(
    `select sh.*, o.id as order_id, o.number as order_number,
            e.name as seller_name, e.edrpou as seller_edrpou, e.address as seller_address,
            c.name as buyer_name, c.edrpou as buyer_edrpou,
            -- Возимо туди, куди возимо: у мереж це розподільчий центр, а не
            -- юридична адреса з реєстру.
            coalesce(c.delivery_address, c.address) as buyer_address,
            c.address as buyer_legal_address,
            (select w.address from warehouses w where w.kind = 'finished' limit 1) as warehouse_address,
            cargo.net_weight_kg, cargo.places as calc_places,
            t.need_min_c, t.need_max_c, t.without_mode
       from shipments sh
       join sales_orders o on o.id = sh.so_id
       join legal_entities e on e.id = o.legal_entity_id
       join customers c on c.id = o.customer_id
       left join v_shipment_cargo cargo on cargo.shipment_id = sh.id
       left join v_shipment_temp t on t.shipment_id = sh.id
      where sh.id = $1`,
    [shipmentId],
  );
  if (!doc) notFound();

  const lines = await query<{
    name: string;
    unit: string;
    qty: number;
    pcs_per_box: number | null;
    weight_g: number | null;
    temp_min_c: number | null;
    temp_max_c: number | null;
    temp_note: string | null;
  }>(
    `select i.name, i.unit, sl.qty, i.pcs_per_box, i.weight_g,
            i.temp_min_c, i.temp_max_c, i.temp_note
       from shipment_lines sl join items i on i.id = sl.item_id
      where sl.shipment_id = $1 order by i.name`,
    [shipmentId],
  );

  const netWeight = Number(doc.net_weight_kg ?? 0);
  const grossWeight = doc.gross_weight_kg != null ? Number(doc.gross_weight_kg) : netWeight;
  const places = doc.places ?? Math.round(Number(doc.calc_places ?? 0));
  const loading = doc.loading_point || doc.warehouse_address || doc.seller_address || '';
  const unloading = doc.unloading_point || doc.buyer_address || '';

  // Найвужчий діапазон, який має витримати рейс. Якщо межі перетнулися —
  // у машині позиції, які просто не можна везти разом.
  const needMin = doc.need_min_c != null ? Number(doc.need_min_c) : null;
  const needMax = doc.need_max_c != null ? Number(doc.need_max_c) : null;
  const tempConflict = needMin != null && needMax != null && needMin > needMax;
  const suggested =
    needMin != null || needMax != null
      ? `${needMin != null ? `від ${needMin}` : ''}${needMin != null && needMax != null ? ' ' : ''}${needMax != null ? `до ${needMax}` : ''} °C`.trim()
      : '';
  const tempMode = doc.temp_mode || (suggested ? `Дотримувати ${suggested}` : '');
  const outOfRange =
    doc.temp_at_loading != null &&
    ((needMin != null && Number(doc.temp_at_loading) < needMin) ||
      (needMax != null && Number(doc.temp_at_loading) > needMax));

  const missing = [
    !doc.ttn_number && 'номер ТТН',
    !doc.carrier && 'перевізник',
    !doc.vehicle_plate && 'реєстраційний номер автомобіля',
    !doc.driver_name && 'водій',
    !doc.carrier_storage_place && 'місце, де зберігається автомобіль',
    !loading && 'пункт навантаження',
    !unloading && 'пункт розвантаження',
    !tempMode && 'температурний режим',
  ].filter(Boolean) as string[];

  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <PrintButton label="Друк / зберегти PDF" />
        <LinkButton href={`/shipments/${doc.id}/print`}>Видаткова накладна</LinkButton>
        <LinkButton href={`/sales/${doc.order_id}`}>← До замовлення</LinkButton>
      </div>

      {tempConflict && (
        <div className="no-print mb-4">
          <Alert tone="red">
            У рейсі позиції з несумісними режимами: одна вимагає не нижче {needMin} °C, інша не
            вище {needMax} °C. Везти разом не можна — розділіть відвантаження.
          </Alert>
        </div>
      )}

      {outOfRange && (
        <div className="no-print mb-4">
          <Alert tone="red">
            Температура при завантаженні {String(doc.temp_at_loading)} °C виходить за потрібний
            діапазон {suggested}. Це фіксується в документі — виправляти треба на рампі, а не в
            бланку.
          </Alert>
        </div>
      )}

      {Number(doc.without_mode ?? 0) > 0 && (
        <div className="no-print mb-4">
          <Alert tone="amber">
            У {doc.without_mode} позицій рейсу не заданий температурний режим — система не може
            перевірити, чи витримано умови. Заповніть його в картці номенклатури.
          </Alert>
        </div>
      )}

      {missing.length > 0 && (
        <div className="no-print mb-4">
          <Alert tone="amber">
            Бланк неповний, не заповнено: {missing.join(', ')}. Форму реквізитів шукайте нижче під
            накладною.
          </Alert>
        </div>
      )}

      {/* Аркуш A4 альбомно — таблиця вантажу вимагає ширини. */}
      <div className="print-landscape mx-auto w-full max-w-[297mm] bg-white p-[10mm] text-black shadow-sm print:p-0 print:shadow-none">
        <div className="mb-1 text-right text-[9px]">
          Додаток 7 до Правил перевезень вантажів автомобільним транспортом в Україні
          <br />
          Форма № 1-ТН
        </div>
        <h1 className="mb-3 text-center text-base font-bold uppercase">
          Товарно-транспортна накладна № {doc.ttn_number ?? '____________'} від{' '}
          {fmtDate(doc.shipped_on)}
        </h1>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          <Line
            label="Автомобіль (марка, модель, тип, реєстраційний номер)"
            value={[doc.vehicle_model, doc.vehicle_plate].filter(Boolean).join(', ')}
          />
          <Line
            label="Причіп / напівпричіп (марка, модель, тип, реєстраційний номер)"
            value={[doc.trailer_model, doc.trailer_plate].filter(Boolean).join(', ')}
          />
          <Line label="Вид перевезень" value={doc.transport_kind ?? ''} />
          <Line
            label="Автомобільний перевізник (найменування, код ЄДРПОУ)"
            value={[doc.carrier, doc.carrier_edrpou && `код ЄДРПОУ ${doc.carrier_edrpou}`]
              .filter(Boolean)
              .join(', ')}
          />
          {/* Реквізит, що з'явився у формі з 26.07.2026. */}
          <Line
            label="Місце, де зберігається автомобіль"
            value={doc.carrier_storage_place ?? ''}
            wide
          />
          <Line label="Водій (прізвище, ім'я, по батькові)" value={doc.driver_name ?? ''} />
          <Line label="Замовник (найменування, код ЄДРПОУ)" value={doc.freight_payer ?? ''} />
          <Line
            label="Вантажовідправник (найменування, код ЄДРПОУ)"
            value={[doc.seller_name, doc.seller_edrpou && `код ЄДРПОУ ${doc.seller_edrpou}`]
              .filter(Boolean)
              .join(', ')}
            wide
          />
          <Line
            label="Вантажоодержувач (найменування, код ЄДРПОУ)"
            value={[
              doc.buyer_name,
              doc.buyer_edrpou && `код ЄДРПОУ ${doc.buyer_edrpou}`,
              doc.buyer_legal_address,
            ]
              .filter(Boolean)
              .join(', ')}
            wide
          />
          <Line label="Пункт навантаження" value={loading} />
          <Line label="Пункт розвантаження" value={unloading} />
          <Line label="Температурний режим перевезення" value={tempMode} />
          <Line label="Тип кузова" value={doc.body_type ?? ''} />
          <Line
            label="Температура при завантаженні, °C"
            value={doc.temp_at_loading != null ? String(doc.temp_at_loading) : ''}
          />
          <Line
            label="Температура при розвантаженні, °C"
            value={doc.temp_at_unloading != null ? String(doc.temp_at_unloading) : ''}
          />
          <Line
            label="Супровідні документи на вантаж"
            value={`Видаткова накладна № ${doc.number} від ${fmtDate(doc.shipped_on)}`}
            wide
          />
        </div>

        <div className="mt-4 text-[10px] font-semibold uppercase">Відомості про вантаж</div>
        <table className="mt-1 w-full border-collapse text-[11px]">
          <thead>
            <tr>
              {[
                '№',
                'Найменування вантажу',
                'Одиниця виміру',
                'Кількість',
                'Кількість місць',
                'Вид пакування',
                'Маса брутто, т',
                'Темп. режим, °C',
                'Примітка',
              ].map((h) => (
                <th key={h} className="border border-black px-1 py-0.5 text-center font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const boxes = l.pcs_per_box ? Math.ceil(Number(l.qty) / l.pcs_per_box) : Number(l.qty);
              const weightT = (Number(l.qty) * Number(l.weight_g ?? 0)) / 1_000_000;
              return (
                <tr key={`${l.name}-${i}`}>
                  <td className="border border-black px-1 py-0.5 text-center">{i + 1}</td>
                  <td className="border border-black px-1 py-0.5">{l.name}</td>
                  <td className="border border-black px-1 py-0.5 text-center">{unitLabel(l.unit)}</td>
                  <td className="border border-black px-1 py-0.5 text-right tabular-nums">
                    {fmtQty(l.qty)}
                  </td>
                  <td className="border border-black px-1 py-0.5 text-right tabular-nums">{boxes}</td>
                  <td className="border border-black px-1 py-0.5 text-center">
                    {l.pcs_per_box ? 'шоубокс' : '—'}
                  </td>
                  <td className="border border-black px-1 py-0.5 text-right tabular-nums">
                    {weightT > 0 ? weightT.toFixed(3) : '—'}
                  </td>
                  <td className="border border-black px-1 py-0.5 text-center">
                    {l.temp_min_c != null || l.temp_max_c != null
                      ? `${l.temp_min_c != null ? l.temp_min_c : ''}${l.temp_min_c != null && l.temp_max_c != null ? '…' : ''}${l.temp_max_c != null ? l.temp_max_c : ''}`
                      : '—'}
                  </td>
                  <td className="border border-black px-1 py-0.5 text-[9px]">{l.temp_note ?? ''}</td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={4} className="border border-black px-1 py-0.5 text-right font-semibold">
                Усього
              </td>
              <td className="border border-black px-1 py-0.5 text-right font-bold tabular-nums">
                {places}
              </td>
              <td className="border border-black px-1 py-0.5" />
              <td className="border border-black px-1 py-0.5 text-right font-bold tabular-nums">
                {(grossWeight / 1000).toFixed(3)}
              </td>
              <td className="border border-black px-1 py-0.5 text-center font-semibold">
                {suggested || '—'}
              </td>
              <td className="border border-black px-1 py-0.5" />
            </tr>
          </tbody>
        </table>

        <div className="mt-8 grid grid-cols-3 gap-8 text-[11px]">
          {[
            ['Здав (вантажовідправник)', 'посада, підпис, прізвище'],
            ['Прийняв (водій)', doc.driver_name ?? 'підпис, прізвище'],
            ['Прийняв (вантажоодержувач)', 'посада, підпис, прізвище'],
          ].map(([title, hint]) => (
            <div key={title}>
              <div className="font-semibold">{title}</div>
              <div className="mt-7 border-b border-black" />
              <div className="mt-0.5 text-[9px] text-black/60">{hint}</div>
              <div className="mt-3 text-[9px] text-black/60">М.П. (за наявності печатки)</div>
            </div>
          ))}
        </div>

        {tempMode && (
          <p className="mt-4 text-[10px]">
            Температурний режим перевіряв: ____________________ / ____________________
            <span className="ml-2 text-black/60">(підпис, прізвище)</span>
          </p>
        )}

        <p className="mt-5 text-[9px] text-black/60">
          Складається у трьох примірниках: вантажовідправнику, вантажоодержувачу й перевізнику.
        </p>
      </div>

      <div className="no-print mx-auto mt-6 w-full max-w-[297mm]">
        <Card title="Реквізити перевезення">
          <p className="mb-3 text-sm text-emerald-800/70">
            Марку автомобіля й прізвище водія дізнаються на завантаженні, тож вони заповнюються тут,
            а не в момент виписки відвантаження. Пункти навантаження й розвантаження, якщо їх не
            вказати, беруться з адреси складу та юридичної адреси клієнта.
          </p>
          <ActionForm action={updateShipmentTransport} submitLabel="Зберегти реквізити">
            <input type="hidden" name="shipment_id" value={doc.id} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Номер ТТН">
                <input name="ttn_number" defaultValue={doc.ttn_number ?? ''} className={inputClass} />
              </Field>
              <Field label="Вид перевезень">
                <input
                  name="transport_kind"
                  defaultValue={doc.transport_kind ?? ''}
                  className={inputClass}
                  placeholder="Комерційні"
                />
              </Field>
              <Field label="Замовник (платник за перевезення)">
                <input name="freight_payer" defaultValue={doc.freight_payer ?? ''} className={inputClass} />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Автомобільний перевізник">
                <input name="carrier" defaultValue={doc.carrier ?? ''} className={inputClass} />
              </Field>
              <Field label="ЄДРПОУ перевізника">
                <input name="carrier_edrpou" defaultValue={doc.carrier_edrpou ?? ''} className={inputClass} />
              </Field>
            </div>

            <Field
              label="Місце, де зберігається автомобіль"
              hint="Обов'язковий реквізит форми з 26.07.2026 — адреса, де стоїть автомобіль перевізника"
            >
              <input
                name="carrier_storage_place"
                defaultValue={doc.carrier_storage_place ?? ''}
                className={inputClass}
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Автомобіль">
                <input name="vehicle_model" defaultValue={doc.vehicle_model ?? ''} className={inputClass} placeholder="Renault Master" />
              </Field>
              <Field label="Держ. номер">
                <input name="vehicle_plate" defaultValue={doc.vehicle_plate ?? ''} className={inputClass} placeholder="AA1234BB" />
              </Field>
              <Field label="Причіп">
                <input name="trailer_model" defaultValue={doc.trailer_model ?? ''} className={inputClass} />
              </Field>
              <Field label="Номер причепа">
                <input name="trailer_plate" defaultValue={doc.trailer_plate ?? ''} className={inputClass} />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Температурний режим перевезення"
                hint={suggested ? `за позиціями рейсу потрібно ${suggested}` : 'у позиціях режим не заданий'}
              >
                <input
                  name="temp_mode"
                  defaultValue={doc.temp_mode ?? ''}
                  className={inputClass}
                  placeholder={suggested ? `Дотримувати ${suggested}` : '+2…+6 °C'}
                />
              </Field>
              <Field label="Тип кузова">
                <input
                  name="body_type"
                  defaultValue={doc.body_type ?? ''}
                  className={inputClass}
                  placeholder="Ізотермічний / рефрижератор"
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Температура при завантаженні, °C" hint="заміряна на рампі">
                <input
                  name="temp_at_loading"
                  type="number"
                  step="0.1"
                  defaultValue={doc.temp_at_loading ?? ''}
                  className={inputClass}
                />
              </Field>
              <Field label="Температура при розвантаженні, °C" hint="вписує одержувач">
                <input
                  name="temp_at_unloading"
                  type="number"
                  step="0.1"
                  defaultValue={doc.temp_at_unloading ?? ''}
                  className={inputClass}
                />
              </Field>
            </div>

            <Field label="Водій (ПІБ)">
              <input name="driver_name" defaultValue={doc.driver_name ?? ''} className={inputClass} />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Пункт навантаження" hint={doc.warehouse_address ? `за замовчуванням: ${doc.warehouse_address}` : undefined}>
                <input name="loading_point" defaultValue={doc.loading_point ?? ''} className={inputClass} />
              </Field>
              <Field label="Пункт розвантаження" hint={doc.buyer_address ? `за замовчуванням: ${doc.buyer_address}` : undefined}>
                <input name="unloading_point" defaultValue={doc.unloading_point ?? ''} className={inputClass} />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Маса брутто, кг" hint={`розрахункова нетто: ${netWeight.toFixed(3)} кг`}>
                <input
                  name="gross_weight_kg"
                  type="number"
                  step="0.001"
                  min="0"
                  defaultValue={doc.gross_weight_kg ?? ''}
                  className={inputClass}
                />
              </Field>
              <Field label="Кількість місць" hint={`розрахункова: ${Math.round(Number(doc.calc_places ?? 0))}`}>
                <input
                  name="places"
                  type="number"
                  min="0"
                  defaultValue={doc.places ?? ''}
                  className={inputClass}
                />
              </Field>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
