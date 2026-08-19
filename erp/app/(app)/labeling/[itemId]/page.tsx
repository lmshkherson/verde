import Link from 'next/link';
import { notFound } from 'next/navigation';
import { approveSpec, revokeSpec } from '@/app/actions/labeling';
import { ActionForm } from '@/components/action-form';
import { Barcode } from '@/components/barcode';
import { PrintButton } from '@/components/print-button';
import {
  Alert,
  Badge,
  Button,
  Card,
  Cell,
  Empty,
  Field,
  LinkButton,
  PageHeader,
  Row,
  Stat,
  Table,
  inputClass,
} from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { fmtDate, fmtQty } from '@/lib/format';
import { calculateSpec, compositionText } from '@/lib/nutrition';
import { loadRecipeForSpec } from '@/lib/spec';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function ProductSpecPage({ params }: { params: Promise<{ itemId: string }> }) {
  const session = await requireRole('production', 'sales');
  const { itemId } = await params;

  const item = await queryOne<{
    id: string;
    sku: string;
    name: string;
    label_name: string | null;
    weight_g: number | null;
    pcs_per_box: number | null;
    shelf_life_days: number | null;
    barcode: string | null;
    temp_min_c: number | null;
    temp_max_c: number | null;
    temp_note: string | null;
    country_of_origin: string | null;
  }>(
    `select id, sku, name, label_name, weight_g, pcs_per_box, shelf_life_days, barcode,
            temp_min_c, temp_max_c, temp_note, country_of_origin
       from items where id = $1`,
    [itemId],
  );
  if (!item) notFound();

  const [recipe, spec, entity, history] = await Promise.all([
    loadRecipeForSpec(itemId),
    queryOne<{
      id: string;
      version: number;
      recipe_version: number;
      current_recipe_version: number;
      recipe_changed: boolean;
      approved_on: string;
      composition_text: string;
      allergen_text: string | null;
      traces_text: string | null;
      storage_text: string | null;
      producer_text: string | null;
      country: string | null;
      net_weight_g: number | null;
      shelf_life_days: number | null;
      nutrition: {
        per100: Record<string, number>;
        perPortion: Record<string, number>;
        portionG: number;
      };
    }>('select * from v_current_spec where item_id = $1', [itemId]),
    queryOne<{ name: string; address: string | null; phone: string | null }>(
      'select name, address, phone from legal_entities where id = $1',
      [session.eid],
    ),
    query<{ id: string; version: number; approved_on: string; status: string; recipe_version: number }>(
      `select id, version, approved_on, status, recipe_version from product_specs
        where item_id = $1 order by version desc limit 10`,
      [itemId],
    ),
  ]);

  const calc = recipe
    ? calculateSpec(recipe.ingredients, recipe.outputQty, item.weight_g, recipe.productAllergens)
    : null;

  const NUTRIENTS: [string, keyof NonNullable<typeof calc>['per100'], string][] = [
    ['Енергетична цінність', 'kcal', 'ккал'],
    ['Жири', 'fat', 'г'],
    ['у т.ч. насичені', 'fatSat', 'г'],
    ['Вуглеводи', 'carbs', 'г'],
    ['у т.ч. цукри', 'sugars', 'г'],
    ['у т.ч. багатоатомні спирти', 'polyols', 'г'],
    ['Харчові волокна', 'fiber', 'г'],
    ['Білки', 'protein', 'г'],
    ['Сіль', 'salt', 'г'],
  ];

  const expiry = item.shelf_life_days
    ? new Date(Date.now() + item.shelf_life_days * 86_400_000)
    : null;

  return (
    <>
      <div className="no-print">
        <PageHeader
          title={item.name}
          subtitle={`${item.sku} · ${item.weight_g ? `${item.weight_g} г` : 'вага не вказана'}`}
          action={
            <div className="flex flex-wrap gap-2">
              <LinkButton href={`/catalog/${item.id}`}>Картка позиції</LinkButton>
              <LinkButton href="/labeling">← До маркування</LinkButton>
              {spec && <PrintButton label="Друк етикетки" />}
            </div>
          }
        />

        {!recipe ? (
          <Alert tone="amber">
            У продукту немає чинної рецептури — рахувати склад немає з чого.{' '}
            <Link href="/production/recipes" className="underline">
              Заведіть рецептуру
            </Link>
            .
          </Alert>
        ) : (
          <>
            {spec?.recipe_changed && (
              <div className="mb-4">
                <Alert tone="red">
                  Специфікація затверджена за рецептурою версії {spec.recipe_version}, а чинна вже{' '}
                  {spec.current_recipe_version}. Етикетку, надруковану за старою версією,
                  використовувати не можна — перерахуйте й затвердьте заново.
                </Alert>
              </div>
            )}

            {calc && (
              <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Енергетична цінність" value={`${calc.per100.kcal} ккал`} hint="на 100 г" />
                <Stat
                  label="На порцію"
                  value={`${calc.perPortion.kcal} ккал`}
                  hint={`${calc.portionG} г — один батончик`}
                />
                <Stat
                  label="Цукри на 100 г"
                  value={`${calc.per100.sugars} г`}
                  hint="природні цукри сировини"
                  tone={calc.per100.sugars > 5 ? 'warn' : 'good'}
                />
                <Stat
                  label="Втрата вологи"
                  value={`${calc.lossPct}%`}
                  hint={`закладка ${fmtQty(calc.inputG / 1000)} кг → вихід ${fmtQty(calc.outputG / 1000)} кг`}
                />
              </div>
            )}

            {calc && calc.problems.length > 0 && (
              <div className="mb-4">
                <Alert tone="amber">
                  <div className="font-semibold">Специфікацію ще не можна затвердити:</div>
                  <ul className="mt-1 list-disc pl-5">
                    {calc.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </Alert>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
              <div className="space-y-4">
                <Card title="Склад">
                  {calc && (
                    <>
                      <p className="mb-3 rounded-xl bg-emerald-50/60 p-3 text-sm text-emerald-900">
                        {compositionText(calc.composition)}
                      </p>
                      <Table head={['Інгредієнт', 'На варку', 'Частка', 'Алергени']}>
                        {calc.composition.map((line) => (
                          <Row key={line.name}>
                            <Cell>{line.name}</Cell>
                            <Cell align="right">{fmtQty(line.grams / 1000)} кг</Cell>
                            <Cell align="right">{line.percent.toFixed(1)}%</Cell>
                            <Cell>
                              {line.allergenCodes.length > 0 ? (
                                <Badge tone="amber">{line.allergenCodes.length}</Badge>
                              ) : (
                                '—'
                              )}
                            </Cell>
                          </Row>
                        ))}
                      </Table>
                    </>
                  )}
                </Card>

                <Card title="Харчова цінність">
                  {calc && (
                    <Table head={['Показник', 'На 100 г', `На порцію (${calc.portionG} г)`]}>
                      {NUTRIENTS.map(([label, key, unit]) => (
                        <Row key={key}>
                          <Cell className={label.startsWith('у т.ч.') ? 'pl-6 text-emerald-800/70' : ''}>
                            {label}
                          </Cell>
                          <Cell align="right">
                            {key === 'kcal'
                              ? `${calc.per100.kcal} ккал / ${calc.per100.kj} кДж`
                              : `${calc.per100[key]} ${unit}`}
                          </Cell>
                          <Cell align="right">
                            {key === 'kcal'
                              ? `${calc.perPortion.kcal} ккал / ${calc.perPortion.kj} кДж`
                              : `${calc.perPortion[key]} ${unit}`}
                          </Cell>
                        </Row>
                      ))}
                    </Table>
                  )}
                </Card>

                <Card title="Алергени">
                  {calc && calc.contains.length === 0 && calc.traces.length === 0 ? (
                    <Empty>Жодного з 14 обовʼязкових алергенів в інгредієнтах не позначено</Empty>
                  ) : (
                    <div className="space-y-3 text-sm">
                      {calc && calc.contains.length > 0 && (
                        <div>
                          <span className="font-semibold text-emerald-950">Містить: </span>
                          {calc.contains.map((a) => a.name).join(', ')}
                        </div>
                      )}
                      {calc && calc.traces.length > 0 && (
                        <div>
                          <span className="font-semibold text-emerald-950">Може містити сліди: </span>
                          {calc.traces.map((a) => a.name).join(', ')}
                        </div>
                      )}
                      <p className="text-xs text-emerald-800/60">
                        Алергени беруться з карток інгредієнтів. Якщо на лінії працює арахіс,
                        позначте його як «сліди» в тих позиціях, де є ризик перехресного
                        забруднення — на етикетці це окремий рядок, а не частина складу.
                      </p>
                    </div>
                  )}
                </Card>
              </div>

              <div className="space-y-4">
                <Card title={spec ? `Специфікація версії ${spec.version}` : 'Специфікація'}>
                  {spec ? (
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-emerald-800/60">Затверджено</span>
                        <span className="font-medium">{fmtDate(spec.approved_on)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-emerald-800/60">За рецептурою</span>
                        <span className="font-medium">версія {spec.recipe_version}</span>
                      </div>
                      <form action={revokeSpec} className="pt-2">
                        <input type="hidden" name="item_id" value={item.id} />
                        <input type="hidden" name="spec_id" value={spec.id} />
                        <Button variant="ghost">Відкликати</Button>
                      </form>
                    </div>
                  ) : (
                    <p className="mb-3 text-sm text-emerald-800/70">
                      Затвердження заморожує розрахунок разом із версією рецептури. Через півроку
                      треба вміти відповісти, за яким складом надрукована пачка, що зараз у мережі.
                    </p>
                  )}

                  <div className="mt-3">
                    <ActionForm
                      action={approveSpec}
                      submitLabel={spec ? 'Затвердити нову версію' : 'Затвердити специфікацію'}
                    >
                      <input type="hidden" name="item_id" value={item.id} />
                      <Field label="Примітка">
                        <input name="note" className={inputClass} />
                      </Field>
                    </ActionForm>
                  </div>
                </Card>

                {history.length > 0 && (
                  <Card title="Історія версій">
                    <Table head={['Версія', 'Дата', 'Рецептура']}>
                      {history.map((h) => (
                        <Row key={h.id}>
                          <Cell>
                            {h.version}
                            {h.status === 'revoked' && (
                              <Badge tone="gray">
                                <span className="ml-1">відкликана</span>
                              </Badge>
                            )}
                          </Cell>
                          <Cell>{fmtDate(h.approved_on)}</Cell>
                          <Cell align="right">в. {h.recipe_version}</Cell>
                        </Row>
                      ))}
                    </Table>
                  </Card>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Макет етикетки. Обов'язкові дані — ст. 6 ЗУ № 2639-VIII: назва, склад,
          алергени, кількість нетто, строк придатності, умови зберігання,
          оператор ринку, країна походження, поживна цінність. Розмір близький
          до реального флоу-паку, тож видно, чи все вміщається. */}
      {spec && (
        <div className="mx-auto hidden w-[80mm] bg-white p-[4mm] text-black print:block">
          <div className="text-center text-[13px] font-bold uppercase leading-tight">
            {item.label_name ?? item.name}
          </div>
          <div className="mt-1 text-center text-[9px]">
            Батончик горіхово-фруктовий, без додавання цукру
          </div>

          <div className="mt-2 text-[7.5px] leading-snug">
            <span className="font-bold">Склад: </span>
            {spec.composition_text}.
          </div>

          {spec.allergen_text && (
            <div className="mt-1 text-[7.5px] leading-snug">
              <span className="font-bold uppercase">Містить: {spec.allergen_text}.</span>
            </div>
          )}
          {spec.traces_text && (
            <div className="text-[7.5px] leading-snug">Може містити сліди: {spec.traces_text}.</div>
          )}

          <table className="mt-2 w-full border-collapse text-[7.5px]">
            <thead>
              <tr>
                <th className="border border-black px-1 py-0.5 text-left">
                  Поживна цінність
                </th>
                <th className="border border-black px-1 py-0.5 text-right">100 г</th>
                <th className="border border-black px-1 py-0.5 text-right">
                  порція {spec.nutrition.portionG} г
                </th>
              </tr>
            </thead>
            <tbody>
              {NUTRIENTS.map(([label, key, unit]) => (
                <tr key={key}>
                  <td className={`border border-black px-1 py-0.5 ${label.startsWith('у т.ч.') ? 'pl-3' : ''}`}>
                    {label}
                  </td>
                  <td className="border border-black px-1 py-0.5 text-right tabular-nums">
                    {key === 'kcal'
                      ? `${spec.nutrition.per100.kj} кДж / ${spec.nutrition.per100.kcal} ккал`
                      : `${spec.nutrition.per100[key]} ${unit}`}
                  </td>
                  <td className="border border-black px-1 py-0.5 text-right tabular-nums">
                    {key === 'kcal'
                      ? `${spec.nutrition.perPortion.kj} / ${spec.nutrition.perPortion.kcal}`
                      : `${spec.nutrition.perPortion[key]} ${unit}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-2 space-y-0.5 text-[7.5px] leading-snug">
            <div>
              <span className="font-bold">Маса нетто: </span>
              {spec.net_weight_g} г
            </div>
            {spec.storage_text && <div>{spec.storage_text}.</div>}
            <div>
              <span className="font-bold">Придатний до: </span>
              {expiry ? fmtDate(expiry) : '__.__.____'} · партія ____________
            </div>
            <div>
              <span className="font-bold">Виробник: </span>
              {spec.producer_text ?? entity?.name}
            </div>
            {entity?.phone && <div>Тел. {entity.phone}</div>}
            <div>Країна походження: {spec.country ?? 'Україна'}</div>
          </div>

          {item.barcode && (
            <div className="mt-2 text-center">
              <Barcode value={item.barcode} barHeight={40} />
            </div>
          )}

          <div className="mt-1 text-center text-[6px] text-black/60">
            Специфікація № {spec.version} від {fmtDate(spec.approved_on)}
          </div>
        </div>
      )}
    </>
  );
}
