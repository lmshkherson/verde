'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import type { ActionState } from '@/lib/action-state';
import { Alert, Button } from './ui';

/**
 * Введення рядків акта списання: та сама таблиця з підказкою по довіднику,
 * що й у накладних, але без грошових колонок — собівартість визначає
 * проведення (FEFO по партіях), а не оператор.
 */

export interface WriteOffItem {
  id: string;
  name: string;
  sku: string;
  unit: string;
  barcode: string | null;
  /** Довідка під назвою: «доступно 120 шт» тощо. */
  hint?: string;
}

interface RowState {
  key: number;
  text: string;
  itemId: string | null;
  qty: string;
  note: string;
}

const emptyRow = (key: number): RowState => ({ key, text: '', itemId: null, qty: '', note: '' });

const toNum = (v: string) => {
  const n = Number(v.replace(',', '.').trim());
  return Number.isFinite(n) ? n : 0;
};

const UNIT_LABELS: Record<string, string> = { kg: 'кг', g: 'г', l: 'л', ml: 'мл', pcs: 'шт', pack: 'уп' };

export function WriteOffEntry({
  docId,
  items,
  action,
}: {
  docId: string;
  items: WriteOffItem[];
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [rows, setRows] = useState<RowState[]>(() => [1, 2, 3].map(emptyRow));
  const nextKey = useRef(4);
  const [clientError, setClientError] = useState('');
  const [state, formAction, pending] = useActionState(action, {});

  const itemById = useMemo(() => {
    const m = new Map<string, WriteOffItem>();
    for (const i of items) m.set(i.id, i);
    return m;
  }, [items]);

  const byText = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of items) {
      m.set(`${i.name} (${i.sku})`.toLowerCase(), i.id);
      m.set(i.sku.toLowerCase(), i.id);
      if (i.barcode) m.set(i.barcode, i.id);
    }
    return m;
  }, [items]);

  useEffect(() => {
    if (state.ok) {
      setRows([1, 2, 3].map((n) => emptyRow(nextKey.current + n)));
      nextKey.current += 4;
    }
  }, [state]);

  const update = (index: number, patch: Partial<RowState>) => {
    setClientError('');
    setRows((prev) => {
      const next = prev.map((r, i) => (i === index ? { ...r, ...patch } : r));
      if (index === prev.length - 1 && (patch.text ?? '') !== '') {
        next.push(emptyRow(nextKey.current));
        nextKey.current += 1;
      }
      return next;
    });
  };

  const resolve = (text: string): string | null => byText.get(text.trim().toLowerCase()) ?? null;

  const filled = rows.filter((r) => r.text.trim() !== '' || r.qty.trim() !== '');

  const submit = (formData: FormData) => {
    const bad = filled.findIndex((r) => r.itemId === null);
    if (bad >= 0) {
      setClientError(
        `Рядок ${bad + 1}: «${filled[bad].text}» не знайдено в довіднику. Оберіть позицію з підказки.`,
      );
      return;
    }
    if (filled.length === 0) {
      setClientError('Заповніть хоча б один рядок');
      return;
    }
    formData.set(
      'lines',
      JSON.stringify(filled.map((r) => ({ item_id: r.itemId, qty: toNum(r.qty), note: r.note }))),
    );
    formAction(formData);
  };

  const cell = 'w-full rounded-lg border border-emerald-900/15 bg-white px-2 py-1.5 text-sm';

  return (
    <form action={submit} className="space-y-3">
      <input type="hidden" name="write_off_id" value={docId} />
      <datalist id="entry-items">
        {items.map((i) => (
          <option key={i.id} value={`${i.name} (${i.sku})`} />
        ))}
      </datalist>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-emerald-900/15 text-left text-xs uppercase tracking-wide text-emerald-800/60">
              <th className="w-8 py-2 pr-2">№</th>
              <th className="py-2 pr-2">Номенклатура</th>
              <th className="w-12 py-2 pr-2">Од.</th>
              <th className="w-24 py-2 pr-2 text-right">К-сть</th>
              <th className="w-56 py-2 pr-2">Примітка</th>
              <th className="w-8 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const item = itemById.get(r.itemId ?? '') ?? null;
              return (
                <tr key={r.key} className="border-b border-emerald-900/5 align-top">
                  <td className="py-1.5 pr-2 pt-3 text-emerald-800/50">{i + 1}</td>
                  <td className="py-1.5 pr-2">
                    <input
                      name={`row_item_${i}`}
                      list="entry-items"
                      value={r.text}
                      onChange={(e) => update(i, { text: e.target.value, itemId: resolve(e.target.value) })}
                      placeholder="назва, артикул або штрихкод…"
                      className={`${cell} min-w-56 ${r.text && !r.itemId ? 'border-amber-400' : ''}`}
                      autoComplete="off"
                    />
                    {item?.hint && (
                      <div className="mt-0.5 text-[11px] text-emerald-800/50">{item.hint}</div>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 pt-3 text-emerald-800/70" data-row-unit={i}>
                    {item ? UNIT_LABELS[item.unit] ?? item.unit : '—'}
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      name={`row_qty_${i}`}
                      value={r.qty}
                      onChange={(e) => update(i, { qty: e.target.value })}
                      inputMode="decimal"
                      className={`${cell} text-right`}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      name={`row_note_${i}`}
                      value={r.note}
                      onChange={(e) => update(i, { note: e.target.value })}
                      placeholder="причина по рядку (не обов'язково)"
                      className={cell}
                    />
                  </td>
                  <td className="py-1.5 pt-2 text-center">
                    {rows.length > 1 && (
                      <button
                        type="button"
                        aria-label="Прибрати рядок"
                        onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                        className="text-emerald-800/40 hover:text-red-600"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            setRows((prev) => [...prev, emptyRow(nextKey.current)]);
            nextKey.current += 1;
          }}
          className="text-sm font-semibold text-emerald-700 hover:underline"
        >
          + Додати рядок
        </button>
        <p className="text-xs text-emerald-800/50">
          Собівартість порахується при проведенні — за партіями FEFO.
        </p>
      </div>

      {clientError && <Alert tone="red">{clientError}</Alert>}
      {state.error && <Alert tone="red">{state.error}</Alert>}
      {state.ok && <Alert tone="green">{state.ok}</Alert>}
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Зберігається…' : 'Додати рядки в акт'}
      </Button>
    </form>
  );
}
