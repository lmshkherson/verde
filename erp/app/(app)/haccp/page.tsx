import { logHaccp, saveHaccpPoint } from '@/app/actions/haccp';
import { ActionForm } from '@/components/action-form';
import { PrintButton } from '@/components/print-button';
import {
  Badge,
  Card,
  Cell,
  Empty,
  Field,
  PageHeader,
  Row,
  Stat,
  Table,
  inputClass,
} from '@/components/ui';
import { query } from '@/lib/db';
import { fmtDateTime } from '@/lib/format';
import { HACCP_KINDS, HACCP_STAGES, isOverdue, isQualitative, limitsLabel } from '@/lib/quality';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

interface Point {
  id: string;
  code: string;
  name: string;
  kind: string;
  stage: string;
  parameter: string;
  unit: string | null;
  limit_min: number | null;
  limit_max: number | null;
  frequency: string | null;
  max_gap_hours: number | null;
  monitoring: string | null;
  corrective_action: string | null;
  verification: string | null;
  auto_source: string | null;
  last_at: string | null;
  logs_30: number;
  deviations_30: number;
}

export default async function HaccpPage() {
  const session = await requireRole('production', 'warehouse');

  const [points, logs] = await Promise.all([
    query<Point>(
      `select p.*, s.last_at, s.logs_30, s.deviations_30
         from haccp_points p
         join v_haccp_status s on s.point_id = p.id
        where p.is_active
        order by p.kind, p.code`,
    ),
    query<{
      id: string;
      logged_at: string;
      code: string;
      point_name: string;
      unit: string | null;
      value: number | null;
      is_ok: boolean;
      corrective_action: string | null;
      note: string | null;
      source: string;
      user_name: string | null;
      batch_code: string | null;
      item_name: string | null;
    }>(
      `select l.id, l.logged_at, p.code, p.name as point_name, p.unit, l.value, l.is_ok,
              l.corrective_action, l.note, l.source,
              u.full_name as user_name, b.code as batch_code, i.name as item_name
         from haccp_logs l
         join haccp_points p on p.id = l.point_id
         left join app_users u on u.id = l.user_id
         left join batches b on b.id = l.batch_id
         left join items i on i.id = b.item_id
        where l.legal_entity_id = $1
        order by l.logged_at desc
        limit 80`,
      [session.eid],
    ),
  ]);

  const overdue = points.filter((p) => isOverdue(p, p.last_at));
  const deviations = logs.filter((l) => !l.is_ok);

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="HACCP"
          subtitle="Точки контролю, журнал моніторингу й коригувальні дії"
          action={<PrintButton label="Друк журналу" />}
        />

        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Точок у плані" value={String(points.length)} />
          <Stat
            label="ККТ"
            value={String(points.filter((p) => p.kind === 'ccp').length)}
            hint="критичні контрольні точки"
          />
          <Stat
            label="Прострочений моніторинг"
            value={String(overdue.length)}
            hint="запис не зроблено вчасно"
            tone={overdue.length > 0 ? 'danger' : 'good'}
          />
          <Stat
            label="Відхилень за 30 днів"
            value={String(points.reduce((s, p) => s + Number(p.deviations_30), 0))}
            tone={deviations.length > 0 ? 'warn' : 'good'}
          />
        </div>

        <div className="space-y-4">
          {points.length === 0 ? (
            <Card title="План HACCP">
              <Empty>Точок контролю ще немає</Empty>
            </Card>
          ) : (
            points.map((p) => {
              const late = isOverdue(p, p.last_at);
              const qualitative = isQualitative(p);

              return (
                <Card
                  key={p.id}
                  title={`${p.code} · ${p.name}`}
                  action={
                    <div className="flex items-center gap-2">
                      <Badge tone={p.kind === 'ccp' ? 'red' : p.kind === 'oprp' ? 'amber' : 'gray'}>
                        {HACCP_KINDS[p.kind]}
                      </Badge>
                      <Badge tone="blue">{HACCP_STAGES[p.stage]}</Badge>
                      {late && <Badge tone="red">прострочено</Badge>}
                    </div>
                  }
                >
                  <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                    <div className="space-y-2 text-sm text-emerald-800/80">
                      <div>
                        <span className="text-emerald-800/60">Показник: </span>
                        {p.parameter} — {limitsLabel(p)}
                      </div>
                      {p.frequency && (
                        <div>
                          <span className="text-emerald-800/60">Періодичність: </span>
                          {p.frequency}
                        </div>
                      )}
                      {p.monitoring && (
                        <div>
                          <span className="text-emerald-800/60">Моніторинг: </span>
                          {p.monitoring}
                        </div>
                      )}
                      {p.corrective_action && (
                        <div>
                          <span className="text-emerald-800/60">Дія при відхиленні: </span>
                          {p.corrective_action}
                        </div>
                      )}
                      {p.verification && (
                        <div>
                          <span className="text-emerald-800/60">Перевірка: </span>
                          {p.verification}
                        </div>
                      )}
                      <div className="text-xs">
                        <span className="text-emerald-800/60">Останній запис: </span>
                        {p.last_at ? fmtDateTime(p.last_at) : 'записів немає'}
                        {' · '}
                        за 30 днів записів {p.logs_30}, відхилень {p.deviations_30}
                      </div>
                      {p.auto_source && (
                        <div className="text-xs text-emerald-800/60">
                          Заповнюється автоматично з{' '}
                          {p.auto_source === 'incoming' ? 'акта вхідного контролю' : 'реквізитів ТТН'}
                          .
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl bg-emerald-50/60 p-3" data-point={p.code}>
                      <ActionForm action={logHaccp} submitLabel="Записати" variant="ghost">
                        <input type="hidden" name="point_id" value={p.id} />
                        {qualitative ? (
                          <label className="flex items-center gap-2 text-sm text-emerald-900">
                            <input type="checkbox" name="is_ok" defaultChecked className="size-4" />
                            Відповідає вимогам
                          </label>
                        ) : (
                          <Field label={`Виміряно${p.unit ? `, ${p.unit}` : ''}`}>
                            <input name="value" type="number" step="0.01" className={inputClass} />
                          </Field>
                        )}
                        <Field label="Коригувальна дія" hint="потрібна лише при відхиленні">
                          <input name="corrective_action" className={inputClass} />
                        </Field>
                        <Field label="Примітка">
                          <input name="note" className={inputClass} />
                        </Field>
                      </ActionForm>
                    </div>
                  </div>
                </Card>
              );
            })
          )}

          {deviations.length > 0 && (
            <Card title="Відхилення">
              <Table head={['Коли', 'Точка', 'Значення', 'Коригувальна дія']}>
                {deviations.map((l) => (
                  <Row key={l.id}>
                    <Cell>{fmtDateTime(l.logged_at)}</Cell>
                    <Cell>
                      <div className="font-semibold">{l.code}</div>
                      <div className="text-xs text-emerald-800/50">{l.point_name}</div>
                    </Cell>
                    <Cell align="right" className="font-semibold text-red-600">
                      {l.value !== null ? `${l.value} ${l.unit ?? ''}` : 'не відповідає'}
                    </Cell>
                    <Cell>{l.corrective_action}</Cell>
                  </Row>
                ))}
              </Table>
            </Card>
          )}

          <Card title="Журнал моніторингу">
            {logs.length === 0 ? (
              <Empty>Записів ще немає</Empty>
            ) : (
              <Table head={['Коли', 'Точка', 'Значення', 'Стан', 'Хто', 'Примітка']}>
                {logs.map((l) => (
                  <Row key={l.id}>
                    <Cell>{fmtDateTime(l.logged_at)}</Cell>
                    <Cell>
                      <div className="font-semibold">{l.code}</div>
                      {l.batch_code && (
                        <div className="text-xs text-emerald-800/50">
                          {l.item_name} · {l.batch_code}
                        </div>
                      )}
                    </Cell>
                    <Cell align="right">
                      {l.value !== null ? `${l.value} ${l.unit ?? ''}` : '—'}
                    </Cell>
                    <Cell>
                      <Badge tone={l.is_ok ? 'green' : 'red'}>
                        {l.is_ok ? 'у межах' : 'відхилення'}
                      </Badge>
                    </Cell>
                    <Cell>
                      <div className="text-xs">{l.user_name ?? '—'}</div>
                      {l.source !== 'manual' && (
                        <div className="text-xs text-emerald-800/50">
                          {l.source === 'incoming' ? 'з акта' : 'з ТТН'}
                        </div>
                      )}
                    </Cell>
                    <Cell>
                      <div className="text-xs">{l.corrective_action ?? l.note ?? ''}</div>
                    </Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Card>

          <Card title="Нова точка контролю">
            <p className="mb-3 text-sm text-emerald-800/70">
              Точки беруться з плану HACCP, а не вигадуються тут. Порожні межі означають якісний
              контроль — «відповідає / ні». «Гранична пауза» — скільки годин допустимо без запису:
              за нею система показує, що журнал не ведеться.
            </p>
            <ActionForm action={saveHaccpPoint} submitLabel="Додати точку">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Код">
                  <input name="code" className={inputClass} placeholder="ККТ-2" required />
                </Field>
                <Field label="Назва">
                  <input name="name" className={inputClass} required />
                </Field>
                <Field label="Тип">
                  <select name="kind" className={inputClass} defaultValue="ccp">
                    {Object.entries(HACCP_KINDS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Етап">
                  <select name="stage" className={inputClass} defaultValue="production">
                    {Object.entries(HACCP_STAGES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Що вимірюємо">
                  <input name="parameter" className={inputClass} required />
                </Field>
                <Field label="Одиниця">
                  <input name="unit" className={inputClass} placeholder="°C" />
                </Field>
                <Field label="Межа знизу">
                  <input name="limit_min" type="number" step="0.01" className={inputClass} />
                </Field>
                <Field label="Межа зверху">
                  <input name="limit_max" type="number" step="0.01" className={inputClass} />
                </Field>
                <Field label="Періодичність">
                  <input name="frequency" className={inputClass} placeholder="щозміни" />
                </Field>
                <Field label="Гранична пауза, год">
                  <input name="max_gap_hours" type="number" className={inputClass} />
                </Field>
              </div>
              <Field label="Як контролюємо">
                <input name="monitoring" className={inputClass} />
              </Field>
              <Field label="Дія при відхиленні">
                <input name="corrective_action" className={inputClass} />
              </Field>
              <Field label="Перевірка">
                <input name="verification" className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
        </div>
      </div>

      {/* Друкований журнал: те, що просить перевірка — записи з підписом
          відповідального й видимими відхиленнями. */}
      <div className="mx-auto hidden w-full max-w-[210mm] bg-white p-[10mm] text-black print:block">
        <h1 className="mb-4 text-center text-base font-bold uppercase">
          Журнал моніторингу критичних контрольних точок
        </h1>
        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr>
              {['Дата й час', 'Код', 'Точка контролю', 'Значення', 'Стан', 'Коригувальна дія', 'Відповідальний'].map(
                (h) => (
                  <th key={h} className="border border-black px-1 py-0.5 text-center font-semibold">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="border border-black px-1 py-0.5">{fmtDateTime(l.logged_at)}</td>
                <td className="border border-black px-1 py-0.5">{l.code}</td>
                <td className="border border-black px-1 py-0.5">{l.point_name}</td>
                <td className="border border-black px-1 py-0.5 text-right tabular-nums">
                  {l.value !== null ? `${l.value} ${l.unit ?? ''}` : '—'}
                </td>
                <td className="border border-black px-1 py-0.5 text-center">
                  {l.is_ok ? 'у межах' : 'відхилення'}
                </td>
                <td className="border border-black px-1 py-0.5">{l.corrective_action ?? ''}</td>
                <td className="border border-black px-1 py-0.5">{l.user_name ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-8 text-[10px]">
          Відповідальний за систему НАССР ___________________ (підпис)
        </div>
      </div>
    </>
  );
}
