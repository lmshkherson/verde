import { countBatch, transferStock, writeOffStock } from '@/app/actions/stock';
import { ActionForm } from '@/components/action-form';
import { Card, Field, inputClass, LinkButton, PageHeader } from '@/components/ui';
import { query } from '@/lib/db';
import { fmtDate, fmtQty, unitLabel } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function StockOperationsPage() {
  const session = await requireRole('warehouse');

  const [locations, items, warehouses] = await Promise.all([
    query<{
      batch_id: string;
      warehouse_id: string;
      code: string;
      name: string;
      unit: string;
      qty: number;
      warehouse: string;
      expires_on: string | null;
    }>(`
      select sb.batch_id, sb.warehouse_id, b.code, i.name, i.unit, sb.qty,
             w.name as warehouse, b.expires_on
        from v_stock_batches sb
        join batches b on b.id = sb.batch_id
        join items i on i.id = sb.item_id
        join warehouses w on w.id = sb.warehouse_id
       where sb.legal_entity_id = $1
       order by i.name, b.expires_on nulls last
    `, [session.eid]),
    query<{ id: string; sku: string; name: string; unit: string }>(
      "select id, sku, name, unit from items where is_active and kind <> 'service' order by name",
    ),
    query<{ id: string; name: string }>('select id, name from warehouses where is_active order by code'),
  ]);

  return (
    <>
      <PageHeader
        title="Складські операції"
        subtitle="Інвентаризація, списання і переміщення між складами"
        action={<LinkButton href="/stock">← До залишків</LinkButton>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Інвентаризація">
          <p className="mb-3 text-sm text-emerald-800/70">
            Введіть фактично порахований залишок партії. Систему на різницю поправить окремий рух —
            слід від інвентаризації лишиться в журналі.
          </p>
          <ActionForm action={countBatch} submitLabel="Зафіксувати перерахунок">
            <Field label="Партія на складі">
              <select name="batch_location" required className={inputClass} defaultValue="">
                <option value="" disabled>
                  Оберіть партію…
                </option>
                {locations.map((l) => (
                  <option key={`${l.batch_id}-${l.warehouse_id}`} value={`${l.batch_id}|${l.warehouse_id}`}>
                    {l.name} · {l.code} · {l.warehouse} — {fmtQty(l.qty, unitLabel(l.unit))}
                    {l.expires_on ? ` (до ${fmtDate(l.expires_on)})` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Фактична кількість">
              <input name="counted_qty" type="number" step="0.001" min="0" required className={inputClass} />
            </Field>
            <Field label="Коментар">
              <input name="note" className={inputClass} placeholder="Напр. бій під час переміщення" />
            </Field>
          </ActionForm>
        </Card>

        <Card title="Списання">
          <p className="mb-3 text-sm text-emerald-800/70">
            Партії підбираються автоматично — спершу ті, що раніше псуються (FEFO).
          </p>
          <ActionForm action={writeOffStock} submitLabel="Списати" variant="danger">
            <Field label="Номенклатура">
              <select name="item_id" required className={inputClass} defaultValue="">
                <option value="" disabled>
                  Оберіть позицію…
                </option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.sku})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Склад">
              <select name="warehouse_id" required className={inputClass} defaultValue="">
                <option value="" disabled>
                  Оберіть склад…
                </option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Кількість">
              <input name="qty" type="number" step="0.001" min="0" required className={inputClass} />
            </Field>
            <Field label="Причина" hint="Обов'язково — списання без причини не проводиться">
              <input name="note" required className={inputClass} placeholder="Псування, брак, зразки" />
            </Field>
          </ActionForm>
        </Card>

        <Card title="Переміщення">
          <p className="mb-3 text-sm text-emerald-800/70">
            Партія їде на інший склад разом зі своєю собівартістю — вартість запасу не змінюється.
          </p>
          <ActionForm action={transferStock} submitLabel="Перемістити">
            <Field label="Номенклатура">
              <select name="item_id" required className={inputClass} defaultValue="">
                <option value="" disabled>
                  Оберіть позицію…
                </option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.sku})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Зі складу">
              <select name="from_warehouse_id" required className={inputClass} defaultValue="">
                <option value="" disabled>
                  Оберіть склад…
                </option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="На склад">
              <select name="to_warehouse_id" required className={inputClass} defaultValue="">
                <option value="" disabled>
                  Оберіть склад…
                </option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Кількість">
              <input name="qty" type="number" step="0.001" min="0" required className={inputClass} />
            </Field>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
