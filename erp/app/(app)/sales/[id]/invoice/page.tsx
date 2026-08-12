import { notFound } from 'next/navigation';
import { PrintButton } from '@/components/print-button';
import { LinkButton } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { amountInWords } from '@/lib/amount-words';
import { fmtDate, fmtNum, fmtQty, unitLabel } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Рахунок на оплату — те, що мережі й гуртовики просять до відвантаження.
 * Номер збігається з номером замовлення: окремої сутності не заводимо,
 * бо рахунок і є замовлення, показане покупцю з реквізитами для оплати.
 */
export default async function SalesInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('sales', 'warehouse');
  const { id } = await params;

  const doc = await queryOne<{
    id: string;
    number: string;
    ordered_on: string;
    status: string;
    payment_terms_days: number;
    discount_pct: number;
    seller_name: string;
    seller_edrpou: string | null;
    seller_ipn: string | null;
    seller_address: string | null;
    seller_phone: string | null;
    seller_is_vat_payer: boolean;
    seller_director: string | null;
    seller_director_position: string;
    seller_fallback_iban: string | null;
    seller_fallback_bank: string | null;
    buyer_name: string;
    buyer_edrpou: string | null;
    buyer_ipn: string | null;
    buyer_address: string | null;
    buyer_phone: string | null;
  }>(
    `select o.id, o.number, o.ordered_on, o.status, c.payment_terms_days, o.discount_pct,
            e.name as seller_name, e.edrpou as seller_edrpou, e.ipn as seller_ipn,
            e.address as seller_address, e.phone as seller_phone,
            e.is_vat_payer as seller_is_vat_payer,
            e.director_name as seller_director, e.director_position as seller_director_position,
            e.bank_account as seller_fallback_iban, e.bank_name as seller_fallback_bank,
            c.name as buyer_name, c.edrpou as buyer_edrpou, c.ipn as buyer_ipn,
            c.address as buyer_address, c.phone as buyer_phone
       from sales_orders o
       join legal_entities e on e.id = o.legal_entity_id
       join customers c on c.id = o.customer_id
      where o.id = $1`,
    [id],
  );
  if (!doc) notFound();

  const [account, lines] = await Promise.all([
    queryOne<{ iban: string | null; bank_name: string | null }>(
      `select b.iban, b.bank_name
         from bank_accounts b
         join sales_orders o on o.legal_entity_id = b.legal_entity_id
        where o.id = $1 and b.is_active
        order by b.is_default desc, b.created_at
        limit 1`,
      [id],
    ),
    query<{ name: string; unit: string; qty: number; unit_price: number; vat_rate: number }>(
      `select i.name, i.unit, l.qty, l.unit_price, l.vat_rate
         from sales_order_lines l
         join items i on i.id = l.item_id
        where l.so_id = $1
        order by i.name`,
      [id],
    ),
  ]);

  const iban = account?.iban ?? doc.seller_fallback_iban;
  const bankName = account?.bank_name ?? doc.seller_fallback_bank;

  const rows = lines.map((l) => {
    const net = Number(l.qty) * Number(l.unit_price);
    const vat = (net * Number(l.vat_rate)) / 100;
    return { ...l, net, vat, gross: net + vat };
  });
  const totalNet = rows.reduce((s, r) => s + r.net, 0);
  const totalVat = rows.reduce((s, r) => s + r.vat, 0);
  const totalGross = totalNet + totalVat;

  const Party = ({ title, lines: partyLines }: { title: string; lines: (string | null | false)[] }) => (
    <div className="mb-3">
      <div className="text-[10px] uppercase tracking-wide text-black/60">{title}</div>
      <div className="border-b border-black pb-0.5 text-[13px] leading-snug">
        {partyLines.filter(Boolean).join(', ')}
      </div>
    </div>
  );

  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <PrintButton label="Друк / зберегти PDF" />
        <LinkButton href={`/sales/${doc.id}`}>← До замовлення</LinkButton>
        {!iban && (
          <span className="text-sm text-amber-700">
            У юрособи немає жодного банківського рахунку — рахунок піде без IBAN. Додайте рахунок
            на сторінці «Банк».
          </span>
        )}
      </div>

      {/* Аркуш A4: жорстка ширина в міліметрах, щоб екран і папір збігалися. */}
      <div className="mx-auto w-full max-w-[210mm] bg-white p-[12mm] text-black shadow-sm print:p-0 print:shadow-none">
        <h1 className="mb-1 text-center text-lg font-bold uppercase">
          Рахунок на оплату № {doc.number}
        </h1>
        <p className="mb-5 text-center text-[13px]">від {fmtDate(doc.ordered_on)}</p>

        <Party
          title="Постачальник (отримувач платежу)"
          lines={[
            doc.seller_name,
            doc.seller_edrpou && `код ЄДРПОУ ${doc.seller_edrpou}`,
            doc.seller_is_vat_payer && doc.seller_ipn ? `ІПН ${doc.seller_ipn}` : 'не є платником ПДВ',
            doc.seller_address,
            doc.seller_phone && `тел. ${doc.seller_phone}`,
          ]}
        />
        <Party
          title="Рахунок отримувача"
          lines={[iban && `IBAN ${iban}`, bankName, !iban && 'реквізити рахунку не заповнені']}
        />
        <Party
          title="Покупець (платник)"
          lines={[
            doc.buyer_name,
            doc.buyer_edrpou && `код ЄДРПОУ ${doc.buyer_edrpou}`,
            doc.buyer_ipn && `ІПН ${doc.buyer_ipn}`,
            doc.buyer_address,
            doc.buyer_phone && `тел. ${doc.buyer_phone}`,
          ]}
        />
        <Party title="Підстава" lines={[`Замовлення № ${doc.number} від ${fmtDate(doc.ordered_on)}`]} />

        <table className="mt-4 w-full border-collapse text-[12px]">
          <thead>
            <tr>
              {['№', 'Товар', 'Од.', 'Кількість', 'Ціна без ПДВ', 'Сума без ПДВ'].map((h) => (
                <th key={h} className="border border-black px-1.5 py-1 text-center font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.name}-${i}`}>
                <td className="border border-black px-1.5 py-1 text-center">{i + 1}</td>
                <td className="border border-black px-1.5 py-1">{r.name}</td>
                <td className="border border-black px-1.5 py-1 text-center">{unitLabel(r.unit)}</td>
                <td className="border border-black px-1.5 py-1 text-right tabular-nums">
                  {fmtQty(r.qty)}
                </td>
                <td className="border border-black px-1.5 py-1 text-right tabular-nums">
                  {fmtNum(r.unit_price)}
                </td>
                <td className="border border-black px-1.5 py-1 text-right tabular-nums">
                  {fmtNum(r.net)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="border border-black px-1.5 py-1 text-right font-semibold">
                Разом без ПДВ
              </td>
              <td className="border border-black px-1.5 py-1 text-right font-semibold tabular-nums">
                {fmtNum(totalNet)}
              </td>
            </tr>
            <tr>
              <td colSpan={5} className="border border-black px-1.5 py-1 text-right font-semibold">
                {doc.seller_is_vat_payer ? 'ПДВ' : 'ПДВ (не платник)'}
              </td>
              <td className="border border-black px-1.5 py-1 text-right font-semibold tabular-nums">
                {fmtNum(totalVat)}
              </td>
            </tr>
            <tr>
              <td colSpan={5} className="border border-black px-1.5 py-1 text-right font-bold">
                Разом до сплати
              </td>
              <td className="border border-black px-1.5 py-1 text-right font-bold tabular-nums">
                {fmtNum(totalGross)}
              </td>
            </tr>
          </tfoot>
        </table>

        <p className="mt-3 text-[12px]">
          Усього найменувань {rows.length}, на суму{' '}
          <span className="font-semibold">{fmtNum(totalGross)} грн</span>
        </p>
        <p className="text-[12px] font-semibold">{amountInWords(totalGross)}</p>
        {Number(doc.discount_pct) > 0 && (
          <p className="mt-1 text-[12px] text-black/70">
            Ціни вказані з урахуванням знижки {Number(doc.discount_pct)}% від прайсу.
          </p>
        )}

        <p className="mt-3 text-[12px]">
          Призначення платежу: <span className="font-semibold">Оплата за рахунком № {doc.number} від{' '}
          {fmtDate(doc.ordered_on)}{doc.seller_is_vat_payer ? `, у т.ч. ПДВ ${fmtNum(totalVat)} грн` : ', без ПДВ'}</span>
        </p>
        {doc.payment_terms_days > 0 && (
          <p className="mt-1 text-[12px] text-black/70">
            Рахунок дійсний до сплати протягом {doc.payment_terms_days} днів від дати виставлення.
          </p>
        )}

        <div className="mt-10 grid grid-cols-2 gap-10 text-[12px]">
          <div>
            <span className="font-semibold">{doc.seller_director_position}</span>
            <div className="mt-6 border-b border-black" />
            <div className="mt-0.5 text-[10px] text-black/60">
              підпис · {doc.seller_director ?? 'прізвище та ініціали'}
            </div>
            <div className="mt-5 text-[10px] text-black/60">М.П. (за наявності печатки)</div>
          </div>
        </div>
      </div>
    </>
  );
}
