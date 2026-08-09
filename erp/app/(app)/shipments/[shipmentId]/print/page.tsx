import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Barcode } from '@/components/barcode';
import { PrintButton } from '@/components/print-button';
import { LinkButton } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { amountInWords } from '@/lib/amount-words';
import { fmtDate, fmtNum, fmtQty, unitLabel } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Рядок реквізиту: підпис дрібним під рискою, як у паперовому бланку. */
function Party({ title, lines }: { title: string; lines: (string | null)[] }) {
  return (
    <div className="mb-3">
      <div className="text-[10px] uppercase tracking-wide text-black/60">{title}</div>
      <div className="border-b border-black pb-0.5 text-[13px] leading-snug">
        {lines.filter(Boolean).join(', ')}
      </div>
    </div>
  );
}

export default async function ShipmentPrintPage({
  params,
}: {
  params: Promise<{ shipmentId: string }>;
}) {
  await requireRole('sales', 'warehouse');
  const { shipmentId } = await params;

  const doc = await queryOne<{
    number: string;
    shipped_on: string;
    ttn_number: string | null;
    carrier: string | null;
    proxy_number: string | null;
    proxy_date: string | null;
    proxy_person: string | null;
    proxy_position: string | null;
    issued_by: string | null;
    issued_by_position: string | null;
    order_number: string;
    order_id: string;
    seller_name: string;
    seller_edrpou: string | null;
    seller_ipn: string | null;
    seller_address: string | null;
    seller_phone: string | null;
    seller_is_vat_payer: boolean;
    seller_director: string | null;
    seller_director_position: string;
    seller_accountant: string | null;
    buyer_name: string;
    buyer_edrpou: string | null;
    buyer_ipn: string | null;
    buyer_address: string | null;
    buyer_phone: string | null;
  }>(
    `select sh.number, sh.shipped_on, sh.ttn_number, sh.carrier,
            sh.proxy_number, sh.proxy_date, sh.proxy_person, sh.proxy_position,
            u.full_name as issued_by, u.position as issued_by_position,
            o.number as order_number, o.id as order_id,
            e.name as seller_name, e.edrpou as seller_edrpou, e.ipn as seller_ipn,
            e.address as seller_address, e.phone as seller_phone,
            e.is_vat_payer as seller_is_vat_payer,
            e.director_name as seller_director, e.director_position as seller_director_position,
            e.accountant_name as seller_accountant,
            c.name as buyer_name, c.edrpou as buyer_edrpou, c.ipn as buyer_ipn,
            c.address as buyer_address, c.phone as buyer_phone
       from shipments sh
       join sales_orders o on o.id = sh.so_id
       join legal_entities e on e.id = o.legal_entity_id
       join customers c on c.id = o.customer_id
       left join app_users u on u.id = sh.created_by
      where sh.id = $1`,
    [shipmentId],
  );
  if (!doc) notFound();

  const lines = await query<{
    name: string;
    unit: string;
    uktzed: string | null;
    barcode: string | null;
    qty: number;
    unit_price: number;
    vat_rate: number;
  }>(
    `select i.name, i.unit, i.uktzed, i.barcode, sl.qty, l.unit_price, l.vat_rate
       from shipment_lines sl
       join items i on i.id = sl.item_id
       join sales_order_lines l on l.id = sl.so_line_id
      where sl.shipment_id = $1
      order by i.name`,
    [shipmentId],
  );

  // Ціни в базі без ПДВ — податок нараховується тут, як і в самому документі.
  const rows = lines.map((l) => {
    const net = Number(l.qty) * Number(l.unit_price);
    const vat = (net * Number(l.vat_rate)) / 100;
    return { ...l, net, vat, gross: net + vat };
  });

  const totalNet = rows.reduce((s, r) => s + r.net, 0);
  const totalVat = rows.reduce((s, r) => s + r.vat, 0);
  const totalGross = totalNet + totalVat;

  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <PrintButton label="Друк / зберегти PDF" />
        <LinkButton href={`/sales/${doc.order_id}`}>← До замовлення</LinkButton>
        <LinkButton href={`/shipments/${shipmentId}/ttn`}>ТТН</LinkButton>
        <LinkButton href={`/movements/${shipmentId}`}>Рухи документа</LinkButton>
        {!doc.seller_address && (
          <span className="text-sm text-amber-700">
            У юрособи не заповнена адреса —{' '}
            <Link href="/entities" className="underline">
              додайте її
            </Link>
            , інакше бланк піде без неї.
          </span>
        )}
      </div>

      {/* Аркуш A4: жорстка ширина в міліметрах, щоб екран і папір збігалися. */}
      <div className="mx-auto w-full max-w-[210mm] bg-white p-[12mm] text-black shadow-sm print:p-0 print:shadow-none">
        <h1 className="mb-1 text-center text-lg font-bold uppercase">
          Видаткова накладна № {doc.number}
        </h1>
        <p className="mb-5 text-center text-[13px]">від {fmtDate(doc.shipped_on)}</p>

        <Party
          title="Постачальник"
          lines={[
            doc.seller_name,
            doc.seller_edrpou && `код ЄДРПОУ ${doc.seller_edrpou}`,
            doc.seller_is_vat_payer && doc.seller_ipn ? `ІПН ${doc.seller_ipn}` : 'не є платником ПДВ',
            doc.seller_address,
            doc.seller_phone && `тел. ${doc.seller_phone}`,
          ]}
        />
        <Party
          title="Покупець"
          lines={[
            doc.buyer_name,
            doc.buyer_edrpou && `код ЄДРПОУ ${doc.buyer_edrpou}`,
            doc.buyer_ipn && `ІПН ${doc.buyer_ipn}`,
            doc.buyer_address,
            doc.buyer_phone && `тел. ${doc.buyer_phone}`,
          ]}
        />
        <Party
          title="Підстава"
          lines={[
            `Замовлення № ${doc.order_number}`,
            doc.ttn_number && `ТТН № ${doc.ttn_number}`,
            doc.carrier && `перевізник ${doc.carrier}`,
          ]}
        />

        <table className="mt-4 w-full border-collapse text-[12px]">
          <thead>
            <tr>
              {[
                '№',
                'Товар',
                'Штрихкод',
                'Код УКТ ЗЕД',
                'Од.',
                'Кількість',
                'Ціна без ПДВ',
                'Сума без ПДВ',
              ].map((h) => (
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
                <td className="border border-black px-1 py-1 text-center align-middle">
                  {r.barcode ? (
                    <Barcode value={r.barcode} barHeight={44} />
                  ) : (
                    '—'
                  )}
                </td>
                <td className="border border-black px-1.5 py-1 text-center">{r.uktzed ?? '—'}</td>
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
              <td colSpan={7} className="border border-black px-1.5 py-1 text-right font-semibold">
                Разом без ПДВ
              </td>
              <td className="border border-black px-1.5 py-1 text-right font-semibold tabular-nums">
                {fmtNum(totalNet)}
              </td>
            </tr>
            <tr>
              <td colSpan={7} className="border border-black px-1.5 py-1 text-right font-semibold">
                {doc.seller_is_vat_payer ? 'ПДВ 20%' : 'ПДВ (не платник)'}
              </td>
              <td className="border border-black px-1.5 py-1 text-right font-semibold tabular-nums">
                {fmtNum(totalVat)}
              </td>
            </tr>
            <tr>
              <td colSpan={7} className="border border-black px-1.5 py-1 text-right font-bold">
                Разом із ПДВ
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
        {doc.seller_is_vat_payer && (
          <p className="text-[12px]">У тому числі ПДВ: {fmtNum(totalVat)} грн</p>
        )}

        {(doc.proxy_number || doc.proxy_person) && (
          <p className="mt-3 text-[12px]">
            Отримувач діє за довіреністю
            {doc.proxy_number ? ` № ${doc.proxy_number}` : ''}
            {doc.proxy_date ? ` від ${fmtDate(doc.proxy_date)}` : ''}
            {doc.proxy_person ? `, ${doc.proxy_person}` : ''}
          </p>
        )}

        {/* Підписи. Посада поруч із прізвищем — обов'язковий реквізит первинного
            документа (ч. 2 ст. 9 Закону № 996-XIV), тому вона друкується завжди:
            або значенням із довідника, або підписом порожнього рядка під заповнення. */}
        <div className="mt-10 grid grid-cols-2 gap-10 text-[12px]">
          <div>
            <div className="mb-1 font-semibold">Від постачальника</div>

            <div className="mt-2">
              <span className="font-semibold">
                {doc.issued_by_position ?? 'Відпустив (посада)'}
              </span>
              <div className="mt-6 border-b border-black" />
              <div className="mt-0.5 text-[10px] text-black/60">
                підпис · {doc.issued_by ?? 'прізвище та ініціали'}
              </div>
            </div>

            <div className="mt-5">
              <span className="font-semibold">{doc.seller_director_position}</span>
              <div className="mt-6 border-b border-black" />
              <div className="mt-0.5 text-[10px] text-black/60">
                підпис · {doc.seller_director ?? 'прізвище та ініціали'}
              </div>
            </div>

            {doc.seller_accountant && (
              <div className="mt-5">
                <span className="font-semibold">Головний бухгалтер</span>
                <div className="mt-6 border-b border-black" />
                <div className="mt-0.5 text-[10px] text-black/60">
                  підпис · {doc.seller_accountant}
                </div>
              </div>
            )}

            <div className="mt-5 text-[10px] text-black/60">М.П. (за наявності печатки)</div>
          </div>

          <div>
            <div className="mb-1 font-semibold">Отримав(ла)</div>
            <div className="mt-2">
              <span className="font-semibold">
                {doc.proxy_position ?? 'Посада'}
              </span>
              <div className="mt-6 border-b border-black" />
              <div className="mt-0.5 text-[10px] text-black/60">
                підпис · {doc.proxy_person ?? 'прізвище та ініціали'}
              </div>
            </div>
            <div className="mt-5 text-[10px] text-black/60">М.П. (за наявності печатки)</div>
          </div>
        </div>
      </div>
    </>
  );
}
