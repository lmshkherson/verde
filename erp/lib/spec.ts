import type { Pool, PoolClient } from 'pg';
import { pool } from '@/lib/db';
import type { RecipeIngredient } from '@/lib/nutrition';

export interface RecipeForSpec {
  recipeId: string;
  recipeVersion: number;
  outputQty: number;
  ingredients: RecipeIngredient[];
  /** Алергени, оголошені самим продуктом: типово сліди зі спільної лінії. */
  productAllergens: { code: string; name: string; kind: string }[];
}

/**
 * Компоненти чинної рецептури разом із поживним складом і алергенами.
 *
 * Береться саме `qty_per_batch` без надбавки на втрати: відсоток втрат — це
 * те, що не доїхало до продукту (розсипалось, лишилось на обладнанні), і в
 * батончику його немає. Закладати його в харчову цінність означало б
 * завищити всі показники на етикетці.
 */
export async function loadRecipeForSpec(
  itemId: string,
  client: Pool | PoolClient = pool,
): Promise<RecipeForSpec | null> {
  const { rows: recipes } = await client.query<{
    id: string;
    version: number;
    output_qty: number;
  }>(
    `select id, version, output_qty from recipes
      where product_item_id = $1 and is_active
        and approved_at is not null and effective_from <= current_date
      order by effective_from desc, version desc limit 1`,
    [itemId],
  );
  if (!recipes[0]) return null;

  const { rows: ingredients } = await client.query<RecipeIngredient>(
    `select rl.item_id, i.name, i.label_name, i.kind, i.unit, rl.qty_per_batch,
            i.kcal_100, i.protein_100, i.fat_100, i.fat_sat_100,
            i.carbs_100, i.sugars_100, i.polyols_100, i.fiber_100, i.salt_100,
            coalesce(
              (select json_agg(json_build_object('code', a.code, 'name', a.name, 'kind', ia.kind)
                               order by a.sort_order)
                 from item_allergens ia join allergens a on a.code = ia.allergen_code
                where ia.item_id = i.id),
              '[]'::json
            ) as allergens
       from recipe_lines rl
       join items i on i.id = rl.item_id
      where rl.recipe_id = $1
      order by rl.qty_per_batch desc`,
    [recipes[0].id],
  );

  const { rows: own } = await client.query<{ code: string; name: string; kind: string }>(
    `select a.code, a.name, ia.kind
       from item_allergens ia join allergens a on a.code = ia.allergen_code
      where ia.item_id = $1
      order by a.sort_order`,
    [itemId],
  );

  return {
    recipeId: recipes[0].id,
    recipeVersion: recipes[0].version,
    outputQty: Number(recipes[0].output_qty),
    ingredients,
    productAllergens: own,
  };
}
