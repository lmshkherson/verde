import { saveWarehouse, setWarehouseActive } from '@/app/actions/stock';
import { ActionForm } from '@/components/action-form';
import {
  Badge,
  Card,
  Cell,
  Empty,
  Field,
  LinkButton,
  PageHeader,
  Row,
  Table,
  inputClass,
} from '@/components/ui';
import { query } from '@/lib/db';
import { fmtMoney, fmtQty } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const KINDS: Record<string, string> = {
  raw: 'Сировина',
  wip: 'Незавершене (цех)',
  finished: 'Готова продукція',
};

export default async function WarehousesPage() {
  const session = await requireRole('warehouse');

  const warehouses = await query<{
    id: string;
    code: string;
    name: string;
    kind: string;
    address: string | null;
    note: string | null;
    is_default: boolean;
    is_active: boolean;
    qty: number;
    value: number;
  }>(
    `select w.*, coalesce(s.qty, 0) as qty, coalesce(s.value, 0) as value
       from warehouses w
       left join lateral (
         select sum(m.qty) as qty, sum(m.qty * m.unit_cost) as value
           from stock_moves m
          where m.warehouse_id = w.id and m.legal_entity_id = $1
       ) s on true
      order by w.is_active desc, w.kind, w.code`,
    [session.eid],
  );

  return (
    <>
      <PageHeader
        title="Склади"
        subtitle="Тип складу визначає, куди документи оприбутковують і звідки списують"
        action={<LinkButton href="/stock">← До складу</LinkButton>}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card title="Довідник">
          {warehouses.length === 0 ? (
            <Empty>Складів немає</Empty>
          ) : (
            <Table head={['Склад', 'Тип', 'Залишок (поточна юрособа)', 'Стан', '']}>
              {warehouses.map((w) => (
                <Row key={w.id}>
                  <Cell>
                    <div className="font-semibold">
                      {w.name} <span className="text-xs font-normal text-emerald-800/50">{w.code}</span>
                    </div>
                    {w.address && <div className="text-xs text-emerald-800/50">{w.address}</div>}
                  </Cell>
                  <Cell>
                    <Badge tone={w.kind === 'raw' ? 'amber' : w.kind === 'finished' ? 'green' : 'gray'}>
                      {KINDS[w.kind]}
                    </Badge>
                    {w.is_default && (
                      <div className="mt-1 text-xs text-emerald-800/60">типовий</div>
                    )}
                  </Cell>
                  <Cell align="right">
                    {fmtQty(w.qty)}
                    <div className="text-xs text-emerald-800/50">{fmtMoney(w.value)}</div>
                  </Cell>
                  <Cell>
                    <Badge tone={w.is_active ? 'green' : 'gray'}>
                      {w.is_active ? 'Активний' : 'Деактивований'}
                    </Badge>
                  </Cell>
                  <Cell align="right">
                    <ActionForm
                      action={setWarehouseActive}
                      submitLabel={w.is_active ? 'Деактивувати' : 'Активувати'}
                      variant="ghost"
                      hideSuccess
                    >
                      <input type="hidden" name="warehouse_id" value={w.id} />
                      <input type="hidden" name="active" value={String(!w.is_active)} />
                    </ActionForm>
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Новий склад">
          <p className="mb-3 text-sm text-emerald-800/70">
            Тип визначає роль: виробництво списує сировину з типового складу сировини й випускає
            продукцію на типовий склад ГП. У надходженні склад можна обрати вручну.
          </p>
          <ActionForm action={saveWarehouse} submitLabel="Додати склад">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Код">
                <input name="code" className={inputClass} placeholder="MOROZ" required />
              </Field>
              <Field label="Тип">
                <select name="kind" className={inputClass} defaultValue="raw">
                  {Object.entries(KINDS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Назва">
              <input name="name" className={inputClass} placeholder="Морозильна камера" required />
            </Field>
            <Field label="Адреса" hint="потрапляє в ТТН як пункт навантаження">
              <input name="address" className={inputClass} />
            </Field>
            <Field label="Примітка">
              <input name="note" className={inputClass} />
            </Field>
            <label className="flex items-center gap-2 py-1">
              <input name="is_default" type="checkbox" className="size-5 accent-emerald-700" />
              <span className="text-sm font-semibold text-emerald-900">
                Зробити типовим для свого типу
              </span>
            </label>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
