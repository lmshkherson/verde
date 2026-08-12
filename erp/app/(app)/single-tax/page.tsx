import { Alert, Card, Cell, Empty, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { fmtMoney, fmtPct } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Єдиний податок ФОП, група 3 без ПДВ: 5% від доходу за касовим методом.
 * Дохід — усі надходження грошей від покупців (банк і каса разом), бо
 * payments зберігають оплати з обох джерел. Декларація подається щокварталу
 * наростаючим підсумком — так і рахуємо.
 */
const RATE = 0.05;
// Ліміт річного доходу 3-ї групи прив'язаний до мінімальної зарплати
// (1167 розмірів) і змінюється щороку — цифру треба звіряти з чинною.
const GROUP3_LIMIT = 1167 * 8000;

export default async function SingleTaxPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  await requireRole();
  const sp = await searchParams;
  const year = Number(sp.year) || new Date().getFullYear();

  const entities = await query<{ id: string; name: string; short_name: string; edrpou: string | null }>(
    `select id, name, short_name, edrpou from legal_entities
      where tax_system = 'single_tax' and is_active order by short_name`,
  );

  const quarters = await Promise.all(
    entities.map(async (e) => {
      const rows = await query<{ q: number; income: number }>(
        `select extract(quarter from paid_on)::int as q, coalesce(sum(amount), 0) as income
           from payments
          where legal_entity_id = $1 and extract(year from paid_on) = $2
          group by 1 order by 1`,
        [e.id, year],
      );
      const byQ = [1, 2, 3, 4].map((q) => Number(rows.find((r) => r.q === q)?.income ?? 0));
      let cum = 0;
      const table = byQ.map((income, i) => {
        cum += income;
        return { q: i + 1, income, cumulative: cum, taxCumulative: cum * RATE };
      });
      return { entity: e, table, total: cum };
    }),
  );

  const prevYear = year - 1;
  const nextYear = year + 1;

  return (
    <>
      <PageHeader
        title="Єдиний податок"
        subtitle={`Група 3 без ПДВ · 5% від доходу за касовим методом · ${year} рік`}
        action={
          <div className="flex items-center gap-2 text-sm font-semibold">
            <a href={`/single-tax?year=${prevYear}`} className="text-emerald-700 hover:underline">
              ← {prevYear}
            </a>
            <a href={`/single-tax?year=${nextYear}`} className="text-emerald-700 hover:underline">
              {nextYear} →
            </a>
          </div>
        }
      />

      {entities.length === 0 ? (
        <Card title="Єдинників немає">
          <Empty>Жодна юрособа не на єдиному податку</Empty>
        </Card>
      ) : (
        quarters.map(({ entity, table, total }) => (
          <div key={entity.id} className="mb-8">
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Stat label={entity.short_name} value={fmtMoney(total)} hint="дохід за рік" />
              <Stat label="Податок за рік" value={fmtMoney(total * RATE)} hint="5% від доходу" />
              <Stat
                label="Використано ліміту групи"
                value={fmtPct(Math.round((total / GROUP3_LIMIT) * 1000) / 10)}
                tone={total > GROUP3_LIMIT ? 'danger' : total > GROUP3_LIMIT * 0.8 ? 'warn' : 'good'}
                hint={`ліміт ${fmtMoney(GROUP3_LIMIT)} — звіряйте з чинним розміром`}
              />
            </div>

            {total > GROUP3_LIMIT && (
              <div className="mb-4">
                <Alert tone="red">
                  Дохід перевищив ліміт 3-ї групи: із суми перевищення єдиний податок — 15%, і
                  треба переходити на загальну систему. Обговоріть із бухгалтером.
                </Alert>
              </div>
            )}

            <Card title={`Декларація ${entity.name} — наростаючим підсумком`}>
              <Table head={['Період', 'Дохід за квартал', 'Дохід наростаючим', 'Податок наростаючим', 'До сплати за квартал']}>
                {table.map((r, i) => (
                  <Row key={r.q}>
                    <Cell>
                      {r.q} квартал {year}
                    </Cell>
                    <Cell align="right">{fmtMoney(r.income)}</Cell>
                    <Cell align="right">{fmtMoney(r.cumulative)}</Cell>
                    <Cell align="right">{fmtMoney(r.taxCumulative)}</Cell>
                    <Cell align="right" className="font-semibold">
                      {fmtMoney(r.taxCumulative - (i > 0 ? table[i - 1].taxCumulative : 0))}
                    </Cell>
                  </Row>
                ))}
              </Table>
              <p className="mt-3 text-sm text-emerald-800/70">
                Дохід — надходження грошей від покупців (банк і каса), а не відвантаження: єдиний
                податок рахується за касовим методом. Строк подання декларації — 40 днів після
                кварталу, сплати — 10 днів після граничного строку подання. ЄСВ «за себе» і
                військовий збір ФОП сюди не входять — вони платяться окремо.
              </p>
            </Card>
          </div>
        ))
      )}
    </>
  );
}
