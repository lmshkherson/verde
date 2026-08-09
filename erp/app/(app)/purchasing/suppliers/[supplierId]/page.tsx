import Link from 'next/link';
import { notFound } from 'next/navigation';
import { setSupplierActive, updateSupplier } from '@/app/actions/purchasing';
import { ActionForm } from '@/components/action-form';
import { Alert, Badge, Card, Cell, Empty, Field, inputClass, LinkButton, PageHeader, Row, Table } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { fmtDate, fmtMoney, isoDay, PO_STATUS } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function SupplierEditPage({
  params,
}: {
  params: Promise<{ supplierId: string }>;
}) {
  const session = await requireRole('warehouse');
  const { supplierId } = await params;

  const supplier = await queryOne<{
    id: string;
    name: string;
    edrpou: string | null;
    contact: string | null;
    phone: string | null;
    payment_terms_days: number;
    is_vat_payer: boolean;
    note: string | null;
    is_active: boolean;
    is_approved: boolean;
    approved_on: string | Date | null;
    approved_until: string | Date | null;
    approval_note: string | null;
    total_due: number;
  }>(
    `select s.*,
            coalesce((select sum(b.balance_due) from v_supplier_balance b
                       where b.supplier_id = s.id), 0) as total_due
       from suppliers s where s.id = $1`,
    [supplierId],
  );
  if (!supplier) notFound();

  const [balances, orders] = await Promise.all([
    query<{ entity: string; billed_gross: number; paid_amount: number; balance_due: number }>(
      `select e.short_name as entity, b.billed_gross, b.paid_amount, b.balance_due
         from v_supplier_balance b join legal_entities e on e.id = b.legal_entity_id
        where b.supplier_id = $1
        order by e.short_name`,
      [supplierId],
    ),
    query<{ id: string; number: string; ordered_on: string; status: string; gross: number }>(
      `select p.id, p.number, p.ordered_on, p.status, coalesce(a.gross_amount, 0) as gross
         from purchase_orders p
         left join v_po_amounts a on a.po_id = p.id
        where p.supplier_id = $1 and p.legal_entity_id = $2
        order by p.ordered_on desc, p.number desc
        limit 15`,
      [supplierId, session.eid],
    ),
  ]);

  return (
    <>
      <PageHeader
        title={supplier.name}
        subtitle={supplier.is_vat_payer ? 'Платник ПДВ' : 'Не платник ПДВ'}
        action={<LinkButton href="/purchasing/suppliers">← До постачальників</LinkButton>}
      />

      {!supplier.is_active && (
        <div className="mb-4">
          <Alert tone="amber">
            Постачальник деактивований: нові заявки на нього оформити не можна, історія збережена.
          </Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card title="Редагування">
            <ActionForm action={updateSupplier} submitLabel="Зберегти">
              <input type="hidden" name="supplier_id" value={supplier.id} />
              <Field label="Назва">
                <input name="name" required defaultValue={supplier.name} className={inputClass} />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="ЄДРПОУ / РНОКПП">
                  <input name="edrpou" defaultValue={supplier.edrpou ?? ''} className={inputClass} />
                </Field>
                <Field label="Відтермінування оплати, дн.">
                  <input
                    name="payment_terms_days"
                    type="number"
                    min="0"
                    defaultValue={supplier.payment_terms_days}
                    className={inputClass}
                  />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Контактна особа">
                  <input name="contact" defaultValue={supplier.contact ?? ''} className={inputClass} />
                </Field>
                <Field label="Телефон">
                  <input name="phone" defaultValue={supplier.phone ?? ''} className={inputClass} />
                </Field>
              </div>

              <label className="flex items-center gap-2 py-1">
                <input
                  name="is_vat_payer"
                  type="checkbox"
                  defaultChecked={supplier.is_vat_payer}
                  className="size-5 accent-emerald-700"
                />
                <span className="text-sm font-semibold text-emerald-900">Платник ПДВ</span>
              </label>
              <p className="text-sm text-emerald-800/70">
                Статус впливає лише на нові приходи: у вже оприбуткованих партіях собівартість і
                податковий кредит порахувалися за статусом на дату документа.
              </p>

              <div className="rounded-xl border border-emerald-900/10 p-3">
                <label className="flex items-center gap-2">
                  <input
                    name="is_approved"
                    type="checkbox"
                    defaultChecked={supplier.is_approved}
                    className="size-5 accent-emerald-700"
                  />
                  <span className="text-sm font-semibold text-emerald-900">
                    Затверджений постачальник
                  </span>
                </label>
                <p className="mt-1 text-sm text-emerald-800/70">
                  Приймати сировину дозволено лише від затверджених: це передумова системи НАССР.
                  Поки прапорця немає, акт вхідного контролю не дасть прийняти партію.
                  {supplier.approved_on
                    ? ` Затверджено ${fmtDate(supplier.approved_on)}.`
                    : ''}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Затвердження дійсне до" hint="порожньо — без перегляду">
                    <input
                      name="approved_until"
                      type="date"
                      defaultValue={isoDay(supplier.approved_until) ?? ''}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Підстава оцінки">
                    <input
                      name="approval_note"
                      defaultValue={supplier.approval_note ?? ''}
                      className={inputClass}
                      placeholder="Аудит 12.03.2026, сертифікат ISO 22000"
                    />
                  </Field>
                </div>
              </div>

              <Field label="Примітка">
                <input name="note" defaultValue={supplier.note ?? ''} className={inputClass} />
              </Field>
            </ActionForm>
          </Card>

          <Card title="Останні заявки">
            {orders.length === 0 ? (
              <Empty>Заявок ще не було</Empty>
            ) : (
              <Table head={['Номер', 'Дата', 'Статус', 'Сума з ПДВ']}>
                {orders.map((o) => (
                  <Row key={o.id}>
                    <Cell>
                      <Link
                        href={`/purchasing/${o.id}`}
                        className="font-semibold text-emerald-800 hover:underline"
                      >
                        {o.number}
                      </Link>
                    </Cell>
                    <Cell>{fmtDate(o.ordered_on)}</Cell>
                    <Cell>
                      <Badge
                        tone={
                          o.status === 'received' ? 'green' : o.status === 'cancelled' ? 'gray' : 'amber'
                        }
                      >
                        {PO_STATUS[o.status]}
                      </Badge>
                    </Cell>
                    <Cell align="right">{fmtMoney(o.gross)}</Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Розрахунки по юрособах">
            {balances.length === 0 ? (
              <Empty>Розрахунків ще не було</Empty>
            ) : (
              <Table head={['Юрособа', 'Нараховано', 'Борг']}>
                {balances.map((b) => (
                  <Row key={b.entity}>
                    <Cell className="font-semibold">{b.entity}</Cell>
                    <Cell align="right">{fmtMoney(b.billed_gross)}</Cell>
                    <Cell align="right">
                      {b.balance_due > 0.01 ? (
                        <span className="font-bold text-amber-600">{fmtMoney(b.balance_due)}</span>
                      ) : (
                        '—'
                      )}
                    </Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Card>

          <Card title={supplier.is_active ? 'Деактивація' : 'Активація'}>
            <p className="mb-3 text-sm text-emerald-800/70">
              {supplier.is_active
                ? 'Постачальник зникне зі списків вибору, але заявки, приходи й оплати лишаються в обліку.'
                : 'Постачальник повернеться у списки вибору.'}
            </p>
            {supplier.is_active && supplier.total_due > 0.01 && (
              <div className="mb-3">
                <Alert tone="amber">
                  Непогашена кредиторка {fmtMoney(supplier.total_due)} — деактивувати не можна.
                </Alert>
              </div>
            )}
            <ActionForm
              action={setSupplierActive}
              submitLabel={supplier.is_active ? 'Деактивувати' : 'Активувати'}
              variant={supplier.is_active ? 'danger' : 'primary'}
            >
              <input type="hidden" name="supplier_id" value={supplier.id} />
              <input type="hidden" name="active" value={supplier.is_active ? 'false' : 'true'} />
            </ActionForm>
          </Card>

          <Card title="Стан">
            <Badge tone={supplier.is_active ? 'green' : 'gray'}>
              {supplier.is_active ? 'Активний' : 'Деактивований'}
            </Badge>
          </Card>
        </div>
      </div>
    </>
  );
}
