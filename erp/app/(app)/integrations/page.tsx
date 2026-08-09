import {
  enqueueTaxInvoices,
  requeueOutbox,
  saveIntegrationSettings,
  sendOutbox,
  setOutboxStatus,
} from '@/app/actions/integrations';
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
  PageHeader,
  Row,
  Stat,
  Table,
} from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { OUTBOX_DOC_LABELS, OUTBOX_STATUS_LABELS, PROVIDER_LABELS } from '@/lib/integrations';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const tones: Record<string, 'gray' | 'amber' | 'green' | 'red' | 'blue'> = {
  queued: 'amber',
  sent: 'blue',
  delivered: 'green',
  rejected: 'red',
  failed: 'red',
};

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await requireRole();
  const now = new Date();
  const period =
    (await searchParams).period ??
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [settings, summary, outbox] = await Promise.all([
    queryOne<{
      provider: string;
      export_dir: string | null;
      api_base_url: string | null;
      api_token_env: string | null;
      auto_enqueue: boolean;
    }>(
      `select provider, export_dir, api_base_url, api_token_env, auto_enqueue
         from integration_settings where legal_entity_id = $1`,
      [session.eid],
    ),
    queryOne<{ queued: number; sent: number; delivered: number; rejected: number; failed: number }>(
      'select queued, sent, delivered, rejected, failed from v_outbox_summary where legal_entity_id = $1',
      [session.eid],
    ),
    query<{
      id: string;
      doc_type: string;
      doc_number: string;
      doc_date: string;
      counterparty: string | null;
      file_name: string;
      status: string;
      attempts: number;
      error: string | null;
      sent_at: string | null;
    }>(
      `select id, doc_type, doc_number, doc_date, counterparty, file_name,
              status, attempts, error, sent_at
         from outbox_documents
        where legal_entity_id = $1
        order by queued_at desc limit 80`,
      [session.eid],
    ),
  ]);

  const provider = settings?.provider ?? 'none';
  const tokenPresent = settings?.api_token_env
    ? Boolean(process.env[settings.api_token_env])
    : false;

  return (
    <>
      <PageHeader
        title="Обмін документами"
        subtitle="Черга на M.E.Doc і «Вчасно»: що надіслано, що зареєстровано, що впало"
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="У черзі" value={String(summary?.queued ?? 0)} tone={Number(summary?.queued) > 0 ? 'warn' : 'default'} />
        <Stat label="Надіслано" value={String(summary?.sent ?? 0)} />
        <Stat label="Доставлено" value={String(summary?.delivered ?? 0)} tone="good" />
        <Stat label="Відхилено" value={String(summary?.rejected ?? 0)} tone={Number(summary?.rejected) > 0 ? 'danger' : 'default'} />
        <Stat label="Помилок" value={String(summary?.failed ?? 0)} tone={Number(summary?.failed) > 0 ? 'danger' : 'default'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card
            title="Черга"
            action={
              <div className="flex gap-2">
                <ActionForm action={enqueueTaxInvoices} submitLabel="Поставити ПН і РК у чергу" hideSuccess>
                  <input type="hidden" name="period" value={period} />
                </ActionForm>
                <ActionForm action={sendOutbox} submitLabel="Надіслати" variant="primary">
                  <input type="hidden" name="noop" value="1" />
                </ActionForm>
              </div>
            }
          >
            {outbox.length === 0 ? (
              <Empty>Черга порожня — поставте документи періоду кнопкою вгорі</Empty>
            ) : (
              <Table head={['Документ', 'Контрагент', 'Файл', 'Стан', '']}>
                {outbox.map((o) => (
                  <Row key={o.id}>
                    <Cell>
                      <div className="font-semibold">{o.doc_number}</div>
                      <div className="text-xs text-emerald-800/50">
                        {OUTBOX_DOC_LABELS[o.doc_type] ?? o.doc_type} · {fmtDate(o.doc_date)}
                      </div>
                    </Cell>
                    <Cell>{o.counterparty ?? '—'}</Cell>
                    <Cell className="font-mono text-xs">{o.file_name}</Cell>
                    <Cell>
                      <Badge tone={tones[o.status] ?? 'gray'}>{OUTBOX_STATUS_LABELS[o.status]}</Badge>
                      {o.error && (
                        <div className="mt-0.5 max-w-64 text-xs text-red-600">{o.error}</div>
                      )}
                      {o.sent_at && !o.error && (
                        <div className="text-xs text-emerald-800/50">{fmtDate(o.sent_at)}</div>
                      )}
                    </Cell>
                    <Cell align="right">
                      <div className="flex justify-end gap-1">
                        {o.status === 'sent' && (
                          <form action={setOutboxStatus}>
                            <input type="hidden" name="outbox_id" value={o.id} />
                            <input type="hidden" name="status" value="delivered" />
                            <Button className="!min-h-8 !px-2 text-xs">Зареєстровано</Button>
                          </form>
                        )}
                        {(o.status === 'failed' || o.status === 'rejected') && (
                          <form action={requeueOutbox}>
                            <input type="hidden" name="outbox_id" value={o.id} />
                            <Button variant="ghost" className="!min-h-8 !px-2 text-xs">
                              Повторити
                            </Button>
                          </form>
                        )}
                      </div>
                    </Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Card>

          <Card title="Як це працює">
            <div className="space-y-3 text-sm text-emerald-800/80">
              <p>
                <strong>Тека обміну</strong> — штатний спосіб роботи з M.E.Doc: система кладе
                документ у теку, програма забирає його своїм планувальником. Працює без облікових
                даних і видно очима. Той самий файл можна вручну завантажити у «Вчасно» — назва
                зроблена за їхньою конвенцією, тож контрагент і реквізити підтягнуться самі.
              </p>
              <p>
                <strong>API «Вчасно»</strong> — коли оплачено тариф з інтеграцією. Токен береться зі
                змінної середовища, у базі лежить лише її назва: секрет у базі — це секрет у бекапі
                й у дампі.
              </p>
              <p>
                <strong>Статус «Доставлено» ставиться вручну.</strong> Система знає, що файл
                покладено або прийнято сервісом, але факт реєстрації в ЄРПН приходить квитанцією —
                її поки читає людина.
              </p>
              <p>
                Повторний запуск черги нічого не дублює: один документ може стояти в черзі лише
                раз, і це стереже база, а не обережність користувача.
              </p>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Налаштування каналу">
            {provider === 'none' && (
              <div className="mb-3">
                <Alert tone="amber">Обмін вимкнено — документи в чергу не потраплятимуть.</Alert>
              </div>
            )}
            {provider === 'vchasno' && !tokenPresent && (
              <div className="mb-3">
                <Alert tone="red">
                  Змінна середовища {settings?.api_token_env} порожня — відправка впаде на першому ж
                  документі.
                </Alert>
              </div>
            )}

            <ActionForm action={saveIntegrationSettings} submitLabel="Зберегти">
              <Field label="Канал">
                <select name="provider" className={inputClass} defaultValue={provider}>
                  {Object.entries(PROVIDER_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Тека обміну" hint="куди класти файли для M.E.Doc">
                <input
                  name="export_dir"
                  defaultValue={settings?.export_dir ?? ''}
                  className={inputClass}
                  placeholder="/srv/medoc/in"
                />
              </Field>
              <Field label="Базова адреса API «Вчасно»" hint="звірте з їхньою документацією до тарифу">
                <input
                  name="api_base_url"
                  defaultValue={settings?.api_base_url ?? ''}
                  className={inputClass}
                  placeholder="https://api.vchasno.ua/api/v2"
                />
              </Field>
              <Field label="Змінна середовища з токеном" hint="сам токен у базу не потрапляє">
                <input
                  name="api_token_env"
                  defaultValue={settings?.api_token_env ?? ''}
                  className={inputClass}
                  placeholder="VCHASNO_TOKEN"
                />
              </Field>
              <label className="flex items-center gap-2 py-1">
                <input
                  name="auto_enqueue"
                  type="checkbox"
                  defaultChecked={settings?.auto_enqueue ?? true}
                  className="size-5 accent-emerald-700"
                />
                <span className="text-sm font-semibold text-emerald-900">
                  Ставити нові документи в чергу
                </span>
              </label>
            </ActionForm>
          </Card>

          <Card title="Що поки поза системою">
            <ul className="space-y-2 text-sm text-emerald-800/80">
              <li>
                Читання квитанцій із ЄРПН — статус реєстрації відмічається руками.
              </li>
              <li>
                Накладення КЕП — підпис ставиться в самому M.E.Doc чи «Вчасно».
              </li>
              <li>
                Склад полів у конверті документа зроблено повним, але відповідність схемі ДПС
                звірте перед першим бойовим надсиланням: схеми постачаються разом із M.E.Doc, а
                правиться мапування в одному місці — <code>lib/integrations.ts</code>.
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
