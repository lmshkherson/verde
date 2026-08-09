import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  addBatchDocument,
  cancelInspection,
  checkInspectionLine,
  completeInspection,
  removeBatchDocument,
} from '@/app/actions/quality';
import { ActionForm } from '@/components/action-form';
import { PrintButton } from '@/components/print-button';
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
import { fmtDate, fmtQty, isoDay, unitLabel } from '@/lib/format';
import { DOC_KINDS, INSPECTION_STATUS, VERDICTS } from '@/lib/quality';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

interface Line {
  id: string;
  batch_id: string;
  batch_code: string;
  item_name: string;
  sku: string;
  unit: string;
  qty: number;
  temp_c: number | null;
  temp_min_c: number | null;
  temp_max_c: number | null;
  acceptance_spec: string | null;
  package_ok: boolean | null;
  marking_ok: boolean | null;
  organoleptic_ok: boolean | null;
  verdict: string;
  corrective_action: string | null;
  note: string | null;
  expires_on: string | null;
  valid_docs: number;
}

export default async function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole('warehouse', 'production');
  const { id } = await params;

  const doc = await queryOne<{
    id: string;
    number: string;
    received_on: string;
    status: string;
    transport_temp_c: number | null;
    transport_ok: boolean;
    vehicle: string | null;
    note: string | null;
    entity_name: string;
    supplier_id: string | null;
    supplier: string | null;
    supplier_edrpou: string | null;
    supplier_approved: boolean | null;
    approved_until: string | Date | null;
    po_id: string | null;
    purchase_number: string | null;
    inspector: string | null;
    inspector_position: string | null;
  }>(
    `select a.id, a.number, a.received_on, a.status, a.transport_temp_c, a.transport_ok,
            a.vehicle, a.note,
            e.name as entity_name,
            s.id as supplier_id, s.name as supplier, s.edrpou as supplier_edrpou,
            s.is_approved as supplier_approved, s.approved_until,
            p.id as po_id, p.number as purchase_number,
            u.full_name as inspector, u.position as inspector_position
       from incoming_inspections a
       join legal_entities e on e.id = a.legal_entity_id
       left join suppliers s on s.id = a.supplier_id
       left join purchase_orders p on p.id = a.po_id
       left join app_users u on u.id = a.created_by
      where a.id = $1 and a.legal_entity_id = $2`,
    [id, session.eid],
  );
  if (!doc) notFound();

  const [lines, docs] = await Promise.all([
    query<Line>(
      `select l.id, l.batch_id, b.code as batch_code, i.name as item_name, i.sku, i.unit,
              l.qty, l.temp_c, i.temp_min_c, i.temp_max_c, i.acceptance_spec,
              l.package_ok, l.marking_ok, l.organoleptic_ok, l.verdict,
              l.corrective_action, l.note, b.expires_on,
              coalesce(d.valid_docs, 0) as valid_docs
         from incoming_inspection_lines l
         join batches b on b.id = l.batch_id
         join items i on i.id = l.item_id
         left join v_batch_docs d on d.batch_id = l.batch_id
        where l.inspection_id = $1
        order by i.name`,
      [id],
    ),
    query<{
      id: string;
      batch_id: string;
      kind: string;
      number: string;
      issuer: string | null;
      valid_until: string | null;
      batches: number;
    }>(
      // Один документ постачальника часто лягає на всі партії поставки —
      // показуємо його одним рядком, а не стільки разів, скільки позицій.
      `select min(d.id::text)::uuid as id, min(d.batch_id::text)::uuid as batch_id,
              d.kind, d.number, min(d.issuer) as issuer, max(d.valid_until) as valid_until,
              count(*)::int as batches
         from batch_documents d
         join incoming_inspection_lines l on l.batch_id = d.batch_id
        where l.inspection_id = $1
        group by d.kind, d.number
        order by d.kind, d.number`,
      [id],
    ),
  ]);

  const open = doc.status === 'draft';
  const accepted = lines.filter((l) => l.verdict === 'accepted').length;
  const rejected = lines.filter((l) => l.verdict === 'rejected').length;
  const pending = lines.filter((l) => l.verdict === 'pending').length;
  const today = new Date().toISOString().slice(0, 10);
  const approvalExpired = !!doc.approved_until && (isoDay(doc.approved_until) ?? '') < today;

  return (
    <>
      <div className="no-print">
        <PageHeader
          title={`Акт вхідного контролю ${doc.number}`}
          subtitle={`${doc.supplier ?? 'без постачальника'} · ${fmtDate(doc.received_on)}`}
          action={
            <div className="flex flex-wrap gap-2">
              <Badge tone={open ? 'amber' : doc.status === 'cancelled' ? 'gray' : 'green'}>
                {INSPECTION_STATUS[doc.status]}
              </Badge>
              {doc.po_id && <LinkButton href={`/purchasing/${doc.po_id}`}>Прихід</LinkButton>}
              <PrintButton label="Друк акта" />
            </div>
          }
        />

        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Позицій" value={String(lines.length)} />
          <Stat label="Прийнято" value={String(accepted)} tone="good" />
          <Stat label="Забраковано" value={String(rejected)} tone={rejected > 0 ? 'danger' : 'default'} />
          <Stat label="Не перевірено" value={String(pending)} tone={pending > 0 ? 'warn' : 'good'} />
        </div>

        {doc.supplier && !doc.supplier_approved && (
          <Alert tone="red">
            Постачальник «{doc.supplier}» не входить до переліку затверджених. Поки це так, жодну
            позицію акта прийняти не вдасться —{' '}
            <Link href={`/purchasing/suppliers/${doc.supplier_id}`} className="underline">
              відкрийте картку постачальника
            </Link>{' '}
            й затвердьте його або поверніть поставку.
          </Alert>
        )}
        {doc.supplier && doc.supplier_approved && approvalExpired && (
          <Alert tone="amber">
            Затвердження постачальника «{doc.supplier}» скінчилося {fmtDate(doc.approved_until)}.
            Оцінку треба переглянути — інакше приймання заблоковане.
          </Alert>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            <Card title="Позиції поставки">
              {lines.length === 0 ? (
                <Empty>У акті немає позицій</Empty>
              ) : (
                <div className="space-y-3">
                  {lines.map((l) => {
                    const mode =
                      l.temp_min_c !== null || l.temp_max_c !== null
                        ? `${l.temp_min_c ?? '−∞'}…${l.temp_max_c ?? '+∞'} °C`
                        : null;
                    const outOfRange =
                      l.temp_c !== null &&
                      ((l.temp_min_c !== null && Number(l.temp_c) < Number(l.temp_min_c)) ||
                        (l.temp_max_c !== null && Number(l.temp_c) > Number(l.temp_max_c)));

                    return (
                      <div
                        key={l.id}
                        className="rounded-xl border border-emerald-900/10 p-3"
                        data-line={l.sku}
                      >
                        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                          <div>
                            <span className="font-semibold text-emerald-950">{l.item_name}</span>
                            <span className="ml-2 text-xs text-emerald-800/60">
                              {fmtQty(l.qty)} {unitLabel(l.unit)} · партія {l.batch_code}
                              {l.expires_on ? ` · до ${fmtDate(l.expires_on)}` : ''}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {l.valid_docs === 0 ? (
                              <Badge tone="red">без документа</Badge>
                            ) : (
                              <Badge tone="blue">документів: {l.valid_docs}</Badge>
                            )}
                            <Badge
                              tone={
                                l.verdict === 'accepted'
                                  ? 'green'
                                  : l.verdict === 'rejected'
                                    ? 'red'
                                    : 'amber'
                              }
                            >
                              {VERDICTS[l.verdict]}
                            </Badge>
                          </div>
                        </div>

                        {(mode || l.acceptance_spec) && (
                          <p className="mb-2 text-xs text-emerald-800/60">
                            {mode && <>Режим зберігання {mode}. </>}
                            {l.acceptance_spec}
                          </p>
                        )}

                        {open ? (
                          <ActionForm
                            action={checkInspectionLine}
                            submitLabel="Записати"
                            variant="ghost"
                            hideSuccess
                          >
                            <input type="hidden" name="inspection_id" value={doc.id} />
                            <input type="hidden" name="line_id" value={l.id} />
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Field label="Температура при прийманні, °C">
                                <input
                                  name="temp_c"
                                  type="number"
                                  step="0.1"
                                  defaultValue={l.temp_c ?? ''}
                                  className={inputClass}
                                />
                              </Field>
                              <Field label="Рішення">
                                <select
                                  name="verdict"
                                  defaultValue={l.verdict}
                                  className={inputClass}
                                >
                                  <option value="pending">Ще перевіряємо</option>
                                  <option value="accepted">Прийняти</option>
                                  <option value="rejected">Забракувати</option>
                                </select>
                              </Field>
                            </div>
                            <div className="flex flex-wrap gap-4 text-sm text-emerald-900">
                              {[
                                ['package_ok', 'Упаковка ціла', l.package_ok],
                                ['marking_ok', 'Маркування відповідає', l.marking_ok],
                                ['organoleptic_ok', 'Органолептика в нормі', l.organoleptic_ok],
                              ].map(([name, label, value]) => (
                                <label key={String(name)} className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    name={String(name)}
                                    defaultChecked={value === null ? true : Boolean(value)}
                                    className="size-4"
                                  />
                                  {label}
                                </label>
                              ))}
                            </div>
                            <Field
                              label="Коригувальна дія"
                              hint="обов'язкова, якщо є відхилення або партію бракуємо"
                            >
                              <input
                                name="corrective_action"
                                defaultValue={l.corrective_action ?? ''}
                                className={inputClass}
                              />
                            </Field>
                            <Field label="Примітка">
                              <input name="note" defaultValue={l.note ?? ''} className={inputClass} />
                            </Field>
                          </ActionForm>
                        ) : (
                          <div className="text-sm text-emerald-800/70">
                            {l.temp_c !== null && (
                              <span className={outOfRange ? 'font-semibold text-red-600' : ''}>
                                {l.temp_c} °C.{' '}
                              </span>
                            )}
                            {l.corrective_action && <>Коригувальна дія: {l.corrective_action}. </>}
                            {l.note}
                          </div>
                        )}

                        {open && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs font-semibold text-emerald-700">
                              Документ саме на цю партію
                            </summary>
                            <div className="mt-2">
                              <ActionForm
                                action={addBatchDocument}
                                submitLabel="Додати документ"
                                variant="ghost"
                                hideSuccess
                              >
                                <input type="hidden" name="inspection_id" value={doc.id} />
                                <input type="hidden" name="batch_id" value={l.batch_id} />
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <Field label="Вид">
                                    <select name="kind" className={inputClass} defaultValue="quality">
                                      {Object.entries(DOC_KINDS).map(([k, v]) => (
                                        <option key={k} value={k}>
                                          {v}
                                        </option>
                                      ))}
                                    </select>
                                  </Field>
                                  <Field label="Номер">
                                    <input name="number" className={inputClass} />
                                  </Field>
                                  <Field label="Дійсний до">
                                    <input name="valid_until" type="date" className={inputClass} />
                                  </Field>
                                  <Field label="Ким виданий">
                                    <input name="issuer" className={inputClass} />
                                  </Field>
                                </div>
                              </ActionForm>
                            </div>
                          </details>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card title="Документи постачальника">
              {docs.length === 0 ? (
                <Empty>Документів ще немає — без них приймати не можна</Empty>
              ) : (
                <Table head={['Вид', 'Номер', 'Дійсний до', 'Партій', '']}>
                  {docs.map((d) => (
                    <Row key={`${d.kind}-${d.number}`}>
                      <Cell>{DOC_KINDS[d.kind] ?? d.kind}</Cell>
                      <Cell>
                        <div className="font-semibold">{d.number}</div>
                        {d.issuer && <div className="text-xs text-emerald-800/50">{d.issuer}</div>}
                      </Cell>
                      <Cell>{d.valid_until ? fmtDate(d.valid_until) : 'без строку'}</Cell>
                      <Cell align="right">{d.batches}</Cell>
                      <Cell align="right">
                        {open && d.batches === 1 && (
                          <form action={removeBatchDocument}>
                            <input type="hidden" name="inspection_id" value={doc.id} />
                            <input type="hidden" name="document_id" value={d.id} />
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
          </div>

          <div className="space-y-4">
            {open && (
              <Card title="Документ на всю поставку">
                <p className="mb-3 text-sm text-emerald-800/70">
                  Посвідчення про якість постачальник зазвичай виписує одне на машину. Внесене тут
                  чіпляється до всіх партій акта одразу.
                </p>
                <ActionForm action={addBatchDocument} submitLabel="Додати до всіх позицій">
                  <input type="hidden" name="inspection_id" value={doc.id} />
                  <Field label="Вид документа">
                    <select name="kind" className={inputClass} defaultValue="quality">
                      {Object.entries(DOC_KINDS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Номер">
                    <input name="number" className={inputClass} required />
                  </Field>
                  <Field label="Виданий">
                    <input name="issued_on" type="date" className={inputClass} />
                  </Field>
                  <Field label="Дійсний до" hint="порожньо — без обмеження строку">
                    <input name="valid_until" type="date" className={inputClass} />
                  </Field>
                  <Field label="Ким виданий">
                    <input name="issuer" className={inputClass} defaultValue={doc.supplier ?? ''} />
                  </Field>
                  <Field label="Посилання на скан">
                    <input name="file_url" className={inputClass} placeholder="https://…" />
                  </Field>
                </ActionForm>
              </Card>
            )}

            {open ? (
              <Card title="Закрити акт">
                <p className="mb-3 text-sm text-emerald-800/70">
                  Прийняті позиції стануть доступними виробництву, забраковані лишаться
                  заблокованими. Неперевірені позиції залишаються в карантині: непройдений контроль
                  не є пройденим.
                </p>
                <ActionForm action={completeInspection} submitLabel="Закрити акт">
                  <input type="hidden" name="inspection_id" value={doc.id} />
                  <Field label="Температура в кузові, °C">
                    <input
                      name="transport_temp_c"
                      type="number"
                      step="0.1"
                      defaultValue={doc.transport_temp_c ?? ''}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Автомобіль">
                    <input
                      name="vehicle"
                      defaultValue={doc.vehicle ?? ''}
                      className={inputClass}
                      placeholder="Renault Master, АА 1234 ВС"
                    />
                  </Field>
                  <label className="flex items-center gap-2 text-sm text-emerald-900">
                    <input
                      type="checkbox"
                      name="transport_ok"
                      defaultChecked={doc.transport_ok}
                      className="size-4"
                    />
                    Транспорт чистий, без стороннього запаху
                  </label>
                  <Field label="Примітка">
                    <input name="note" defaultValue={doc.note ?? ''} className={inputClass} />
                  </Field>
                </ActionForm>
                <form action={cancelInspection} className="mt-3">
                  <input type="hidden" name="inspection_id" value={doc.id} />
                  <Button variant="ghost">Скасувати акт</Button>
                </form>
              </Card>
            ) : (
              <Card title="Поставка">
                <dl className="space-y-2 text-sm">
                  {[
                    ['Постачальник', doc.supplier ?? '—'],
                    ['Прихід', doc.purchase_number ?? '—'],
                    ['Автомобіль', doc.vehicle ?? '—'],
                    [
                      'Температура в кузові',
                      doc.transport_temp_c !== null ? `${doc.transport_temp_c} °C` : '—',
                    ],
                    ['Стан транспорту', doc.transport_ok ? 'Придатний' : 'Із зауваженнями'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3">
                      <dt className="text-emerald-800/60">{k}</dt>
                      <dd className="text-right font-medium text-emerald-950">{v}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Друкований акт. Бланк не затверджений нормативно — вимога закону в
          тому, щоб процедура була описана й дотримання підтверджувалося
          записом. Тому тут рівно те, що доводить перевірку: що приймали, за
          якими показниками, яке рішення і хто його ухвалив. */}
      <div className="mx-auto hidden w-full max-w-[210mm] bg-white p-[10mm] text-black print:block">
        <h1 className="mb-1 text-center text-base font-bold uppercase">
          Акт вхідного контролю № {doc.number}
        </h1>
        <p className="mb-4 text-center text-[12px]">від {fmtDate(doc.received_on)}</p>

        <div className="mb-3 space-y-1 text-[11px]">
          <div>
            <span className="text-black/60">Підприємство: </span>
            {doc.entity_name}
          </div>
          <div>
            <span className="text-black/60">Постачальник: </span>
            {doc.supplier ?? '—'}
            {doc.supplier_edrpou ? `, ЄДРПОУ ${doc.supplier_edrpou}` : ''}
            {doc.supplier_approved ? ' (затверджений)' : ''}
          </div>
          <div>
            <span className="text-black/60">Документ приходу: </span>
            {doc.purchase_number ?? '—'}
          </div>
          <div>
            <span className="text-black/60">Транспорт: </span>
            {doc.vehicle ?? '—'}
            {doc.transport_temp_c !== null ? `, температура в кузові ${doc.transport_temp_c} °C` : ''}
            {doc.transport_ok ? ', стан придатний' : ', зі зауваженнями'}
          </div>
        </div>

        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr>
              {[
                '№',
                'Найменування',
                'Партія',
                'К-сть',
                'Придатна до',
                't°',
                'Упаковка',
                'Маркування',
                'Органолептика',
                'Рішення',
              ].map((h) => (
                <th key={h} className="border border-black px-1 py-0.5 text-center font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id}>
                <td className="border border-black px-1 py-0.5 text-center">{i + 1}</td>
                <td className="border border-black px-1 py-0.5">{l.item_name}</td>
                <td className="border border-black px-1 py-0.5">{l.batch_code}</td>
                <td className="border border-black px-1 py-0.5 text-right tabular-nums">
                  {fmtQty(l.qty)} {unitLabel(l.unit)}
                </td>
                <td className="border border-black px-1 py-0.5 text-center">
                  {l.expires_on ? fmtDate(l.expires_on) : '—'}
                </td>
                <td className="border border-black px-1 py-0.5 text-center tabular-nums">
                  {l.temp_c ?? '—'}
                </td>
                {[l.package_ok, l.marking_ok, l.organoleptic_ok].map((v, k) => (
                  <td key={k} className="border border-black px-1 py-0.5 text-center">
                    {v === null ? '—' : v ? 'відп.' : 'ні'}
                  </td>
                ))}
                <td className="border border-black px-1 py-0.5 text-center">
                  {VERDICTS[l.verdict]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {docs.length > 0 && (
          <div className="mt-3 text-[10px]">
            <span className="text-black/60">Документи постачальника: </span>
            {docs
              .map(
                (d) =>
                  `${DOC_KINDS[d.kind] ?? d.kind} № ${d.number}${
                    d.valid_until ? ` (дійсний до ${fmtDate(d.valid_until)})` : ''
                  }`,
              )
              .join('; ')}
          </div>
        )}

        {lines.some((l) => l.corrective_action) && (
          <div className="mt-3 text-[10px]">
            <div className="font-semibold">Виявлені відхилення й коригувальні дії</div>
            {lines
              .filter((l) => l.corrective_action)
              .map((l) => (
                <div key={l.id}>
                  {l.item_name}, партія {l.batch_code}: {l.corrective_action}
                </div>
              ))}
          </div>
        )}

        <div className="mt-8 flex justify-between text-[10px]">
          <div>
            Приймання здійснив: {doc.inspector ?? '________________'}
            {doc.inspector_position ? `, ${doc.inspector_position}` : ''}
            <div className="mt-4">___________________ (підпис)</div>
          </div>
          <div>
            Рішення затвердив
            <div className="mt-4">___________________ (підпис)</div>
          </div>
        </div>
      </div>
    </>
  );
}
