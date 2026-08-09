/**
 * Харчова цінність і склад із рецептури.
 *
 * Розрахунок ведеться на фактичну масу випуску, а не на суму закладки. Це
 * важливо: під час варки частина вологи випаровується, тож 25,5 кг сировини
 * дають 25 кг продукту, і всі показники в ньому концентрованіші. Ділення на
 * фактичний вихід ловить це саме собою.
 *
 * Енергетична цінність не сумується з ккал інгредієнтів, а рахується з
 * нутрієнтів за нормативними коефіцієнтами (додаток до ЗУ № 2639-VIII, він же
 * додаток XIV до Регламенту (ЄС) № 1169/2011). Так вимагає закон, і так само
 * зникає розбіжність між «сумою ккал» і таблицею на етикетці.
 */

/** ккал на грам поживної речовини. */
export const KCAL_PER_G = {
  protein: 4,
  fat: 9,
  /** Вуглеводи без багатоатомних спиртів. */
  carbs: 4,
  polyols: 2.4,
  fiber: 2,
} as const;

/** кДж на грам — окремі коефіцієнти, а не переведення ккал × 4,184. */
export const KJ_PER_G = {
  protein: 17,
  fat: 37,
  carbs: 17,
  polyols: 10,
  fiber: 8,
} as const;

export interface ItemNutrition {
  kcal_100: number | null;
  protein_100: number | null;
  fat_100: number | null;
  fat_sat_100: number | null;
  carbs_100: number | null;
  sugars_100: number | null;
  polyols_100: number | null;
  fiber_100: number | null;
  salt_100: number | null;
}

export interface RecipeIngredient extends ItemNutrition {
  item_id: string;
  name: string;
  label_name: string | null;
  kind: string;
  unit: string;
  /** Чиста закладка на варку, без надбавки на втрати. */
  qty_per_batch: number;
  allergens: { code: string; name: string; kind: string }[];
}

export interface Nutrition {
  kcal: number;
  kj: number;
  protein: number;
  fat: number;
  fatSat: number;
  carbs: number;
  sugars: number;
  polyols: number;
  fiber: number;
  salt: number;
}

export interface CompositionLine {
  name: string;
  grams: number;
  percent: number;
  allergenCodes: string[];
}

export interface SpecCalculation {
  /** Їстівні інгредієнти в порядку спадання маси. */
  composition: CompositionLine[];
  per100: Nutrition;
  perPortion: Nutrition;
  portionG: number;
  /** Маса закладки й маса випуску — різниця показує втрату вологи. */
  inputG: number;
  outputG: number;
  lossPct: number;
  contains: { code: string; name: string }[];
  traces: { code: string; name: string }[];
  /** Чому специфікацію ще не можна затверджувати. */
  problems: string[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Одиниці рецептури зводимо до грамів. Штуки тут — це пакування, воно не їстівне. */
function toGrams(qty: number, unit: string): number {
  if (unit === 'kg') return qty * 1000;
  if (unit === 'g') return qty;
  // Літри вважаємо за густиною 1: для сиропів і олій похибка менша за точність
  // самих даних постачальника, а домішувати густину в довідник заради цього
  // не варто.
  if (unit === 'l') return qty * 1000;
  if (unit === 'ml') return qty;
  return 0;
}

const EDIBLE_KINDS = ['raw', 'semi'];

export function calculateSpec(
  ingredients: RecipeIngredient[],
  outputQty: number,
  weightG: number | null,
  /**
   * Алергени самого продукту. Сліди арахісу зазвичай беруться не з
   * інгредієнта, а зі спільної лінії, тож оголошує їх продукт, а не сировина.
   */
  productAllergens: { code: string; name: string; kind: string }[] = [],
): SpecCalculation {
  const problems: string[] = [];
  const edible = ingredients.filter((i) => EDIBLE_KINDS.includes(i.kind));

  if (edible.length === 0) problems.push('У рецептурі немає жодного їстівного компонента');
  if (!weightG || weightG <= 0) {
    problems.push('У картці продукту не вказана вага одиниці — без неї немає на що ділити');
  }

  const lines = edible.map((i) => ({
    ingredient: i,
    grams: toGrams(Number(i.qty_per_batch), i.unit),
  }));

  const inputG = lines.reduce((s, l) => s + l.grams, 0);
  const outputG = (weightG ?? 0) * outputQty;

  for (const l of lines) {
    if (l.grams <= 0) {
      problems.push(`«${l.ingredient.name}»: одиниця виміру не переводиться у грами`);
    }
    const n = l.ingredient;
    const missing = [
      n.protein_100 === null && 'білки',
      n.fat_100 === null && 'жири',
      n.carbs_100 === null && 'вуглеводи',
    ].filter(Boolean);
    if (missing.length > 0) {
      problems.push(`«${n.name}»: немає даних (${missing.join(', ')})`);
    }
  }

  if (outputG > 0 && inputG > 0 && outputG > inputG * 1.02) {
    problems.push(
      `Маса випуску (${round1(outputG / 1000)} кг) більша за закладку (${round1(inputG / 1000)} кг) — перевірте рецептуру або вагу одиниці`,
    );
  }

  // Сума кожного показника по всій закладці, у грамах.
  const totals = { protein: 0, fat: 0, fatSat: 0, carbs: 0, sugars: 0, polyols: 0, fiber: 0, salt: 0 };
  for (const l of lines) {
    const factor = l.grams / 100;
    const n = l.ingredient;
    totals.protein += (n.protein_100 ?? 0) * factor;
    totals.fat += (n.fat_100 ?? 0) * factor;
    totals.fatSat += (n.fat_sat_100 ?? 0) * factor;
    totals.carbs += (n.carbs_100 ?? 0) * factor;
    totals.sugars += (n.sugars_100 ?? 0) * factor;
    totals.polyols += (n.polyols_100 ?? 0) * factor;
    totals.fiber += (n.fiber_100 ?? 0) * factor;
    totals.salt += (n.salt_100 ?? 0) * factor;
  }

  const scale = outputG > 0 ? 100 / outputG : 0;
  const per100 = nutritionFrom({
    protein: totals.protein * scale,
    fat: totals.fat * scale,
    fatSat: totals.fatSat * scale,
    carbs: totals.carbs * scale,
    sugars: totals.sugars * scale,
    polyols: totals.polyols * scale,
    fiber: totals.fiber * scale,
    salt: totals.salt * scale,
  });

  const portionG = weightG ?? 0;
  const perPortion = scaleNutrition(per100, portionG / 100);

  const composition: CompositionLine[] = lines
    .map((l) => ({
      name: l.ingredient.label_name ?? l.ingredient.name,
      grams: l.grams,
      percent: inputG > 0 ? (l.grams / inputG) * 100 : 0,
      allergenCodes: l.ingredient.allergens.filter((a) => a.kind === 'contains').map((a) => a.code),
    }))
    .sort((a, b) => b.grams - a.grams);

  const contains = new Map<string, string>();
  const traces = new Map<string, string>();
  for (const a of [...edible.flatMap((i) => i.allergens), ...productAllergens]) {
    if (a.kind === 'contains') contains.set(a.code, a.name);
    else traces.set(a.code, a.name);
  }
  // Алерген, який уже є у складі, не повторюємо в «слідах»: споживача це
  // тільки заплутає, а вимоги дублювати немає.
  for (const code of contains.keys()) traces.delete(code);

  return {
    composition,
    per100,
    perPortion,
    portionG,
    inputG: round1(inputG),
    outputG: round1(outputG),
    lossPct: inputG > 0 ? round2(((inputG - outputG) / inputG) * 100) : 0,
    contains: [...contains].map(([code, name]) => ({ code, name })),
    traces: [...traces].map(([code, name]) => ({ code, name })),
    problems,
  };
}

function nutritionFrom(v: Omit<Nutrition, 'kcal' | 'kj'>): Nutrition {
  // Багатоатомні спирти входять у вуглеводи, тож із коефіцієнтом 4 рахуємо
  // лише решту вуглеводів, а спирти — за своїм.
  const digestible = Math.max(v.carbs - v.polyols, 0);
  const kcal =
    v.protein * KCAL_PER_G.protein +
    v.fat * KCAL_PER_G.fat +
    digestible * KCAL_PER_G.carbs +
    v.polyols * KCAL_PER_G.polyols +
    v.fiber * KCAL_PER_G.fiber;
  const kj =
    v.protein * KJ_PER_G.protein +
    v.fat * KJ_PER_G.fat +
    digestible * KJ_PER_G.carbs +
    v.polyols * KJ_PER_G.polyols +
    v.fiber * KJ_PER_G.fiber;

  return {
    kcal: Math.round(kcal),
    kj: Math.round(kj),
    protein: round1(v.protein),
    fat: round1(v.fat),
    fatSat: round1(v.fatSat),
    carbs: round1(v.carbs),
    sugars: round1(v.sugars),
    polyols: round1(v.polyols),
    fiber: round1(v.fiber),
    salt: round2(v.salt),
  };
}

function scaleNutrition(n: Nutrition, k: number): Nutrition {
  return {
    kcal: Math.round(n.kcal * k),
    kj: Math.round(n.kj * k),
    protein: round1(n.protein * k),
    fat: round1(n.fat * k),
    fatSat: round1(n.fatSat * k),
    carbs: round1(n.carbs * k),
    sugars: round1(n.sugars * k),
    polyols: round1(n.polyols * k),
    fiber: round1(n.fiber * k),
    salt: round2(n.salt * k),
  };
}

/**
 * Склад одним рядком, як він друкується.
 *
 * Відсоток ставимо в інгредієнтів вагою від 2%: закон вимагає кількісного
 * зазначення там, де інгредієнт винесено в назву чи він визначає продукт, і
 * простіше показати всі значущі, ніж вгадувати намір маркетингу.
 */
export function compositionText(lines: CompositionLine[]): string {
  return lines
    .map((l) => (l.percent >= 2 ? `${l.name} ${round1(l.percent)}%` : l.name))
    .join(', ');
}

export function allergenText(contains: { name: string }[]): string {
  return contains.length === 0 ? '' : contains.map((a) => a.name).join(', ');
}
