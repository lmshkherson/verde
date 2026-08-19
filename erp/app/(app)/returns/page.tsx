import Link from 'next/link';
import { createReturn } from '@/app/actions/returns';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Cell, Empty, Field, inputClass, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { fmtDate, fmtMoney, RETURN_REASONS, RETURN_STATUS } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function ReturnsPage() {
  const session = await requireRole('sales', 'warehouse');

  const [returns, customers, shipments, month] = await Promise.all([
    query<{
      id: string;
      number: string;
      returned_on: string;
      status: string;
      reason: string;
      customer: string;
      shipment_number: string | null;
      gross: number;
      lines: number;
    }>(
      `select r.id, r.number, r.returned_on, r.status, r.reason,
              c.name as customer, sh.number as shipment_number,
              coalesce(a.gross_amount, 0) as gross,
              (select count(*) from customer_return_lines l where l.return_id = r.id)::int as lines
         from customer_returns r
         join customers c on c.id = r.customer_id
         left join shipments sh on sh.id = r.shipment_id
         left join v_return_amounts a on a.return_id = r.id
        where r.legal_entity_id = $1
        order by r.returned_on desc, r.number desc
        limit 60`,
      [session.eid],
    ),
    query<{ id: string; name: string }>(
      'select id, name from customers where is_active order by name',
    ),
    query<{ id: string; label: string }>(
      `select sh.id, sh.number || ' · ' || c.name || ' · ' || to_char(sh.shipped_on, 'DD.MM.YYYY') as label
         from shipments sh
         join sales_orders o on o.id = sh.so_id
         join customers c on c.id = o.customer_id
        where o.legal_entity_id = $1
        order by sh.shipped_on desc, sh.number desc
        limit 50`,
      [session.eid],
    ),
    query<{ gross: number; cost_lost: number }>(
      `select coalesce(sum(gross_amount), 0) as gross, coalesce(sum(cost_lost), 0) as cost_lost
         from v_return_amounts
        where legal_entity_id = $1
          and returned_on >= date_trunc('month', current_date)`,
      [session.eid],
    ),
  ]);

  return (
    <>
      <PageHeader
        title="Повернення від клієнтів"
        subtitle="Товар назад на склад, дохід і ПДВ — назад у мінус"
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Повернень цього місяця" value={String(returns.filter((r) => r.status === 'accepted').length)} />
        <Stat label="На суму з ПДВ" value={fmtMoney(month[0]?.gross)} tone={Number(month[0]?.gross) > 0 ? 'warn' : 'default'} />
        <Stat
          label="З них непридатне"
          value={fmtMoney(month[0]?.cost_lost)}
          hint="за собівартістю, у втрати"
          tone={Number(month[0]?.cost_lost) > 0 ? 'danger' : 'default'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card title="Журнал">
          {returns.length === 0 ? (
            <Empty>Повернень ще не було</Empty>
          ) : (
            <Table head={['Документ', 'Клієнт', 'Причина', 'Сума з ПДВ', 'Стан']}>
              {returns.map((r) => (
                <Row key={r.id}>
                  <Cell>
                    <Link href={`/returns/${r.id}`} className="font-semibold text-emerald-800 hover:underline">
                      {r.number}
                    </Link>
                    <div className="text-xs text-emerald-800/50">
                      {fmtDate(r.returned_on)}
                      {r.shipment_number ? ` · за ${r.shipment_number}` : ' · без прив’язки'}
                    </div>
                  </Cell>
                  <Cell>{r.customer}</Cell>
                  <Cell>
                    <Badge tone={r.reason === 'surplus' ? 'gray' : 'amber'}>
                      {RETURN_REASONS[r.reason]}
                    </Badge>
                  </Cell>
                  <Cell align="right">{r.status === 'accepted' ? fmtMoney(r.gross) : '—'}</Cell>
                  <Cell>
                    <Badge
                      tone={
                        r.status === 'accepted' ? 'green' : r.status === 'cancelled' ? 'gray' : 'amber'
                      }
                    >
                      {RETURN_STATUS[r.status]}
                    </Badge>
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Нове повернення">
          <p className="mb-3 text-sm text-emerald-800/70">
            Якщо відвантаження відоме — оберіть його: ціна й собівартість підтягнуться самі, а
            повернути більше, ніж везли, система не дасть. Якщо ні — просто вкажіть клієнта.
          </p>
          <ActionForm action={createReturn} submitLabel="Створити">
            <Field label="За відвантаженням" hint="залиште порожнім, якщо накладна невідома">
              <select name="shipment_id" className={inputClass} defaultValue="">
                <option value="">— без прив’язки —</option>
                {shipments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Клієнт" hint="потрібен лише для повернення без прив’язки">
              <select name="customer_id" className={inputClass} defaultValue="">
                <option value="">— оберіть —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Дата">
              <input
                name="returned_on"
                type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
                className={inputClass}
              />
            </Field>
            <Field label="Причина">
              <select name="reason" className={inputClass} defaultValue="surplus">
                {Object.entries(RETURN_REASONS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Примітка">
              <input name="note" className={inputClass} />
            </Field>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
