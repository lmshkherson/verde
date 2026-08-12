import { notFound } from 'next/navigation';
import { PrintButton } from '@/components/print-button';
import { LinkButton } from '@/components/ui';
import { queryOne } from '@/lib/db';
import { amountInWords } from '@/lib/amount-words';
import { EXPENSE_CATEGORIES, fmtDate, fmtNum } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Друкований касовий ордер: ПКО або ВКО залежно від напряму. */
export default async function CashOrderPrintPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('sales', 'warehouse');
  const { id } = await params;

  const doc = await queryOne<{
    number: string;
    direction: string;
    kind: string;
    occurred_on: string;
    amount: number;
    person: string | null;
    purpose: string | null;
    category: string | null;
    counterparty: string | null;
    so_number: string | null;
    entity_name: string;
    entity_edrpou: string | null;
    director_name: string | null;
    director_position: string;
    accountant_name: string | null;
  }>(
    `select o.number, o.direction, o.kind, o.occurred_on, o.amount, o.person, o.purpose, o.category,
            coalesce(c.name, s.name) as counterparty, so.number as so_number,
            e.name as entity_name, e.edrpou as entity_edrpou,
            e.director_name, e.director_position, e.accountant_name
       from cash_orders o
       join legal_entities e on e.id = o.legal_entity_id
       left join customers c on c.id = o.customer_id
       left join suppliers s on s.id = o.supplier_id
       left join sales_orders so on so.id = o.so_id
      where o.id = $1`,
    [id],
  );
  if (!doc) notFound();

  const isIn = doc.direction === 'in';
  const basis =
    doc.purpose ??
    (doc.kind === 'customer_payment'
      ? `Оплата від покупця${doc.so_number ? ` за замовленням № ${doc.so_number}` : ''}`
      : doc.kind === 'supplier_payment'
        ? 'Оплата постачальнику'
        : doc.kind === 'expense'
          ? `Господарська витрата: ${EXPENSE_CATEGORIES[doc.category ?? ''] ?? doc.category ?? ''}`
          : 'Інша касова операція');

  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <PrintButton label="Друк / зберегти PDF" />
        <LinkButton href="/cash">← До каси</LinkButton>
      </div>

      {/* Половина A4 — типовий формат касового ордера. */}
      <div className="mx-auto w-full max-w-[210mm] bg-white p-[12mm] text-black shadow-sm print:p-0 print:shadow-none">
        <div className="mb-4 text-[12px]">
          <div className="font-semibold">{doc.entity_name}</div>
          {doc.entity_edrpou && <div>код ЄДРПОУ {doc.entity_edrpou}</div>}
        </div>

        <h1 className="mb-1 text-center text-lg font-bold uppercase">
          {isIn ? 'Прибутковий' : 'Видатковий'} касовий ордер № {doc.number}
        </h1>
        <p className="mb-5 text-center text-[13px]">від {fmtDate(doc.occurred_on)}</p>

        <table className="w-full border-collapse text-[13px]">
          <tbody>
            <tr>
              <td className="w-48 border border-black px-2 py-1.5 font-semibold">
                {isIn ? 'Прийнято від' : 'Видано'}
              </td>
              <td className="border border-black px-2 py-1.5">
                {doc.person ?? doc.counterparty ?? '________________________________'}
                {doc.person && doc.counterparty ? ` (${doc.counterparty})` : ''}
              </td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1.5 font-semibold">Підстава</td>
              <td className="border border-black px-2 py-1.5">{basis}</td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1.5 font-semibold">Сума</td>
              <td className="border border-black px-2 py-1.5">
                <span className="font-bold tabular-nums">{fmtNum(doc.amount)} грн</span> —{' '}
                {amountInWords(doc.amount)}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mt-10 grid grid-cols-3 gap-8 text-[12px]">
          <div>
            <span className="font-semibold">{doc.director_position}</span>
            <div className="mt-6 border-b border-black" />
            <div className="mt-0.5 text-[10px] text-black/60">
              підпис · {doc.director_name ?? 'прізвище та ініціали'}
            </div>
          </div>
          {doc.accountant_name && (
            <div>
              <span className="font-semibold">Головний бухгалтер</span>
              <div className="mt-6 border-b border-black" />
              <div className="mt-0.5 text-[10px] text-black/60">підпис · {doc.accountant_name}</div>
            </div>
          )}
          <div>
            <span className="font-semibold">Касир</span>
            <div className="mt-6 border-b border-black" />
            <div className="mt-0.5 text-[10px] text-black/60">підпис · прізвище та ініціали</div>
          </div>
        </div>

        <div className="mt-8 text-[12px]">
          <span className="font-semibold">{isIn ? 'Здав(ла)' : 'Одержав(ла)'}</span>
          <div className="mt-6 w-1/2 border-b border-black" />
          <div className="mt-0.5 text-[10px] text-black/60">
            підпис · {doc.person ?? 'прізвище та ініціали'} · дата
          </div>
        </div>
      </div>
    </>
  );
}
