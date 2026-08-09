import { createFixedAsset, runDepreciation } from '@/app/actions/hr';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Cell, Empty, Field, inputClass, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { fmtDate, fmtMoney } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const monthFmt = new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric' });

const DEPARTMENTS: Record<string, string> = {
  production: 'Цех',
  admin: 'Адміністрація',
  sales: 'Збут',
};

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await requireRole();
  const { period } = await searchParams;

  const now = new Date();
  const current = period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const from = `${current}-01`;

  const [assets, run, totals] = await Promise.all([
    query<{
      id: string;
      name: string;
      inventory_no: string | null;
      department: string;
      acquired_on: string;
      cost: number;
      residual_value: number;
      useful_life_months: number;
      useful_life_mgmt: number | null;
      book_value_accounting: number;
      book_value_management: number;
    }>(
      `select a.id, a.name, a.inventory_no, a.department, a.acquired_on, a.cost, a.residual_value,
              a.useful_life_months, a.useful_life_mgmt,
              d.book_value_accounting, d.book_value_management
         from fixed_assets a
         join v_asset_depreciation d on d.asset_id = a.id
        where a.legal_entity_id = $1 and a.is_active
        order by a.acquired_on desc`,
      [session.eid],
    ),
    queryOne<{ accounting: number; management: number; production_accounting: number }>(
      `select accounting, management, production_accounting
         from v_depreciation_totals where legal_entity_id = $1 and period = $2::date`,
      [session.eid, from],
    ),
    queryOne<{ cost: number; book_acc: number; book_mgmt: number }>(
      `select coalesce(sum(a.cost), 0) as cost,
              coalesce(sum(d.book_value_accounting), 0) as book_acc,
              coalesce(sum(d.book_value_management), 0) as book_mgmt
         from fixed_assets a join v_asset_depreciation d on d.asset_id = a.id
        where a.legal_entity_id = $1 and a.is_active`,
      [session.eid],
    ),
  ]);

  return (
    <>
      <PageHeader
        title="Основні засоби"
        subtitle={`${session.ename} · амортизація за ${monthFmt.format(new Date(from))}`}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Первісна вартість" value={fmtMoney(totals?.cost ?? 0)} />
        <Stat label="Залишкова, бухоблік" value={fmtMoney(totals?.book_acc ?? 0)} />
        <Stat label="Залишкова, управлінський" value={fmtMoney(totals?.book_mgmt ?? 0)} />
        <Stat
          label="Амортизація місяця"
          value={fmtMoney(run?.accounting ?? 0)}
          hint={
            run && Math.abs(run.accounting - run.management) > 0.005
              ? `в управлінському ${fmtMoney(run.management)}`
              : 'однакова в обох книгах'
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card title="Об’єкти">
            {assets.length === 0 ? (
              <Empty>Основних засобів ще не заведено</Empty>
            ) : (
              <Table head={['Об’єкт', 'Підрозділ', 'Первісна', 'Строк (бух / упр)', 'Залишкова бух', 'Залишкова упр']}>
                {assets.map((a) => (
                  <Row key={a.id}>
                    <Cell>
                      <div className="font-semibold">{a.name}</div>
                      <div className="text-xs text-emerald-800/50">
                        {a.inventory_no ? `№ ${a.inventory_no} · ` : ''}
                        від {fmtDate(a.acquired_on)}
                      </div>
                    </Cell>
                    <Cell>
                      <Badge tone={a.department === 'production' ? 'amber' : 'gray'}>
                        {DEPARTMENTS[a.department]}
                      </Badge>
                    </Cell>
                    <Cell align="right">{fmtMoney(a.cost)}</Cell>
                    <Cell align="right">
                      {a.useful_life_months} міс.
                      {a.useful_life_mgmt && a.useful_life_mgmt !== a.useful_life_months && (
                        <div className="text-xs text-amber-600">упр. {a.useful_life_mgmt} міс.</div>
                      )}
                    </Cell>
                    <Cell align="right">{fmtMoney(a.book_value_accounting)}</Cell>
                    <Cell align="right" className="font-semibold">
                      {fmtMoney(a.book_value_management)}
                    </Cell>
                  </Row>
                ))}
              </Table>
            )}
            <p className="mt-4 text-xs text-emerald-800/60">
              Різні строки корисного використання — класична точка розбіжності між обліками.
              Бухгалтерія часто тримає податковий мінімум, а управлінський облік — реальний строк
              служби обладнання. Тоді щомісячні суми різні, і в журналі з’являються дві проводки
              замість однієї.
            </p>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Нарахувати амортизацію">
            <p className="mb-3 text-sm text-emerald-800/70">
              Прямолінійний метод: вартість, що амортизується, ділиться на строк. Нарахування
              зупиняється, коли вартість вичерпана.
            </p>
            <ActionForm action={runDepreciation} submitLabel="Нарахувати за місяць">
              <input type="hidden" name="period" value={current} />
            </ActionForm>
          </Card>

          <Card title="Новий об’єкт">
            <ActionForm action={createFixedAsset} submitLabel="Додати">
              <Field label="Назва">
                <input name="name" required className={inputClass} placeholder="Лінія формування батончиків" />
              </Field>
              <Field label="Інвентарний номер">
                <input name="inventory_no" className={inputClass} />
              </Field>
              <Field label="Підрозділ">
                <select name="department" required className={inputClass} defaultValue="production">
                  {Object.entries(DEPARTMENTS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Дата введення">
                <input
                  name="acquired_on"
                  type="date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  className={inputClass}
                />
              </Field>
              <Field label="Первісна вартість">
                <input name="cost" type="number" step="0.01" min="0" required className={inputClass} />
              </Field>
              <Field label="Ліквідаційна вартість">
                <input name="residual_value" type="number" step="0.01" min="0" defaultValue="0" className={inputClass} />
              </Field>
              <Field label="Строк, міс. — бухоблік">
                <input name="useful_life_months" type="number" min="1" required className={inputClass} />
              </Field>
              <Field label="Строк, міс. — управлінський" hint="Порожньо — той самий, що й у бухобліку">
                <input name="useful_life_mgmt" type="number" min="1" className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
