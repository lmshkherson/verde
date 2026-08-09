'use server';

import { revalidatePath } from 'next/cache';
import { transaction } from '@/lib/db';
import { type ActionState, num, str, strOrNull, toMessage } from '@/lib/action-state';
import { requireRole } from '@/lib/session';
import { normalizeEan } from '@/lib/barcode.mjs';

/**
 * Порожній штрихкод — це нормально, а от помилковий гірший за відсутній:
 * сканер на складі мовчки віддасть чужий товар. Тому контрольна цифра
 * перевіряється тут, а не десь у формі.
 */
function readBarcode(formData: FormData): { value: string | null } | { error: string } {
  const raw = str(formData, 'barcode');
  if (!raw) return { value: null };
  const result = normalizeEan(raw);
  return 'error' in result ? result : { value: result.ean };
}

/**
 * Діапазон температури. Порожні поля — це «режим не задано», а не нуль:
 * нуль градусів і відсутність вимоги — різні речі, і плутати їх у харчовому
 * виробництві дорого.
 */
function readTemp(formData: FormData): { min: number | null; max: number | null } | { error: string } {
  const raw = (key: string) => str(formData, key);
  const min = raw('temp_min_c') === '' ? null : num(formData, 'temp_min_c');
  const max = raw('temp_max_c') === '' ? null : num(formData, 'temp_max_c');
  if (min !== null && max !== null && min > max) {
    return { error: `Нижня межа ${min} °C вища за верхню ${max} °C` };
  }
  return { min, max };
}

export async function createItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('production', 'sales', 'warehouse');
  const sku = str(formData, 'sku');
  const name = str(formData, 'name');
  const kind = str(formData, 'kind');
  const unit = str(formData, 'unit');

  if (!sku) return { error: 'Вкажіть артикул (SKU)' };
  if (!name) return { error: 'Вкажіть назву' };
  if (!kind || !unit) return { error: 'Оберіть тип і одиницю виміру' };

  const barcode = readBarcode(formData);
  if ('error' in barcode) return { error: barcode.error };
  const temp = readTemp(formData);
  if ('error' in temp) return { error: temp.error };

  try {
    await transaction((c) =>
      c.query(
        `insert into items
           (sku, name, kind, unit, shelf_life_days, min_stock, weight_g, pcs_per_box,
            price_distributor, price_network, price_rrp, uktzed, uom_code, note, barcode,
            temp_min_c, temp_max_c, temp_note)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
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
          strOrNull(formData, 'uktzed'),
          strOrNull(formData, 'uom_code'),
          strOrNull(formData, 'note'),
          barcode.value,
          temp.min,
          temp.max,
          strOrNull(formData, 'temp_note'),
        ],
      ),
    );
  } catch (err) {
    const message = toMessage(err);
    return {
      error: message.includes('items_sku_key')
        ? `Артикул ${sku} вже існує`
        : message.includes('items_barcode_key')
          ? `Штрихкод ${barcode.value} уже закріплений за іншою позицією`
          : message,
    };
  }

  revalidatePath('/catalog');
  return { ok: 'Номенклатуру додано' };
}

/**
 * Редагування позиції. Одиницю виміру й тип змінити не можна, щойно по позиції
 * пройшов хоч один рух: залишок і собівартість рахуються в цих одиницях, і зміна
 * заднім числом мовчки зіпсувала б усю історію.
 */
export async function updateItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('production', 'sales', 'warehouse');
  const id = str(formData, 'item_id');
  const sku = str(formData, 'sku');
  const name = str(formData, 'name');
  const kind = str(formData, 'kind');
  const unit = str(formData, 'unit');

  if (!id) return { error: 'Не вказано номенклатуру' };
  if (!sku || !name) return { error: 'Артикул і назва обов’язкові' };

  const barcode = readBarcode(formData);
  if ('error' in barcode) return { error: barcode.error };
  const temp = readTemp(formData);
  if ('error' in temp) return { error: temp.error };

  try {
    await transaction(async (c) => {
      const { rows: current } = await c.query<{ kind: string; unit: string; moves: number }>(
        `select i.kind, i.unit,
                (select count(*) from stock_moves m where m.item_id = i.id)::int as moves
           from items i where i.id = $1`,
        [id],
      );
      if (!current[0]) throw new Error('Позицію не знайдено');

      if (current[0].moves > 0) {
        if (current[0].unit !== unit) {
          throw new Error(
            `Одиницю виміру не можна змінити: по позиції вже є ${current[0].moves} рухів. ` +
              'Заведіть нову позицію й деактивуйте цю.',
          );
        }
        if (current[0].kind !== kind) {
          throw new Error(
            'Тип не можна змінити: по позиції вже є рухи, а від типу залежить рахунок обліку.',
          );
        }
      }

      await c.query(
        `update items set
           sku = $2, name = $3, kind = $4, unit = $5,
           shelf_life_days = $6, min_stock = $7, weight_g = $8, pcs_per_box = $9,
           price_distributor = $10, price_network = $11, price_rrp = $12,
           uktzed = $13, uom_code = $14, note = $15, vat_rate = $16, barcode = $17,
           temp_min_c = $18, temp_max_c = $19, temp_note = $20
         where id = $1`,
        [
          id,
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
          strOrNull(formData, 'uktzed'),
          strOrNull(formData, 'uom_code'),
          strOrNull(formData, 'note'),
          num(formData, 'vat_rate', 20),
          barcode.value,
          temp.min,
          temp.max,
          strOrNull(formData, 'temp_note'),
        ],
      );
    });
  } catch (err) {
    const message = toMessage(err);
    return {
      error: message.includes('items_sku_key')
        ? `Артикул ${sku} вже зайнятий`
        : message.includes('items_barcode_key')
          ? `Штрихкод ${barcode.value} уже закріплений за іншою позицією`
          : message,
    };
  }

  revalidatePath('/catalog');
  revalidatePath(`/catalog/${id}`);
  return { ok: 'Збережено' };
}

/**
 * Деактивація замість видалення: позиція зникає зі списків вибору, але всі
 * документи, партії й проводки з нею лишаються цілими. Видалення тут не
 * передбачене свідомо — воно зруйнувало б історію складу й проводки.
 */
export async function setItemActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('production', 'sales', 'warehouse');
  const id = str(formData, 'item_id');
  const active = str(formData, 'active') === 'true';

  try {
    await transaction(async (c) => {
      // Складські екрани показують лише активні позиції, тож деактивація з
      // ненульовим залишком просто сховала б товар разом із його вартістю.
      if (!active) {
        const { rows } = await c.query<{ qty: number }>(
          'select coalesce(sum(qty), 0) as qty from stock_moves where item_id = $1',
          [id],
        );
        if (Math.abs(Number(rows[0].qty)) > 0.0005) {
          throw new Error(
            `Не можна деактивувати: на складі ще ${Number(rows[0].qty)}. Спишіть або продайте залишок.`,
          );
        }
      }
      await c.query('update items set is_active = $2 where id = $1', [id, active]);
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/catalog');
  revalidatePath(`/catalog/${id}`);
  return { ok: active ? 'Позицію активовано' : 'Позицію деактивовано' };
}
