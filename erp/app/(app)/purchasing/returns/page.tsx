import Link from 'next/link';
import { createSupplierReturn } from '@/app/actions/supplier-returns';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Cell, Empty, Field, inputClass, LinkButton, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { fmtDate, fmtMoney, RETURN_STATUS, SUPPLIER_RETURN_REASONS } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function SupplierReturnsPage() {
  const session = await requireRole('warehouse');

  const [returns, suppliers, orders, month] = await Promise.all([
    query<{
      id: string;
      number: string;
      returned_on: string;
      status: string;
      reason: string;
      supplier: string;
      po_number: string | null;
      gross: number;
    }>(
      `select r.id, r.number, r.returned_on, r.status, r.reason,
              s.name as supplier, p.number as po_number,
              coalesce(a.gross_amount, 0) as gross
         from supplier_returns r
         join suppliers s on s.id = r.supplier_id
         left join purchase_orders p on p.id = r.po_id
         left join v_supplier_return_amounts a on a.return_id = r.id
        where r.legal_entity_id = $1
        order by r.returned_on desc, r.number desc
        limit 60`,
      [session.eid],
    ),
    query<{ id: string; name: string }>(
      'select id, name from suppliers where is_active order by name',
    ),
    query<{ id: string; label: string }>(
      `select p.id, p.number || ' · ' || s.name || ' · ' || to_char(p.ordered_on, 'DD.MM.YYYY') as label
         from purchase_orders p
         join suppliers s on s.id = p.supplier_id
        where p.legal_entity_id = $1 and p.status in ('ordered','received')
        order by p.ordered_on desc, p.number desc
        limit 50`,
      [session.eid],
    ),
    query<{ gross: number; vat: number }>(
      `select coalesce(sum(gross_amount), 0) as gross, coalesce(sum(vat_amount), 0) as vat
         from v_supplier_return_amounts
        where legal_entity_id = $1 and returned_on >= date_trunc('month', current_date)`,
      [session.eid],
    ),
  ]);

  return (
    <>
      <PageHeader
        title="Повернення постачальникам"
        subtitle="Товар назад йому, кредиторка й податковий кредит — у мінус"
        action={<LinkButton href="/purchasing">← До закупівель</LinkButton>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat
          label="Повернень цього місяця"
          value={String(returns.filter((r) => r.status === 'accepted').length)}
        />
        <Stat label="На суму з ПДВ" value={fmtMoney(month[0]?.gross)} />
        <Stat label="Знято кредиту" value={fmtMoney(month[0]?.vat)} hint="сторно ПДВ" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card title="Журнал">
          {returns.length === 0 ? (
            <Empty>Повернень ще не було</Empty>
          ) : (
            <Table head={['Документ', 'Постачальник', 'Причина', 'Сума з ПДВ', 'Стан']}>
              {returns.map((r) => (
                <Row key={r.id}>
                  <Cell>
                    <Link
                      href={`/purchasing/returns/${r.id}`}
                      className="font-semibold text-emerald-800 hover:underline"
                    >
                      {r.number}
                    </Link>
                    <div className="text-xs text-emerald-800/50">
                      {fmtDate(r.returned_on)}
                      {r.po_number ? ` · за ${r.po_number}` : ' · без прив’язки'}
                    </div>
                  </Cell>
                  <Cell>{r.supplier}</Cell>
                  <Cell>
                    <Badge tone={r.reason === 'quality' ? 'red' : 'amber'}>
                      {SUPPLIER_RETURN_REASONS[r.reason]}
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
            За заявкою повертаються саме її партії, а віддати більше, ніж отримали, система не
            дасть. Без прив’язки товар списується за FEFO — з найближчим терміном.
          </p>
          <ActionForm action={createSupplierReturn} submitLabel="Створити">
            <Field label="За заявкою" hint="залиште порожнім, якщо партія стара">
              <select name="po_id" className={inputClass} defaultValue="">
                <option value="">— без прив’язки —</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Постачальник" hint="потрібен лише без прив’язки до заявки">
              <select name="supplier_id" className={inputClass} defaultValue="">
                <option value="">— оберіть —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
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
              <select name="reason" className={inputClass} defaultValue="quality">
                {Object.entries(SUPPLIER_RETURN_REASONS).map(([key, label]) => (
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
