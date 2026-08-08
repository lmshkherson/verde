import { createLegalEntity, linkCustomerToEntity } from '@/app/actions/entities';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Cell, Empty, Field, inputClass, PageHeader, Row, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { fmtMoney } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function EntitiesPage() {
  await requireRole(); // лише власник

  const [entities, customers] = await Promise.all([
    query<{
      id: string;
      name: string;
      short_name: string;
      doc_prefix: string;
      edrpou: string | null;
      ipn: string | null;
      tax_system: string;
      is_vat_payer: boolean;
      overhead_policy: string;
      stock_value: number;
      vat_payable: number;
    }>(`
      select e.id, e.name, e.short_name, e.doc_prefix, e.edrpou, e.ipn, e.tax_system, e.is_vat_payer, e.overhead_policy,
             coalesce(st.value, 0)   as stock_value,
             coalesce(vat.payable, 0) as vat_payable
        from legal_entities e
        left join (
          select legal_entity_id, sum(value) as value from v_item_stock group by legal_entity_id
        ) st on st.legal_entity_id = e.id
        left join (
          select legal_entity_id,
                 coalesce(sum(vat_amount) filter (where kind = 'liability'), 0)
                   - coalesce(sum(vat_amount) filter (where kind = 'credit'), 0) as payable
          from vat_entries group by legal_entity_id
        ) vat on vat.legal_entity_id = e.id
       where e.is_active
       order by e.short_name
    `),
    query<{ id: string; name: string; kind: string; legal_entity_id: string | null }>(
      'select id, name, kind, legal_entity_id from customers where is_active order by name',
    ),
  ]);

  return (
    <>
      <PageHeader
        title="Юридичні особи"
        subtitle="Кожна веде власний склад, нумерацію документів і розрахунки з ПДВ"
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card title="Ваші юрособи">
            {entities.length === 0 ? (
              <Empty>Не налаштовано жодної</Empty>
            ) : (
              <Table head={['Юрособа', 'Оподаткування', 'Запаси', 'ПДВ до сплати']}>
                {entities.map((e) => (
                  <Row key={e.id}>
                    <Cell>
                      <div className="font-semibold">{e.short_name}</div>
                      <div className="text-xs text-emerald-800/50">
                        {e.name} · документи {e.doc_prefix}-…
                        {e.edrpou ? ` · ЄДРПОУ ${e.edrpou}` : ''}
                        {e.ipn ? ` · ІПН ${e.ipn}` : ''}
                      </div>
                    </Cell>
                    <Cell>
                      <Badge tone={e.is_vat_payer ? 'blue' : 'gray'}>
                        {e.is_vat_payer ? 'Платник ПДВ' : 'Без ПДВ'}
                      </Badge>
                      <div className="mt-0.5 text-xs text-emerald-800/50">
                        {e.tax_system === 'single_tax' ? 'єдиний податок' : 'загальна система'}
                        {' · '}
                        {e.overhead_policy === 'capitalize'
                          ? 'накладні у собівартості'
                          : 'накладні — витрати періоду'}
                      </div>
                    </Cell>
                    <Cell align="right">{fmtMoney(e.stock_value)}</Cell>
                    <Cell align="right">
                      {e.is_vat_payer ? (
                        <span className={e.vat_payable > 0 ? 'font-semibold text-amber-600' : ''}>
                          {fmtMoney(e.vat_payable)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </Cell>
                  </Row>
                ))}
              </Table>
            )}
            <p className="mt-4 text-sm text-emerald-800/70">
              Склад фізично спільний, тому власника система веде на рівні кожного залишку. Та сама
              партія може частково належати різним юрособам — і мати в них різну собівартість, бо
              вхідний ПДВ у платника йде в податковий кредит, а в єдинника — у витрати.
            </p>
          </Card>

          <Card title="Клієнти, які є нашими юрособами">
            <p className="mb-3 text-sm text-emerald-800/70">
              Позначте клієнта власною юрособою — і продаж йому одночасно оприбуткує товар у неї.
              Це реалізація між своїми, а не переміщення: у продавця виникає дохід і ПДВ, у покупця —
              нова собівартість.
            </p>
            <Table head={['Клієнт', 'Власна юрособа', '']}>
              {customers.map((c) => (
                <Row key={c.id}>
                  <Cell className="font-semibold">{c.name}</Cell>
                  <Cell>
                    {c.legal_entity_id ? (
                      <Badge tone="blue">
                        {entities.find((e) => e.id === c.legal_entity_id)?.short_name ?? 'так'}
                      </Badge>
                    ) : (
                      <span className="text-emerald-800/40">зовнішній</span>
                    )}
                  </Cell>
                  <Cell align="right">
                    <ActionForm action={linkCustomerToEntity} submitLabel="Зберегти" hideSuccess>
                      <input type="hidden" name="customer_id" value={c.id} />
                      <select
                        name="entity_id"
                        defaultValue={c.legal_entity_id ?? ''}
                        className={`${inputClass} !min-h-9 text-sm`}
                      >
                        <option value="">Зовнішній клієнт</option>
                        {entities.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.short_name}
                          </option>
                        ))}
                      </select>
                    </ActionForm>
                  </Cell>
                </Row>
              ))}
            </Table>
          </Card>
        </div>

        <Card title="Нова юрособа">
          <ActionForm action={createLegalEntity} submitLabel="Додати юрособу">
            <Field label="Повна назва">
              <input name="name" required className={inputClass} placeholder="ТОВ «Верде Фудс»" />
            </Field>
            <Field label="Коротка назва">
              <input name="short_name" required className={inputClass} placeholder="Верде Фудс" />
            </Field>
            <Field label="Префікс документів" hint="Свій для кожної: ВФ-ЗАМ-2026-0001">
              <input name="doc_prefix" required maxLength={5} className={inputClass} placeholder="ВФ" />
            </Field>
            <Field label="ЄДРПОУ / РНОКПП">
              <input name="edrpou" className={inputClass} />
            </Field>
            <Field label="Система оподаткування">
              <select name="tax_system" className={inputClass} defaultValue="general">
                <option value="general">Загальна</option>
                <option value="single_tax">Єдиний податок</option>
              </select>
            </Field>
            <label className="flex items-center gap-2 py-1">
              <input name="is_vat_payer" type="checkbox" className="size-5 accent-emerald-700" />
              <span className="text-sm font-semibold text-emerald-900">Платник ПДВ</span>
            </label>
            <Field label="ІПН платника ПДВ" hint="Обов'язково для платника">
              <input name="ipn" className={inputClass} />
            </Field>
            <Field
              label="Виробничі накладні"
              hint="Електроенергія й зарплата цеху: у вартість партії чи у витрати місяця"
            >
              <select name="overhead_policy" className={inputClass} defaultValue="period">
                <option value="period">Витрати періоду</option>
                <option value="capitalize">У собівартість партії</option>
              </select>
            </Field>
            <Field label="Ставка ПДВ, %">
              <input name="vat_rate" type="number" step="0.1" min="0" defaultValue="20" className={inputClass} />
            </Field>
            <Field label="Банк">
              <input name="bank_name" className={inputClass} />
            </Field>
            <Field label="IBAN">
              <input name="bank_account" className={inputClass} />
            </Field>
            <Field label="Адреса">
              <input name="address" className={inputClass} />
            </Field>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
