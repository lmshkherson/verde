'use server';

import { revalidatePath } from 'next/cache';
import { transaction } from '@/lib/db';
import { type ActionState, num, str, strOrNull, toMessage } from '@/lib/action-state';
import { requireRole } from '@/lib/session';
import { allergenText, calculateSpec, compositionText } from '@/lib/nutrition';
import { loadRecipeForSpec } from '@/lib/spec';

/** Порожнє поле означає «даних немає», а не нуль — і так і зберігається. */
function optional(formData: FormData, key: string): number | null {
  return str(formData, key) === '' ? null : num(formData, key);
}

export async function saveNutrition(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('production');
  const itemId = str(formData, 'item_id');
  if (!itemId) return { error: 'Не вказано позицію' };

  const fat = optional(formData, 'fat_100');
  const fatSat = optional(formData, 'fat_sat_100');
  const carbs = optional(formData, 'carbs_100');
  const sugars = optional(formData, 'sugars_100');
  const polyols = optional(formData, 'polyols_100');

  // Перевірки, які ловлять описку до того, як вона поїде в типографію.
  if (fat !== null && fatSat !== null && fatSat > fat + 0.01) {
    return { error: 'Насичених жирів більше, ніж жирів усього' };
  }
  if (carbs !== null && sugars !== null && sugars > carbs + 0.01) {
    return { error: 'Цукрів більше, ніж вуглеводів усього' };
  }
  if (carbs !== null && polyols !== null && polyols > carbs + 0.01) {
    return { error: 'Багатоатомних спиртів більше, ніж вуглеводів усього' };
  }

  try {
    await transaction((c) =>
      c.query(
        `update items set
           kcal_100 = $2, protein_100 = $3, fat_100 = $4, fat_sat_100 = $5,
           carbs_100 = $6, sugars_100 = $7, polyols_100 = $8, fiber_100 = $9,
           salt_100 = $10, label_name = $11, nutrition_source = $12, country_of_origin = $13
         where id = $1`,
        [
          itemId,
          optional(formData, 'kcal_100'),
          optional(formData, 'protein_100'),
          fat,
          fatSat,
          carbs,
          sugars,
          polyols,
          optional(formData, 'fiber_100'),
          optional(formData, 'salt_100'),
          strOrNull(formData, 'label_name'),
          strOrNull(formData, 'nutrition_source'),
          strOrNull(formData, 'country_of_origin'),
        ],
      ),
    );
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/catalog/${itemId}`);
  revalidatePath('/labeling');
  return { ok: 'Поживний склад збережено' };
}

/**
 * Алергени позиції. Приходять як набір галочок «містить» і «сліди»; перелік
 * закритий, бо це перелік із закону, а не вільний опис.
 */
export async function saveAllergens(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('production');
  const itemId = str(formData, 'item_id');
  if (!itemId) return { error: 'Не вказано позицію' };

  try {
    await transaction(async (c) => {
      const { rows: all } = await c.query<{ code: string }>('select code from allergens');
      await c.query('delete from item_allergens where item_id = $1', [itemId]);

      for (const { code } of all) {
        const value = str(formData, `allergen_${code}`);
        if (value !== 'contains' && value !== 'traces') continue;
        await c.query(
          'insert into item_allergens (item_id, allergen_code, kind) values ($1, $2, $3)',
          [itemId, code, value],
        );
      }
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath(`/catalog/${itemId}`);
  revalidatePath(`/labeling/${itemId}`);
  return { ok: 'Алергени збережено' };
}

/**
 * Затвердження специфікації.
 *
 * Розрахунок заморожується разом із версією рецептури. Етикетку друкують
 * тиражем, і через півроку треба вміти відповісти, за яким саме складом
 * надрукована пачка, що лежить у мережі. Тому це не «збережений звіт», а
 * версійований документ.
 */
export async function approveSpec(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('production');
  const itemId = str(formData, 'item_id');
  if (!itemId) return { error: 'Не вказано продукт' };

  try {
    await transaction(async (c) => {
      const { rows: items } = await c.query<{
        name: string;
        weight_g: number | null;
        shelf_life_days: number | null;
        temp_min_c: number | null;
        temp_max_c: number | null;
        temp_note: string | null;
        country_of_origin: string | null;
      }>(
        `select name, weight_g, shelf_life_days, temp_min_c, temp_max_c, temp_note,
                country_of_origin
           from items where id = $1`,
        [itemId],
      );
      const item = items[0];
      if (!item) throw new Error('Продукт не знайдено');

      const recipe = await loadRecipeForSpec(itemId, c);
      if (!recipe) throw new Error('У продукту немає чинної рецептури');

      const calc = calculateSpec(
        recipe.ingredients,
        recipe.outputQty,
        item.weight_g,
        recipe.productAllergens,
      );
      if (calc.problems.length > 0) {
        throw new Error(`Специфікацію не можна затвердити: ${calc.problems[0]}`);
      }

      const { rows: entity } = await c.query<{ name: string; address: string | null }>(
        'select name, address from legal_entities where id = $1',
        [session.eid],
      );

      const storage =
        item.temp_min_c !== null || item.temp_max_c !== null
          ? `Зберігати за температури ${item.temp_min_c ?? '−∞'}…${item.temp_max_c ?? '+∞'} °C${
              item.temp_note ? `, ${item.temp_note}` : ''
            }`
          : (item.temp_note ?? null);

      const { rows: versions } = await c.query<{ next: number }>(
        'select coalesce(max(version), 0) + 1 as next from product_specs where item_id = $1',
        [itemId],
      );

      await c.query(
        `insert into product_specs
           (item_id, recipe_id, recipe_version, version, net_weight_g, shelf_life_days,
            storage_text, composition_text, allergen_text, traces_text, nutrition,
            producer_text, country, note, approved_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          itemId,
          recipe.recipeId,
          recipe.recipeVersion,
          versions[0].next,
          item.weight_g,
          item.shelf_life_days,
          storage,
          compositionText(calc.composition),
          allergenText(calc.contains),
          calc.traces.length > 0 ? allergenText(calc.traces) : null,
          JSON.stringify({
            per100: calc.per100,
            perPortion: calc.perPortion,
            portionG: calc.portionG,
            inputG: calc.inputG,
            outputG: calc.outputG,
            lossPct: calc.lossPct,
            composition: calc.composition,
            contains: calc.contains,
            traces: calc.traces,
          }),
          entity[0] ? `${entity[0].name}${entity[0].address ? `, ${entity[0].address}` : ''}` : null,
          item.country_of_origin ?? 'Україна',
          strOrNull(formData, 'note'),
          session.uid,
        ],
      );

      await c.query(
        `insert into audit_log (user_id, action, entity, entity_id, details)
         values ($1, 'approve', 'product_spec', $2, $3)`,
        [session.uid, itemId, JSON.stringify({ version: versions[0].next, recipe: recipe.recipeVersion })],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/labeling');
  revalidatePath(`/labeling/${itemId}`);
  return { ok: 'Специфікацію затверджено' };
}

/** Відкликання специфікації — коли етикетку більше не можна використовувати. */
export async function revokeSpec(formData: FormData) {
  await requireRole('production');
  const itemId = str(formData, 'item_id');
  await transaction((c) =>
    c.query("update product_specs set status = 'revoked' where id = $1", [str(formData, 'spec_id')]),
  );
  revalidatePath('/labeling');
  revalidatePath(`/labeling/${itemId}`);
}
