import Link from 'next/link';
import { createWriteOff } from '@/app/actions/writeoffs';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Cell, Empty, Field, inputClass, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { EXPENSE_CATEGORIES, fmtDate, fmtMoney, isoDay } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = {
  draft: 'Чернетка',
  posted: 'Проведено',
  cancelled: 'Скасовано',
};

export default async function WriteOffsPage() {
  const session = await requireRole('warehouse', 'production', 'sales');

  const [docs, warehouses, entities] = await Promise.all([
    query<{
      id: string;
      number: string;
      written_off_on: string | Date;
      status: string;
      category: string;
      reason: string | null;
      so_number: string | null;
      line_count: number;
      cost: number | null;
    }>(
      `select w.id, w.number, w.written_off_on, w.status, w.category, w.reason,
              o.number as so_number,
              (select count(*) from write_off_lines l where l.write_off_id = w.id)::int as line_count,
              (select sum(e.amount_net) from expenses e where e.write_off_id = w.id) as cost
         from write_offs w
         left join sales_orders o on o.id = w.so_id
        where w.legal_entity_id = $1
        order by w.written_off_on desc, w.number desc
        limit 60`,
      [session.eid],
    ),
    query<{ id: string; name: string; kind: string; is_default: boolean }>(
      `select id, name, kind, is_default from warehouses
        where is_active order by is_default desc, code`,
    ),
    query<{ id: string; short_name: string; is_vat_payer: boolean }>(
      `select id, short_name, is_vat_payer from legal_entities where is_active order by short_name`,
    ),
  ]);

  const drafts = docs.filter((d) => d.status === 'draft').length;
  const thisMonth = (isoDay(new Date()) ?? '').slice(0, 7);
  const monthTotal = docs
    .filter((d) => d.status === 'posted' && (isoDay(d.written_off_on) ?? '').slice(0, 7) === thisMonth)
    .reduce((sum, d) => sum + Number(d.cost ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Акти списання"
        subtitle="Псування, зразки, подарунки — зі складу у витрати за обраною статтею"
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Документів" value={String(docs.length)} />
        <Stat
          label="Не проведено"
          value={String(drafts)}
          hint="чернетки чекають проведення"
          tone={drafts > 0 ? 'warn' : 'good'}
        />
        <Stat label="За поточний місяць" value={fmtMoney(monthTotal)} hint="собівартість списаного" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card title="Журнал">
          {docs.length === 0 ? (
            <Empty>Списань ще не було</Empty>
          ) : (
            <Table head={['Документ', 'Стаття', 'Рядків', 'Собівартість', 'Стан']}>
              {docs.map((d) => (
                <Row key={d.id}>
                  <Cell>
                    <Link
                      href={`/writeoffs/${d.id}`}
                      className="font-semibold text-emerald-800 hover:underline"
                    >
                      {d.number}
                    </Link>
                    <div className="text-xs text-emerald-800/50">
                      {fmtDate(d.written_off_on)}
                      {d.so_number ? ` · із замовлення ${d.so_number}` : ''}
                    </div>
                  </Cell>
                  <Cell>
                    {EXPENSE_CATEGORIES[d.category] ?? d.category}
                    {d.reason && <div className="text-xs text-emerald-800/50">{d.reason}</div>}
                  </Cell>
                  <Cell align="right">{d.line_count}</Cell>
                  <Cell align="right">{d.cost != null ? fmtMoney(d.cost) : '—'}</Cell>
                  <Cell>
                    <Badge
                      tone={
                        d.status === 'posted' ? 'green' : d.status === 'cancelled' ? 'gray' : 'amber'
                      }
                    >
                      {STATUS[d.status]}
                    </Badge>
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Новий акт">
            <ActionForm action={createWriteOff} submitLabel="Створити">
              <Field label="Юрособа" hint="від кого оформлюється документ — визначає номер і ПДВ">
                <select name="entity_id" className={inputClass} defaultValue={session.eid}>
                  {entities.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.short_name} · {e.is_vat_payer ? 'з ПДВ' : 'без ПДВ'}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Стаття витрат" hint="куди сума ляже у фінрезультаті">
                <select name="category" required className={inputClass} defaultValue="spoilage">
                  {Object.entries(EXPENSE_CATEGORIES).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Склад" hint="звідки списується">
                <select
                  name="warehouse_id"
                  className={inputClass}
                  // Списують найчастіше готову продукцію — типовий вибір
                  // склад ГП, а не перший за кодом.
                  defaultValue={
                    warehouses.find((w) => w.kind === 'finished' && w.is_default)?.id ??
                    warehouses.find((w) => w.kind === 'finished')?.id ??
                    warehouses.find((w) => w.is_default)?.id ??
                    warehouses[0]?.id ??
                    ''
                  }
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Дата списання">
                <input
                  name="written_off_on"
                  type="date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  className={inputClass}
                />
              </Field>
              <Field label="Причина" hint="потрапить у друкований акт">
                <input name="reason" className={inputClass} placeholder="Пошкоджено при транспортуванні" />
              </Field>
              <Field label="Примітка">
                <input name="note" className={inputClass} />
              </Field>
            </ActionForm>
          </Card>

          <Card title="Коли що використовувати">
            <p className="text-sm text-emerald-800/70">
              <strong>Акт списання</strong> — коли товар зі складу йде не покупцю: зіпсувався,
              роздали на дегустації, відправили блогерам. Собівартість лягає у витрати за статтею
              акта, тож у фінрезультаті видно, скільки з’їв маркетинг, а скільки — псування.
            </p>
            <p className="mt-3 text-sm text-emerald-800/70">
              <strong>Безоплатна відправка</strong> робиться прямо із замовлення клієнта — на його
              сторінці є окрема кнопка: система сама створить відвантаження для ТТН і проведений акт.
            </p>
            <p className="mt-3 text-sm text-emerald-800/70">
              <strong>Інвентаризація</strong> — коли розходження знайшли перерахунком: нестачі й
              надлишки оформлюються там, а не актом.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
