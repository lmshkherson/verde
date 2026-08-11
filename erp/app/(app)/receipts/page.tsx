import Link from 'next/link';
import { createReceipt } from '@/app/actions/receipts';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Cell, Empty, Field, inputClass, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { fmtDate, fmtMoney, isoDay } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = {
  draft: 'Чернетка',
  posted: 'Проведено',
  cancelled: 'Скасовано',
};

export default async function ReceiptsPage() {
  const session = await requireRole('warehouse');

  const [docs, suppliers, warehouses, entities] = await Promise.all([
    query<{
      id: string;
      number: string;
      received_on: string | Date;
      status: string;
      supplier: string;
      supplier_doc_number: string | null;
      gross_amount: number;
      goods_lines: number;
      service_lines: number;
    }>(
      `select r.id, r.number, r.received_on, r.status, s.name as supplier,
              r.supplier_doc_number, a.gross_amount, a.goods_lines, a.service_lines
         from receipts r
         join suppliers s on s.id = r.supplier_id
         join v_receipt_amounts a on a.receipt_id = r.id
        where r.legal_entity_id = $1
        order by r.received_on desc, r.number desc
        limit 60`,
      [session.eid],
    ),
    query<{ id: string; name: string }>(
      'select id, name from suppliers where is_active order by name',
    ),
    query<{ id: string; name: string; is_default: boolean }>(
      `select id, name, is_default from warehouses
        where is_active order by is_default desc, code`,
    ),
    query<{ id: string; short_name: string; is_vat_payer: boolean }>(
      `select id, short_name, is_vat_payer from legal_entities where is_active order by short_name`,
    ),
  ]);

  const drafts = docs.filter((d) => d.status === 'draft').length;
  const thisMonth = (isoDay(new Date()) ?? '').slice(0, 7);
  const monthTotal = docs
    // Драйвер віддає колонку date об'єктом Date, тож порівнюємо через isoDay,
    // а не рядковими операціями над ним.
    .filter((d) => d.status === 'posted' && (isoDay(d.received_on) ?? '').slice(0, 7) === thisMonth)
    .reduce((sum, d) => sum + Number(d.gross_amount), 0);

  return (
    <>
      <PageHeader
        title="Надходження"
        subtitle="Прихід товару й послуг без заявки — від документа постачальника"
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Документів" value={String(docs.length)} />
        <Stat
          label="Не проведено"
          value={String(drafts)}
          hint="чернетки чекають перевірки"
          tone={drafts > 0 ? 'warn' : 'good'}
        />
        <Stat label="За поточний місяць" value={fmtMoney(monthTotal)} hint="з ПДВ" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card title="Журнал">
          {docs.length === 0 ? (
            <Empty>Надходжень ще не було</Empty>
          ) : (
            <Table head={['Документ', 'Постачальник', 'Склад', 'Сума з ПДВ', 'Стан']}>
              {docs.map((d) => (
                <Row key={d.id}>
                  <Cell>
                    <Link
                      href={`/receipts/${d.id}`}
                      className="font-semibold text-emerald-800 hover:underline"
                    >
                      {d.number}
                    </Link>
                    <div className="text-xs text-emerald-800/50">
                      {fmtDate(d.received_on)}
                      {d.supplier_doc_number ? ` · їх № ${d.supplier_doc_number}` : ''}
                    </div>
                  </Cell>
                  <Cell>{d.supplier}</Cell>
                  <Cell>
                    <div className="text-xs text-emerald-800/60">
                      {d.goods_lines > 0 && `товар: ${d.goods_lines}`}
                      {d.goods_lines > 0 && d.service_lines > 0 && ' · '}
                      {d.service_lines > 0 && `послуги: ${d.service_lines}`}
                      {d.goods_lines === 0 && d.service_lines === 0 && 'порожній'}
                    </div>
                  </Cell>
                  <Cell align="right">{fmtMoney(d.gross_amount)}</Cell>
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
          <Card title="Нове надходження">
            {suppliers.length === 0 ? (
              <Empty>Спершу додайте постачальника</Empty>
            ) : (
              <ActionForm action={createReceipt} submitLabel="Створити">
                <Field label="Юрособа" hint="від кого оформлюється документ — визначає номер і ПДВ">
                  <select name="entity_id" className={inputClass} defaultValue={session.eid}>
                    {entities.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.short_name} · {e.is_vat_payer ? 'з ПДВ' : 'без ПДВ'}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Постачальник">
                  <select name="supplier_id" required className={inputClass} defaultValue="">
                    <option value="" disabled>
                      Оберіть постачальника…
                    </option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Склад" hint="куди оприбутковується товар">
                  <select
                    name="warehouse_id"
                    className={inputClass}
                    defaultValue={warehouses.find((w) => w.is_default)?.id ?? warehouses[0]?.id ?? ''}
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Дата надходження">
                  <input
                    name="received_on"
                    type="date"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    className={inputClass}
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Номер їх документа" hint="накладна або акт">
                    <input name="supplier_doc_number" className={inputClass} />
                  </Field>
                  <Field label="Дата їх документа">
                    <input name="supplier_doc_date" type="date" className={inputClass} />
                  </Field>
                </div>
                <label className="flex items-center gap-2 py-1">
                  <input
                    name="prices_include_vat"
                    type="checkbox"
                    defaultChecked
                    className="size-5 accent-emerald-700"
                  />
                  <span className="text-sm font-semibold text-emerald-900">Ціни вказані з ПДВ</span>
                </label>
                <Field label="Примітка">
                  <input name="note" className={inputClass} />
                </Field>
              </ActionForm>
            )}
          </Card>

          <Card title="Коли що використовувати">
            <p className="text-sm text-emerald-800/70">
              <strong>Надходження</strong> — коли товар чи послуга вже приїхали, а заявки в системі
              не було: послуги, разові закупівлі, придбання за готівку.
            </p>
            <p className="mt-3 text-sm text-emerald-800/70">
              <strong>Заявка</strong> на сторінці «Закупівлі» — коли поставку замовляють наперед. Вона
              стежить за недопоставками: видно, що замовили 200 кг, а приїхало 180.
            </p>
            <p className="mt-3 text-sm text-emerald-800/70">
              В обліку різниці немає — проводки, ПДВ і кредиторка однакові.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
