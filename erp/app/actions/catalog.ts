'use server';

import { revalidatePath } from 'next/cache';
import { transaction } from '@/lib/db';
import { type ActionState, num, str, strOrNull, toMessage } from '@/lib/action-state';
import { requireRole } from '@/lib/session';

export async function createItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('production', 'sales', 'warehouse');
  const sku = str(formData, 'sku');
  const name = str(formData, 'name');
  const kind = str(formData, 'kind');
  const unit = str(formData, 'unit');

  if (!sku) return { error: 'Вкажіть артикул (SKU)' };
  if (!name) return { error: 'Вкажіть назву' };
  if (!kind || !unit) return { error: 'Оберіть тип і одиницю виміру' };

  try {
    await transaction((c) =>
      c.query(
        `insert into items
           (sku, name, kind, unit, shelf_life_days, min_stock, weight_g, pcs_per_box,
            price_distributor, price_network, price_rrp, note)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          sku,
          name,
          kind,
          unit,
          num(formData, 'shelf_life_days') || null,
          num(formData, 'min_stock'),
          num(formData, 'weight_g') || null,
          num(formData, 'pcs_per_box') || null,
          num(formData, 'price_distributor') || null,
          num(formData, 'price_network') || null,
          num(formData, 'price_rrp') || null,
          strOrNull(formData, 'note'),
        ],
      ),
    );
  } catch (err) {
    const message = toMessage(err);
    return {
      error: message.includes('items_sku_key') ? `Артикул ${sku} вже існує` : message,
    };
  }

  revalidatePath('/catalog');
  return { ok: 'Номенклатуру додано' };
}

export async function updateItemStockRules(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('production', 'sales', 'warehouse');
  const id = str(formData, 'item_id');
  if (!id) return { error: 'Не вказано номенклатуру' };

  try {
    await transaction((c) =>
      c.query(
        `update items
            set min_stock = $2, shelf_life_days = $3,
                price_distributor = $4, price_network = $5, price_rrp = $6
          where id = $1`,
        [
          id,
          num(formData, 'min_stock'),
          num(formData, 'shelf_life_days') || null,
          num(formData, 'price_distributor') || null,
          num(formData, 'price_network') || null,
          num(formData, 'price_rrp') || null,
        ],
      ),
    );
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/catalog');
  return { ok: 'Збережено' };
}
