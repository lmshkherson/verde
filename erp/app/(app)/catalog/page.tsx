import Link from 'next/link';
import { createItem } from '@/app/actions/catalog';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Cell, Empty, Field, inputClass, LinkButton, PageHeader, Row, Table } from '@/components/ui';
import { query } from '@/lib/db';
import { EXPENSE_CATEGORIES, fmtMoney, fmtQty, ITEM_KINDS, STOCK_ITEM_KINDS, UNITS, unitLabel } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; inactive?: string }>;
}) {
  const session = await requireRole('production', 'sales', 'warehouse');
  const { kind, inactive } = await searchParams;
  const showInactive = inactive === '1';

  const items = await query<{
    id: string;
    sku: string;
    name: string;
    kind: string;
    unit: string;
    min_stock: number;
    shelf_life_days: number | null;
    pcs_per_box: number | null;
    price_distributor: number | null;
    price_network: number | null;
    price_rrp: number | null;
    is_active: boolean;
    barcode: string | null;
    qty: number;
  }>(
    `select i.id, i.sku, i.name, i.kind, i.unit, i.min_stock, i.shelf_life_days, i.pcs_per_box,
            i.price_distributor, i.price_network, i.price_rrp, i.is_active, i.barcode,
            coalesce(s.qty, 0) as qty
       from items i
       left join v_item_stock s on s.item_id = i.id and s.legal_entity_id = $2
      where ($3::bool or i.is_active) and ($1::text is null or i.kind = $1)
      order by i.is_active desc, i.kind, i.name`,
    [kind ?? null, session.eid, showInactive],
  );

  return (
    <>
      <PageHeader
        title="Номенклатура"
        subtitle="Сировина, пакування, готова продукція з прайсом і послуги"
        action={
          <LinkButton href={showInactive ? `/catalog${kind ? `?kind=${kind}` : ''}` : `/catalog?${kind ? `kind=${kind}&` : ''}inactive=1`}>
            {showInactive ? 'Лише активні' : 'Показати деактивовані'}
          </LinkButton>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href={showInactive ? '/catalog?inactive=1' : '/catalog'}
          className={`rounded-full px-4 py-2 text-sm font-semibold ${
            !kind ? 'bg-emerald-700 text-white' : 'border border-emerald-900/15 bg-white text-emerald-900'
          }`}
        >
          Усе
        </Link>
        {Object.entries(ITEM_KINDS).map(([key, label]) => (
          <Link
            key={key}
            href={`/catalog?kind=${key}${showInactive ? '&inactive=1' : ''}`}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              kind === key
                ? 'bg-emerald-700 text-white'
                : 'border border-emerald-900/15 bg-white text-emerald-900'
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card title="Позиції">
          {items.length === 0 ? (
            <Empty>Порожньо</Empty>
          ) : (
            <Table head={['Позиція', 'Тип', 'Залишок', 'Мінімум', 'Прайс']}>
              {items.map((i) => (
                <Row key={i.id}>
                  <Cell>
                    <Link href={`/catalog/${i.id}`} className="font-semibold text-emerald-800 hover:underline">
                      {i.name}
                    </Link>
                    <div className="text-xs text-emerald-800/50">
                      {i.sku}
                      {i.barcode ? ` · ${i.barcode}` : ''}
                      {i.shelf_life_days ? ` · термін ${i.shelf_life_days} дн.` : ''}
                      {i.pcs_per_box ? ` · шоубокс ${i.pcs_per_box} шт` : ''}
                    </div>
                  </Cell>
                  <Cell>
                    <Badge tone={i.kind === 'finished' ? 'green' : i.kind === 'service' ? 'blue' : 'gray'}>
                      {ITEM_KINDS[i.kind]}
                    </Badge>
                    {!i.is_active && (
                      <div className="mt-0.5">
                        <Badge tone="amber">деактивована</Badge>
                      </div>
                    )}
                  </Cell>
                  <Cell align="right">
                    {i.kind === 'service' ? '—' : fmtQty(i.qty, unitLabel(i.unit))}
                  </Cell>
                  <Cell align="right">
                    {i.kind !== 'service' && i.min_stock > 0 ? fmtQty(i.min_stock, unitLabel(i.unit)) : '—'}
                  </Cell>
                  <Cell align="right">
                    {i.price_distributor ? (
                      <div className="text-xs">
                        <div>дистр. {fmtMoney(i.price_distributor)}</div>
                        {i.price_network && <div>мережа {fmtMoney(i.price_network)}</div>}
                        {i.price_rrp && <div className="text-emerald-800/50">РРЦ {fmtMoney(i.price_rrp)}</div>}
                      </div>
                    ) : (
                      '—'
                    )}
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>

        <div className="space-y-4">
        <Card title="Нова позиція">
          <ActionForm action={createItem} submitLabel="Додати">
            <Field label="Артикул (SKU)">
              <input name="sku" required className={inputClass} placeholder="VRD-PIST-25" />
            </Field>
            <Field label="Назва">
              <input name="name" required className={inputClass} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Тип">
                <select name="kind" required className={inputClass} defaultValue="raw">
                  {STOCK_ITEM_KINDS.map((key) => (
                    <option key={key} value={key}>
                      {ITEM_KINDS[key]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Одиниця">
                <select name="unit" required className={inputClass} defaultValue="kg">
                  {Object.entries(UNITS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Термін, дн.">
                <input name="shelf_life_days" type="number" min="0" className={inputClass} />
              </Field>
              <Field label="Мін. залишок">
                <input name="min_stock" type="number" step="0.001" min="0" defaultValue="0" className={inputClass} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Вага, г">
                <input name="weight_g" type="number" step="0.1" min="0" className={inputClass} />
              </Field>
              <Field label="Шт. у шоубоксі">
                <input name="pcs_per_box" type="number" min="0" className={inputClass} />
              </Field>
            </div>
            <Field label="Ціна дистриб'ютора">
              <input name="price_distributor" type="number" step="0.01" min="0" className={inputClass} />
            </Field>
            <Field label="Ціна на мережу">
              <input name="price_network" type="number" step="0.01" min="0" className={inputClass} />
            </Field>
            <Field label="РРЦ">
              <input name="price_rrp" type="number" step="0.01" min="0" className={inputClass} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Темп. від, °C">
                <input name="temp_min_c" type="number" step="0.1" className={inputClass} />
              </Field>
              <Field label="Темп. до, °C">
                <input name="temp_max_c" type="number" step="0.1" className={inputClass} placeholder="20" />
              </Field>
            </div>
            <Field label="Штрихкод" hint="EAN-13 або 12 цифр від GS1 — контрольну дорахуємо">
              <input name="barcode" inputMode="numeric" className={inputClass} placeholder="4820024700016" />
            </Field>
          </ActionForm>
        </Card>

        <Card title="Нова послуга">
          <p className="mb-3 text-sm text-emerald-800/70">
            Послуга на склад не потрапляє — картка потрібна, щоб у надходженні обирати її зі
            списку, а не вводити текст щоразу, і бачити у звітах, скільки на неї витрачено.
          </p>
          <ActionForm action={createItem} submitLabel="Додати послугу" variant="ghost">
            <input type="hidden" name="kind" value="service" />
            <input type="hidden" name="unit" value="pcs" />
            <Field label="Артикул (SKU)">
              <input name="sku" required className={inputClass} placeholder="SRV-RENT" />
            </Field>
            <Field label="Назва">
              <input name="name" required className={inputClass} placeholder="Оренда цеху" />
            </Field>
            <Field label="Стаття витрат" hint="за нею сума ляже у фінрезультат">
              <select name="expense_category" required className={inputClass} defaultValue="services">
                {Object.entries(EXPENSE_CATEGORIES).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Поведінка" hint="змінна росте з випуском">
                <select name="cost_behavior" className={inputClass} defaultValue="fixed">
                  <option value="fixed">Постійна</option>
                  <option value="variable">Змінна</option>
                </select>
              </Field>
              <Field label="Ставка ПДВ, %">
                <select name="vat_rate" className={inputClass} defaultValue="20">
                  <option value="20">20</option>
                  <option value="7">7</option>
                  <option value="0">0 / без ПДВ</option>
                </select>
              </Field>
            </div>
          </ActionForm>
        </Card>
        </div>
      </div>
    </>
  );
}
