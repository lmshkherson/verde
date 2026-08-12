import { query } from '@/lib/db';

/**
 * Дані для акта звірки взаєморозрахунків: єдиний список операцій за
 * контрагентом у розрізі юрособи. Джерела рівно ті самі, з яких складаються
 * v_customer_balance і v_supplier_balance — інакше акт розійшовся б із
 * дебіторкою/кредиторкою на екранах.
 */
export interface ReconRow {
  day: string;
  doc: string;
  /** Збільшення боргу контрагента перед нами (клієнт) або нашого (постачальник). */
  debit: number;
  credit: number;
}

export interface ReconData {
  opening: number;
  rows: ReconRow[];
  closing: number;
  totalDebit: number;
  totalCredit: number;
}

const build = (all: (ReconRow & { raw: string })[], from: string, to: string): ReconData => {
  const sorted = all.sort((a, b) => (a.raw < b.raw ? -1 : a.raw > b.raw ? 1 : 0));
  let opening = 0;
  const rows: ReconRow[] = [];
  for (const r of sorted) {
    if (r.raw < from) opening += r.debit - r.credit;
    else if (r.raw <= to) rows.push(r);
  }
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  return { opening, rows, closing: opening + totalDebit - totalCredit, totalDebit, totalCredit };
};

/** Клієнт: дебет — відвантаження, кредит — оплати й повернення. */
export async function customerReconciliation(
  customerId: string,
  entityId: string,
  from: string,
  to: string,
): Promise<ReconData> {
  const [shipments, returns, payments] = await Promise.all([
    query<{ raw: string; number: string; so_number: string; amount: number }>(
      `select sh.shipped_on::text as raw, sh.number, o.number as so_number,
              coalesce(sum(round(sl.qty * l.unit_price * (1 + l.vat_rate / 100), 2)), 0) as amount
         from shipments sh
         join sales_orders o on o.id = sh.so_id
         join shipment_lines sl on sl.shipment_id = sh.id
         join sales_order_lines l on l.id = sl.so_line_id
        where o.customer_id = $1 and o.legal_entity_id = $2 and o.status <> 'cancelled'
        group by sh.id, sh.shipped_on, sh.number, o.number`,
      [customerId, entityId],
    ),
    query<{ raw: string; number: string; amount: number }>(
      `select r.returned_on::text as raw, r.number, a.gross_amount as amount
         from customer_returns r
         join v_return_amounts a on a.return_id = r.id
        where r.customer_id = $1 and r.legal_entity_id = $2`,
      [customerId, entityId],
    ),
    query<{ raw: string; method: string; amount: number; note: string | null }>(
      `select paid_on::text as raw, method, amount, note from payments
        where customer_id = $1 and legal_entity_id = $2`,
      [customerId, entityId],
    ),
  ]);

  return build(
    [
      ...shipments.map((s) => ({
        raw: s.raw,
        day: s.raw,
        doc: `Відвантаження ${s.number} (зам. ${s.so_number})`,
        debit: Number(s.amount),
        credit: 0,
      })),
      ...returns.map((r) => ({
        raw: r.raw,
        day: r.raw,
        doc: `Повернення ${r.number}`,
        debit: 0,
        credit: Number(r.amount),
      })),
      ...payments.map((p) => ({
        raw: p.raw,
        day: p.raw,
        doc: `Оплата (${p.method === 'bank' ? 'банк' : p.method === 'cash' ? 'готівка' : 'інше'})`,
        debit: 0,
        credit: Number(p.amount),
      })),
    ],
    from,
    to,
  );
}

/** Постачальник: кредит — наші отримання й послуги, дебет — оплати й повернення. */
export async function supplierReconciliation(
  supplierId: string,
  entityId: string,
  from: string,
  to: string,
): Promise<ReconData> {
  const [pos, receipts, expenses, returns, payments] = await Promise.all([
    // Дата боргу за заявкою — день фактичного оприбуткування (рухи складу).
    query<{ raw: string; number: string; amount: number }>(
      `select coalesce(min(m.moved_at)::date::text, p.ordered_on::text) as raw,
              p.number, a.received_gross as amount
         from purchase_orders p
         join v_po_amounts a on a.po_id = p.id
         left join stock_moves m on m.doc_type = 'purchase_order' and m.doc_id = p.id
        where p.supplier_id = $1 and p.legal_entity_id = $2
          and p.status <> 'cancelled' and a.received_gross > 0
        group by p.id, p.number, p.ordered_on, a.received_gross`,
      [supplierId, entityId],
    ),
    query<{ raw: string; number: string; amount: number }>(
      `select r.received_on::text as raw, r.number,
              coalesce(sum(case when r.prices_include_vat then round(l.qty * l.unit_price, 2)
                           else round(l.qty * l.unit_price * (1 + l.vat_rate / 100), 2) end), 0) as amount
         from receipts r
         join receipt_lines l on l.receipt_id = r.id and l.kind = 'goods'
        where r.supplier_id = $1 and r.legal_entity_id = $2 and r.status = 'posted'
        group by r.id, r.received_on, r.number`,
      [supplierId, entityId],
    ),
    query<{ raw: string; description: string | null; amount: number }>(
      `select spent_on::text as raw, description, amount_net + vat_amount as amount
         from expenses where supplier_id = $1 and legal_entity_id = $2`,
      [supplierId, entityId],
    ),
    query<{ raw: string; number: string; amount: number }>(
      `select r.returned_on::text as raw, r.number, a.gross_amount as amount
         from supplier_returns r
         join v_supplier_return_amounts a on a.return_id = r.id
        where r.supplier_id = $1 and r.legal_entity_id = $2`,
      [supplierId, entityId],
    ),
    query<{ raw: string; method: string; amount: number }>(
      `select paid_on::text as raw, method, amount from supplier_payments
        where supplier_id = $1 and legal_entity_id = $2`,
      [supplierId, entityId],
    ),
  ]);

  return build(
    [
      ...pos.map((p) => ({
        raw: p.raw,
        day: p.raw,
        doc: `Поставка за заявкою ${p.number}`,
        debit: 0,
        credit: Number(p.amount),
      })),
      ...receipts.map((r) => ({
        raw: r.raw,
        day: r.raw,
        doc: `Надходження ${r.number}`,
        debit: 0,
        credit: Number(r.amount),
      })),
      ...expenses.map((e) => ({
        raw: e.raw,
        day: e.raw,
        doc: e.description ?? 'Послуги',
        debit: 0,
        credit: Number(e.amount),
      })),
      ...returns.map((r) => ({
        raw: r.raw,
        day: r.raw,
        doc: `Повернення ${r.number}`,
        debit: Number(r.amount),
        credit: 0,
      })),
      ...payments.map((p) => ({
        raw: p.raw,
        day: p.raw,
        doc: `Оплата (${p.method === 'bank' ? 'банк' : p.method === 'cash' ? 'готівка' : 'інше'})`,
        debit: Number(p.amount),
        credit: 0,
      })),
    ],
    from,
    to,
  );
}
