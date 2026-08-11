import { query } from '@/lib/db';
import { fmtDate, fmtMoney } from '@/lib/format';

/**
 * Незакриті документи для прив'язки оплат із банківської виписки: замовлення
 * клієнтів і заявки постачальникам, за якими ще висить борг. Ярлик готується
 * тут, щоб клієнтський компонент не займався датами й грошима.
 */

export interface OpenDocRow {
  id: string;
  party_id: string;
  number: string;
  label: string;
  balance_due: number;
}

export async function openCustomerOrders(entityId: string): Promise<OpenDocRow[]> {
  const rows = await query<{
    id: string;
    party_id: string;
    number: string;
    ordered_on: string | Date;
    total_amount: number;
    balance_due: number;
  }>(
    `select f.id, f.customer_id as party_id, f.number, f.ordered_on, f.total_amount, f.balance_due
       from v_sales_orders_full f
      where f.legal_entity_id = $1 and f.status <> 'cancelled' and f.balance_due > 0.01
      order by f.ordered_on desc
      limit 300`,
    [entityId],
  );
  return rows.map((r) => ({
    id: r.id,
    party_id: r.party_id,
    number: r.number,
    label: `${fmtDate(r.ordered_on)} на ${fmtMoney(r.total_amount)}`,
    balance_due: Number(r.balance_due),
  }));
}

export async function openSupplierOrders(entityId: string): Promise<OpenDocRow[]> {
  const rows = await query<{
    id: string;
    party_id: string;
    number: string;
    ordered_on: string | Date;
    received_gross: number;
    balance_due: number;
  }>(
    `select x.* from (
       select p.id, p.supplier_id as party_id, p.number, p.ordered_on, a.received_gross,
              a.received_gross - coalesce((
                select sum(sp.amount) from supplier_payments sp where sp.po_id = p.id
              ), 0) as balance_due
         from purchase_orders p
         join v_po_amounts a on a.po_id = p.id
        where p.legal_entity_id = $1 and p.status <> 'cancelled'
     ) x
     where x.balance_due > 0.01
     order by x.ordered_on desc
     limit 300`,
    [entityId],
  );
  return rows.map((r) => ({
    id: r.id,
    party_id: r.party_id,
    number: r.number,
    label: `${fmtDate(r.ordered_on)} на ${fmtMoney(r.received_gross)}`,
    balance_due: Number(r.balance_due),
  }));
}
