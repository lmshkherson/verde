import { Alert, Card, Cell, Empty, PageHeader, Row, Stat, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { fmtMoney, fmtPct } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Єдиний податок ФОП. Група береться з картки юрособи:
 *
 *   2-га — фіксована ставка щомісяця (20% мінімальної зарплати), незалежно
 *   від доходу; дохід тут показується лише для контролю річного ліміту.
 *   3-тя — 5% від доходу за касовим методом, наростаючим підсумком.
 *
 * Поруч — ЄСВ «за себе» і військовий збір ФОП: платяться в ті самі строки,
 * тож власнику зручно бачити всю трійку разом.
 */
// Мінімальна зарплата — база всіх ставок; змінюється законом про бюджет,
// цифру треба звіряти щороку.
const MIN_WAGE = 8000;
const GROUP2_MONTHLY = 0.2 * MIN_WAGE; // до 20% МЗП, ставку затверджує місцева рада
const GROUP2_LIMIT = 834 * MIN_WAGE;
const GROUP3_RATE = 0.05;
const GROUP3_LIMIT = 1167 * MIN_WAGE;
const ESV_MONTHLY = 0.22 * MIN_WAGE;
const VZ_MONTHLY = 0.1 * MIN_WAGE;

const MONTHS = [
  'Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
  'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень',
];

export default async function SingleTaxPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  await requireRole();
  const sp = await searchParams;
  const year = Number(sp.year) || new Date().getFullYear();

  const entities = await query<{
    id: string;
    name: string;
    short_name: string;
    single_tax_group: number;
  }>(
    `select id, name, short_name, single_tax_group from legal_entities
      where tax_system = 'single_tax' and is_active order by short_name`,
  );

  const data = await Promise.all(
    entities.map(async (e) => {
      const rows = await query<{ m: number; income: number }>(
        `select extract(month from paid_on)::int as m, coalesce(sum(amount), 0) as income
           from payments
          where legal_entity_id = $1 and extract(year from paid_on) = $2
          group by 1 order by 1`,
        [e.id, year],
      );
      const byMonth = MONTHS.map((_, i) => Number(rows.find((r) => r.m === i + 1)?.income ?? 0));
      return { entity: e, byMonth, total: byMonth.reduce((s, v) => s + v, 0) };
    }),
  );

  const prevYear = year - 1;
  const nextYear = year + 1;

  return (
    <>
      <PageHeader
        title="Єдиний податок"
        subtitle={`${year} рік · група і ставки — з картки юрособи; мінімалка ${fmtMoney(MIN_WAGE)} — звіряйте щороку`}
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
        data.map(({ entity, byMonth, total }) => {
          const group2 = entity.single_tax_group === 2;
          const limit = group2 ? GROUP2_LIMIT : GROUP3_LIMIT;
          const yearTax = group2 ? GROUP2_MONTHLY * 12 : total * GROUP3_RATE;

          return (
            <div key={entity.id} className="mb-8">
              <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat
                  label={entity.short_name}
                  value={group2 ? '2 група' : '3 група'}
                  hint={group2 ? 'фіксований податок щомісяця' : '5% від доходу'}
                />
                <Stat
                  label={group2 ? 'ЄП на місяць' : 'Податок за рік'}
                  value={fmtMoney(group2 ? GROUP2_MONTHLY : yearTax)}
                  hint={
                    group2
                      ? '20% мінімалки · сплата авансом до 20 числа'
                      : 'наростаючим підсумком, див. квартали'
                  }
                />
                <Stat label="Дохід за рік" value={fmtMoney(total)} hint="надходження грошей, касовий метод" />
                <Stat
                  label="Використано ліміту групи"
                  value={fmtPct(Math.round((total / limit) * 1000) / 10)}
                  tone={total > limit ? 'danger' : total > limit * 0.8 ? 'warn' : 'good'}
                  hint={`ліміт ${fmtMoney(limit)}`}
                />
              </div>

              {total > limit && (
                <div className="mb-4">
                  <Alert tone="red">
                    Дохід перевищив річний ліміт групи: із суми перевищення єдиний податок — 15%,
                    і з наступного кварталу треба переходити на вищу групу або загальну систему.
                    Обговоріть із бухгалтером.
                  </Alert>
                </div>
              )}

              {group2 ? (
                <Card title={`${entity.name} — платежі ${year} року`}>
                  <Table head={['Місяць', 'Дохід (довідково)', 'ЄП до 20 числа', 'ЄСВ «за себе»', 'Військовий збір']}>
                    {MONTHS.map((name, i) => (
                      <Row key={name}>
                        <Cell>{name}</Cell>
                        <Cell align="right">{fmtMoney(byMonth[i])}</Cell>
                        <Cell align="right" className="font-semibold">
                          {fmtMoney(GROUP2_MONTHLY)}
                        </Cell>
                        <Cell align="right">{fmtMoney(ESV_MONTHLY)}</Cell>
                        <Cell align="right">{fmtMoney(VZ_MONTHLY)}</Cell>
                      </Row>
                    ))}
                    <Row>
                      <Cell className="font-bold">Разом за рік</Cell>
                      <Cell align="right" className="font-bold">
                        {fmtMoney(total)}
                      </Cell>
                      <Cell align="right" className="font-bold">
                        {fmtMoney(GROUP2_MONTHLY * 12)}
                      </Cell>
                      <Cell align="right" className="font-bold">
                        {fmtMoney(ESV_MONTHLY * 12)}
                      </Cell>
                      <Cell align="right" className="font-bold">
                        {fmtMoney(VZ_MONTHLY * 12)}
                      </Cell>
                    </Row>
                  </Table>
                  <p className="mt-3 text-sm text-emerald-800/70">
                    На 2-й групі податок фіксований і від доходу не залежить — дохід тут лише для
                    контролю ліміту групи. ЄП платиться авансом до 20 числа поточного місяця; ЄСВ —
                    щокварталу до 20 числа наступного за кварталом місяця (у таблиці показано
                    помісячно для зручності); військовий збір ФОП — разом з ЄП. Декларація
                    подається раз на рік. Ставки затверджує місцева рада — типово максимум,
                    перевірте свою.
                  </p>
                </Card>
              ) : (
                <Card title={`${entity.name} — 5% від доходу, наростаючим підсумком`}>
                  <Table head={['Період', 'Дохід за квартал', 'Дохід наростаючим', 'Податок наростаючим', 'До сплати за квартал']}>
                    {[0, 1, 2, 3].map((q) => {
                      const qIncome = byMonth.slice(q * 3, q * 3 + 3).reduce((s, v) => s + v, 0);
                      const cum = byMonth.slice(0, q * 3 + 3).reduce((s, v) => s + v, 0);
                      const prevCum = byMonth.slice(0, q * 3).reduce((s, v) => s + v, 0);
                      return (
                        <Row key={q}>
                          <Cell>
                            {q + 1} квартал {year}
                          </Cell>
                          <Cell align="right">{fmtMoney(qIncome)}</Cell>
                          <Cell align="right">{fmtMoney(cum)}</Cell>
                          <Cell align="right">{fmtMoney(cum * GROUP3_RATE)}</Cell>
                          <Cell align="right" className="font-semibold">
                            {fmtMoney((cum - prevCum) * GROUP3_RATE)}
                          </Cell>
                        </Row>
                      );
                    })}
                  </Table>
                  <p className="mt-3 text-sm text-emerald-800/70">
                    Дохід — надходження грошей від покупців (банк і каса), а не відвантаження.
                    Декларація — за 40 днів після кварталу, сплата — за 10 днів після граничного
                    строку подання. ЄСВ «за себе» ({fmtMoney(ESV_MONTHLY)}/міс) і військовий збір
                    ({fmtMoney(VZ_MONTHLY)}/міс) платяться окремо.
                  </p>
                </Card>
              )}
            </div>
          );
        })
      )}
    </>
  );
}
