import { query } from '@/lib/db';

/**
 * Потреби в закупівлі. Дефіцит позиції рахується по групі юросіб — склад у
 * компанії фізично спільний, і закуповують під нього, а не під юрособу:
 *
 *   дефіцит = потреба відкритих варок + мінімальний залишок
 *           − доступно на складі − уже замовлено в постачальників.
 */
export interface NeedRow {
  item_id: string;
  name: string;
  sku: string;
  unit: string;
  kind: string;
  available: number;
  min_stock: number;
  production_need: number;
  on_order: number;
  shortage: number;
  supplier_id: string | null;
  supplier_name: string | null;
  last_price: number | null;
  last_price_gross: boolean;
}

export async function purchaseNeeds(): Promise<NeedRow[]> {
  const rows = await query<NeedRow>(
    `with stock as (
       select item_id, sum(available_qty) as available
         from v_item_available group by item_id
     ),
     production_need as (
       select rl.item_id,
              sum(rl.qty_per_batch * (1 + rl.loss_pct / 100)
                  * greatest(po.planned_qty - po.produced_qty, 0) / r.output_qty) as qty
         from production_orders po
         join recipes r on r.id = po.recipe_id
         join recipe_lines rl on rl.recipe_id = r.id
        where po.status in ('planned', 'in_progress')
        group by rl.item_id
     ),
     on_order as (
       select l.item_id, sum(greatest(l.qty - l.received_qty, 0)) as qty
         from purchase_order_lines l
         join purchase_orders p on p.id = l.po_id
        where p.status in ('draft', 'ordered')
        group by l.item_id
     ),
     last_buy as (
       select distinct on (l.item_id)
              l.item_id, p.supplier_id, s.name as supplier_name,
              l.unit_price, p.prices_include_vat
         from purchase_order_lines l
         join purchase_orders p on p.id = l.po_id
         join suppliers s on s.id = p.supplier_id
        where p.status <> 'cancelled' and s.is_active
        order by l.item_id, p.ordered_on desc, p.number desc
     )
     select i.id as item_id, i.name, i.sku, i.unit, i.kind,
            coalesce(st.available, 0)      as available,
            coalesce(i.min_stock, 0)       as min_stock,
            coalesce(pn.qty, 0)            as production_need,
            coalesce(oo.qty, 0)            as on_order,
            coalesce(pn.qty, 0) + coalesce(i.min_stock, 0)
              - coalesce(st.available, 0) - coalesce(oo.qty, 0) as shortage,
            lb.supplier_id, lb.supplier_name,
            lb.unit_price as last_price,
            coalesce(lb.prices_include_vat, true) as last_price_gross
       from items i
       left join stock st on st.item_id = i.id
       left join production_need pn on pn.item_id = i.id
       left join on_order oo on oo.item_id = i.id
       left join last_buy lb on lb.item_id = i.id
      where i.is_active and i.kind in ('raw', 'packaging')
      order by (coalesce(pn.qty, 0) + coalesce(i.min_stock, 0)
                - coalesce(st.available, 0) - coalesce(oo.qty, 0)) desc, i.name`,
  );
  return rows.map((r) => ({ ...r, shortage: Math.round(Number(r.shortage) * 1000) / 1000 }));
}
