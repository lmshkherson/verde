import { query } from '@/lib/db';

/**
 * Простежуваність партії в обидва боки — те, що закон називає «крок назад» і
 * «крок вперед».
 *
 * Ланцюжок будується рекурсивно, бо між сировиною й готовою продукцією може
 * стояти напівфабрикат, а то й кілька. Глибина обмежена: цикл у даних
 * теоретично неможливий, але покладатися на це в запиті, який запускають у
 * день аварії, не варто.
 */

const MAX_DEPTH = 8;

export interface BatchNode {
  batch_id: string;
  code: string;
  item_name: string;
  sku: string;
  unit: string;
  expires_on: string | null;
  depth: number;
  production_number: string | null;
  production_order_id: string | null;
}

/** Куди партія пішла: усе, що з неї виготовлено, на будь-якій глибині. */
export function descendants(batchId: string) {
  return query<BatchNode>(
    `with recursive fwd as (
       select b.id as batch_id, 0 as depth
         from batches b where b.id = $1
       union
       select e.result_batch_id, f.depth + 1
         from fwd f
         join v_batch_edges e on e.source_batch_id = f.batch_id
        where f.depth < ${MAX_DEPTH}
     )
     select f.batch_id, f.depth, b.code, b.expires_on,
            i.name as item_name, i.sku, i.unit,
            o.production_number, o.production_order_id
       from fwd f
       join batches b on b.id = f.batch_id
       join items i on i.id = b.item_id
       left join v_batch_origin o on o.batch_id = f.batch_id
      where f.depth > 0
      order by f.depth, i.name`,
    [batchId],
  );
}

/** Звідки партія взялася: уся сировина, що в ній опинилася. */
export function ancestors(batchId: string) {
  return query<BatchNode>(
    `with recursive back as (
       select b.id as batch_id, 0 as depth
         from batches b where b.id = $1
       union
       select e.source_batch_id, r.depth + 1
         from back r
         join v_batch_edges e on e.result_batch_id = r.batch_id
        where r.depth < ${MAX_DEPTH}
     )
     select r.batch_id, r.depth, b.code, b.expires_on,
            i.name as item_name, i.sku, i.unit,
            o.production_number, o.production_order_id
       from back r
       join batches b on b.id = r.batch_id
       join items i on i.id = b.item_id
       left join v_batch_origin o on o.batch_id = r.batch_id
      where r.depth > 0
      order by r.depth, i.name`,
    [batchId],
  );
}

export interface AffectedShipment {
  batch_id: string;
  batch_code: string;
  shipment_id: string;
  shipment_number: string;
  shipped_on: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  item_id: string;
  item_name: string;
  unit: string;
  qty: number;
}

/**
 * Кому поїхало все, що походить від цієї партії, — включно з нею самою.
 * Це і є відповідь на питання, заради якого простежуваність існує.
 */
export function affectedShipments(batchId: string, entityId: string) {
  return query<AffectedShipment>(
    `with recursive fwd as (
       select b.id as batch_id, 0 as depth
         from batches b where b.id = $1
       union
       select e.result_batch_id, f.depth + 1
         from fwd f
         join v_batch_edges e on e.source_batch_id = f.batch_id
        where f.depth < ${MAX_DEPTH}
     )
     select s.batch_id, b.code as batch_code, s.shipment_id, s.shipment_number,
            s.shipped_on, s.customer_id, s.customer_name, s.customer_phone,
            s.item_id, i.name as item_name, i.unit, s.qty
       from fwd f
       join v_batch_shipments s on s.batch_id = f.batch_id
       join batches b on b.id = s.batch_id
       join items i on i.id = s.item_id
      where s.legal_entity_id = $2
      order by s.shipped_on desc, s.customer_name`,
    [batchId, entityId],
  );
}

export const RECALL_REASONS: Record<string, string> = {
  quality: 'Невідповідна якість',
  contamination: 'Забруднення / стороннє тіло',
  labeling: 'Помилка маркування',
  expiry: 'Помилка в терміні придатності',
  other: 'Інше',
};

export const RECALL_STATUS: Record<string, string> = {
  draft: 'Підготовка',
  announced: 'Оголошено',
  closed: 'Завершено',
  cancelled: 'Скасовано',
};
