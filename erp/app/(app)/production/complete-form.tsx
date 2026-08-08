'use client';

import { useActionState, useMemo, useState } from 'react';
import { completeProduction } from '@/app/actions/production';
import { Alert, Button, Field, inputClass } from '@/components/ui';
import { fmtMoney, fmtQty, unitLabel } from '@/lib/format';

export interface Material {
  itemId: string;
  name: string;
  unit: string;
  qtyPerBatch: number;
  lossPct: number;
  available: number;
  avgCost: number;
}

/**
 * Закриття варки. Норми сировини перераховуються від фактичного випуску одразу
 * під час набору — інакше технолог введе 900 шт замість 1000, а списання
 * залишиться за планом, і собівартість поїде.
 */
export function CompleteProductionForm({
  orderId,
  plannedQty,
  outputQty,
  materials,
  defaultBatchCode,
}: {
  orderId: string;
  plannedQty: number;
  outputQty: number;
  materials: Material[];
  defaultBatchCode: string;
}) {
  const [state, formAction, pending] = useActionState(completeProduction, {});
  const [producedQty, setProducedQty] = useState(String(plannedQty));
  const [overhead, setOverhead] = useState('0');
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const produced = Number(String(producedQty).replace(',', '.')) || 0;

  const rows = useMemo(
    () =>
      materials.map((m) => {
        const suggested =
          Math.round(((m.qtyPerBatch * (1 + m.lossPct / 100) * produced) / outputQty) * 1000) / 1000;
        const value = overrides[m.itemId] ?? String(suggested);
        const qty = Number(value.replace(',', '.')) || 0;
        return { ...m, suggested, value, qty, cost: qty * m.avgCost, short: qty > m.available + 0.0005 };
      }),
    [materials, produced, outputQty, overrides],
  );

  const materialCost = rows.reduce((sum, r) => sum + r.cost, 0);
  const overheadNum = Number(String(overhead).replace(',', '.')) || 0;
  const unitCost = produced > 0 ? (materialCost + overheadNum) / produced : 0;
  const anyShort = rows.some((r) => r.short);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="order_id" value={orderId} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Фактичний випуск, шт">
          <input
            name="produced_qty"
            type="number"
            step="0.001"
            min="0"
            required
            value={producedQty}
            onChange={(e) => setProducedQty(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Накладні витрати, грн" hint="Праця, енергія, амортизація">
          <input
            name="overhead_cost"
            type="number"
            step="0.01"
            min="0"
            value={overhead}
            onChange={(e) => setOverhead(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Номер партії">
          <input name="batch_code" defaultValue={defaultBatchCode} className={inputClass} />
        </Field>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-emerald-900">
          Фактично списано у варку
        </h3>
        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.itemId}
              className="flex flex-wrap items-end gap-3 rounded-xl border border-emerald-900/10 bg-emerald-50/40 p-3"
            >
              <div className="min-w-40 flex-1">
                <div className="font-semibold text-emerald-950">{r.name}</div>
                <div className="text-xs text-emerald-800/60">
                  на складі {fmtQty(r.available, unitLabel(r.unit))} · норма {fmtQty(r.suggested)}
                </div>
              </div>
              <div className="w-32">
                <input
                  name={`consume_${r.itemId}`}
                  type="number"
                  step="0.001"
                  min="0"
                  value={r.value}
                  onChange={(e) => setOverrides((prev) => ({ ...prev, [r.itemId]: e.target.value }))}
                  className={`${inputClass} ${r.short ? 'border-red-400 bg-red-50' : ''}`}
                />
              </div>
              <div className="w-24 text-right text-sm text-emerald-800/70">{fmtMoney(r.cost)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-emerald-900/10 bg-white p-4 text-sm">
        <div className="flex justify-between">
          <span className="text-emerald-800/70">Сировина</span>
          <span className="font-semibold tabular-nums">{fmtMoney(materialCost)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-emerald-800/70">Накладні</span>
          <span className="font-semibold tabular-nums">{fmtMoney(overheadNum)}</span>
        </div>
        <div className="mt-2 flex justify-between border-t border-emerald-900/10 pt-2 text-base">
          <span className="font-bold text-emerald-900">Собівартість одиниці</span>
          <span className="font-bold tabular-nums text-emerald-700">{fmtMoney(unitCost)}</span>
        </div>
      </div>

      {anyShort && (
        <Alert tone="amber">
          Списання перевищує залишок сировини — операція не пройде, доки не оприбуткуєте прихід.
        </Alert>
      )}
      {state.error && <Alert tone="red">{state.error}</Alert>}
      {state.ok && <Alert tone="green">{state.ok}</Alert>}

      <Button type="submit" disabled={pending || produced <= 0}>
        {pending ? 'Проводимо…' : 'Закрити варку й оприбуткувати'}
      </Button>
    </form>
  );
}
