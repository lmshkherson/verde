import { notFound } from 'next/navigation';
import { PrintButton } from '@/components/print-button';
import { LinkButton } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { amountInWords } from '@/lib/amount-words';
import { EXPENSE_CATEGORIES, fmtDate, fmtNum, fmtQty, unitLabel } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Порожній рядок під підпис члена комісії. */
function SignLine({ role, name }: { role: string; name?: string | null }) {
  return (
    <div className="mt-5">
      <span className="font-semibold">{role}</span>
      <div className="mt-6 border-b border-black" />
      <div className="mt-0.5 text-[10px] text-black/60">
        підпис · {name ?? 'прізвище та ініціали'}
      </div>
    </div>
  );
}

export default async function WriteOffPrintPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('warehouse', 'production', 'sales');
  const { id } = await params;

  const doc = await queryOne<{
    number: string;
    written_off_on: string;
    status: string;
    category: string;
    reason: string | null;
    warehouse_name: string | null;
    so_number: string | null;
    customer_name: string | null;
    entity_name: string;
    entity_edrpou: string | null;
    entity_address: string | null;
    director_name: string | null;
    director_position: string;
    accountant_name: string | null;
    created_by_name: string | null;
    created_by_position: string | null;
  }>(
    `select w.number, w.written_off_on, w.status, w.category, w.reason,
            wh.name as warehouse_name, o.number as so_number, c.name as customer_name,
            e.name as entity_name, e.edrpou as entity_edrpou, e.address as entity_address,
            e.director_name, e.director_position, e.accountant_name,
            u.full_name as created_by_name, u.position as created_by_position
       from write_offs w
       join legal_entities e on e.id = w.legal_entity_id
       left join warehouses wh on wh.id = w.warehouse_id
       left join sales_orders o on o.id = w.so_id
       left join customers c on c.id = o.customer_id
       left join app_users u on u.id = w.created_by
      where w.id = $1`,
    [id],
  );
  if (!doc) notFound();

  const lines = await query<{
    name: string;
    sku: string;
    unit: string;
    qty: number;
    note: string | null;
    cost: number | null;
  }>(
    `select i.name, i.sku, i.unit, l.qty, l.note,
            (select sum(-m.qty * m.unit_cost) from stock_moves m
              where m.doc_type = 'write_off_act' and m.doc_id = l.write_off_id
                and m.item_id = l.item_id) as cost
       from write_off_lines l
       join items i on i.id = l.item_id
      where l.write_off_id = $1
      order by i.name`,
    [id],
  );

  const totalCost = lines.reduce((s, l) => s + Number(l.cost ?? 0), 0);

  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <PrintButton label="Друк / зберегти PDF" />
        <LinkButton href={`/writeoffs/${id}`}>← До акта</LinkButton>
        {doc.status !== 'posted' && (
          <span className="text-sm text-amber-700">
            Акт ще не проведено — собівартість у бланку з’явиться після проведення.
          </span>
        )}
      </div>

      {/* Аркуш A4: жорстка ширина в міліметрах, щоб екран і папір збігалися. */}
      <div className="mx-auto w-full max-w-[210mm] bg-white p-[12mm] text-black shadow-sm print:p-0 print:shadow-none">
        <div className="mb-4 flex items-start justify-between text-[12px]">
          <div>
            <div className="font-semibold">{doc.entity_name}</div>
            {doc.entity_edrpou && <div>код ЄДРПОУ {doc.entity_edrpou}</div>}
            {doc.entity_address && <div>{doc.entity_address}</div>}
          </div>
          <div className="text-right">
            <div className="font-semibold">ЗАТВЕРДЖУЮ</div>
            <div>{doc.director_position}</div>
            <div className="mt-5 border-b border-black" />
            <div className="mt-0.5 text-[10px] text-black/60">
              підпис · {doc.director_name ?? 'прізвище та ініціали'}
            </div>
          </div>
        </div>

        <h1 className="mb-1 text-center text-lg font-bold uppercase">
          Акт списання № {doc.number}
        </h1>
        <p className="mb-5 text-center text-[13px]">від {fmtDate(doc.written_off_on)}</p>

        <p className="mb-4 text-[13px]">
          Комісія провела огляд товарно-матеріальних цінностей
          {doc.warehouse_name ? ` на складі «${doc.warehouse_name}»` : ''} і встановила, що
          зазначені нижче цінності підлягають списанню.
          {doc.reason ? ` Причина: ${doc.reason}.` : ''}
          {doc.so_number
            ? ` Підстава: замовлення № ${doc.so_number}${doc.customer_name ? `, отримувач ${doc.customer_name}` : ''}.`
            : ''}{' '}
          Стаття витрат: {EXPENSE_CATEGORIES[doc.category] ?? doc.category}.
        </p>

        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              {['№', 'Найменування', 'Артикул', 'Од.', 'Кількість', 'Собівартість, грн', 'Примітка'].map(
                (h) => (
                  <th key={h} className="border border-black px-1.5 py-1 text-center font-semibold">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={`${l.sku}-${i}`}>
                <td className="border border-black px-1.5 py-1 text-center">{i + 1}</td>
                <td className="border border-black px-1.5 py-1">{l.name}</td>
                <td className="border border-black px-1.5 py-1 text-center">{l.sku}</td>
                <td className="border border-black px-1.5 py-1 text-center">{unitLabel(l.unit)}</td>
                <td className="border border-black px-1.5 py-1 text-right tabular-nums">
                  {fmtQty(l.qty)}
                </td>
                <td className="border border-black px-1.5 py-1 text-right tabular-nums">
                  {l.cost != null ? fmtNum(l.cost) : '—'}
                </td>
                <td className="border border-black px-1.5 py-1">{l.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="border border-black px-1.5 py-1 text-right font-bold">
                Разом
              </td>
              <td className="border border-black px-1.5 py-1 text-right font-bold tabular-nums">
                {fmtNum(totalCost)}
              </td>
              <td className="border border-black px-1.5 py-1" />
            </tr>
          </tfoot>
        </table>

        <p className="mt-3 text-[12px]">
          Усього найменувань {lines.length}, на суму{' '}
          <span className="font-semibold">{fmtNum(totalCost)} грн</span>
        </p>
        <p className="text-[12px] font-semibold">{amountInWords(totalCost)}</p>

        {/* Підписи комісії. Посада поруч із прізвищем — обов'язковий реквізит
            первинного документа (ч. 2 ст. 9 Закону № 996-XIV). */}
        <div className="mt-8 grid grid-cols-2 gap-10 text-[12px]">
          <div>
            <div className="mb-1 font-semibold">Комісія</div>
            <SignLine role="Голова комісії" name={doc.director_name} />
            {doc.accountant_name && <SignLine role="Головний бухгалтер" name={doc.accountant_name} />}
            <SignLine
              role={doc.created_by_position ?? 'Член комісії'}
              name={doc.created_by_name}
            />
          </div>
          <div>
            <div className="mb-1 font-semibold">Матеріально відповідальна особа</div>
            <SignLine role="Посада" />
            <div className="mt-5 text-[10px] text-black/60">М.П. (за наявності печатки)</div>
          </div>
        </div>
      </div>
    </>
  );
}
