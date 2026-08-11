'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import type { ActionState } from '@/lib/action-state';
import { Alert, Button } from './ui';

/**
 * Введення рядків надходження як із паперової накладної: таблиця
 * «№ · номенклатура · кількість · ціна · сума» з підсумками внизу і одним
 * збереженням на весь документ. Позиція шукається набором назви чи артикулу
 * (datalist), сканером теж можна — штрихкод розпізнається так само.
 */

export interface EntryItem {
  id: string;
  name: string;
  sku: string;
  unit: string;
  kind: string;
  vat_rate: number;
  barcode: string | null;
}

interface RowState {
  key: number;
  text: string;
  itemId: string | null;
  qty: string;
  price: string;
  batch: string;
  expires: string;
}

const emptyRow = (key: number): RowState => ({
  key,
  text: '',
  itemId: null,
  qty: '',
  price: '',
  batch: '',
  expires: '',
});

const toNum = (v: string) => {
  const n = Number(v.replace(',', '.').trim());
  return Number.isFinite(n) ? n : 0;
};

const fmt = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ReceiptEntry({
  receiptId,
  items,
  pricesIncludeVat,
  action,
}: {
  receiptId: string;
  items: EntryItem[];
  pricesIncludeVat: boolean;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [rows, setRows] = useState<RowState[]>(() => [1, 2, 3, 4, 5].map(emptyRow));
  const nextKey = useRef(6);
  const [clientError, setClientError] = useState('');
  const [state, formAction, pending] = useActionState(action, {});

  // Ярлик «Назва (SKU)» — унікальний і читається як у паперовій накладній.
  const labelOf = useMemo(() => {
    const m = new Map<string, EntryItem>();
    for (const i of items) m.set(i.id, i);
    return (id: string | null) => (id ? m.get(id) ?? null : null);
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

  // Після успішного збереження таблиця очищається під наступну накладну.
  useEffect(() => {
    if (state.ok) {
      setRows([1, 2, 3, 4, 5].map((n) => emptyRow(nextKey.current + n)));
      nextKey.current += 6;
    }
  }, [state]);

  const update = (index: number, patch: Partial<RowState>) => {
    setClientError('');
    setRows((prev) => {
      const next = prev.map((r, i) => (i === index ? { ...r, ...patch } : r));
      // Останній рядок заповнили — одразу підставляємо новий порожній,
      // щоб не тягнутися до кнопки після кожної позиції.
      if (index === prev.length - 1 && (patch.text ?? '') !== '') {
        next.push(emptyRow(nextKey.current));
        nextKey.current += 1;
      }
      return next;
    });
  };

  const resolve = (text: string): string | null => byText.get(text.trim().toLowerCase()) ?? null;

  const filled = rows.filter((r) => r.text.trim() !== '' || r.qty.trim() !== '' || r.price.trim() !== '');

  const totals = filled.reduce(
    (acc, r) => {
      const item = labelOf(r.itemId);
      if (!item) return acc;
      const gross = toNum(r.qty) * toNum(r.price);
      const rate = Number(item.vat_rate) / 100;
      const net = pricesIncludeVat ? gross / (1 + rate) : gross;
      const vat = pricesIncludeVat ? gross - net : gross * rate;
      return { net: acc.net + net, vat: acc.vat + vat, gross: acc.gross + net + vat };
    },
    { net: 0, vat: 0, gross: 0 },
  );

  const submit = (formData: FormData) => {
    const bad = filled.findIndex((r) => r.itemId === null);
    if (bad >= 0) {
      setClientError(
        `Рядок ${bad + 1}: «${filled[bad].text}» не знайдено в довіднику. Оберіть позицію з підказки — довільний текст сюди не потрапляє.`,
      );
      return;
    }
    if (filled.length === 0) {
      setClientError('Заповніть хоча б один рядок');
      return;
    }
    formData.set(
      'lines',
      JSON.stringify(
        filled.map((r) => ({
          item_id: r.itemId,
          qty: toNum(r.qty),
          unit_price: toNum(r.price),
          batch_code: r.batch,
          expires_on: r.expires,
        })),
      ),
    );
    formAction(formData);
  };

  const UNIT_LABELS: Record<string, string> = { kg: 'кг', g: 'г', l: 'л', ml: 'мл', pcs: 'шт', pack: 'уп' };

  return (
    <form action={submit} className="space-y-3">
      <input type="hidden" name="receipt_id" value={receiptId} />
      <datalist id="receipt-items">
        {items.map((i) => (
          <option key={i.id} value={`${i.name} (${i.sku})`} />
        ))}
      </datalist>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-emerald-900/15 text-left text-xs uppercase tracking-wide text-emerald-800/60">
              <th className="w-8 py-2 pr-2">№</th>
              <th className="py-2 pr-2">Номенклатура</th>
              <th className="w-14 py-2 pr-2">Од.</th>
              <th className="w-24 py-2 pr-2 text-right">К-сть</th>
              <th className="w-28 py-2 pr-2 text-right">Ціна</th>
              <th className="w-28 py-2 pr-2 text-right">Сума</th>
              <th className="w-28 py-2 pr-2">Партія</th>
              <th className="w-36 py-2 pr-2">Придатний до</th>
              <th className="w-8 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const item = labelOf(r.itemId);
              const isService = item?.kind === 'service';
              const amount = toNum(r.qty) * toNum(r.price);
              const cell = 'w-full rounded-lg border border-emerald-900/15 bg-white px-2 py-1.5 text-sm';
              return (
                <tr key={r.key} className="border-b border-emerald-900/5 align-top">
                  <td className="py-1.5 pr-2 pt-3 text-emerald-800/50">{i + 1}</td>
                  <td className="py-1.5 pr-2">
                    <input
                      name={`row_item_${i}`}
                      list="receipt-items"
                      value={r.text}
                      onChange={(e) => update(i, { text: e.target.value, itemId: resolve(e.target.value) })}
                      placeholder="назва, артикул або штрихкод…"
                      className={`${cell} min-w-64 ${r.text && !r.itemId ? 'border-amber-400' : ''}`}
                      autoComplete="off"
                    />
                  </td>
                  <td className="py-1.5 pr-2 pt-3 text-emerald-800/70" data-row-unit={i}>
                    {item ? (isService ? 'посл.' : UNIT_LABELS[item.unit] ?? item.unit) : '—'}
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
                      name={`row_price_${i}`}
                      value={r.price}
                      onChange={(e) => update(i, { price: e.target.value })}
                      inputMode="decimal"
                      className={`${cell} text-right`}
                    />
                  </td>
                  <td className="py-1.5 pr-2 pt-3 text-right font-semibold tabular-nums" data-row-amount={i}>
                    {amount > 0 ? fmt.format(amount) : '—'}
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      name={`row_batch_${i}`}
                      value={r.batch}
                      onChange={(e) => update(i, { batch: e.target.value })}
                      disabled={isService}
                      placeholder={isService ? '—' : 'з накладної'}
                      className={`${cell} disabled:bg-emerald-900/5`}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      name={`row_expires_${i}`}
                      type="date"
                      value={r.expires}
                      onChange={(e) => update(i, { expires: e.target.value })}
                      disabled={isService}
                      className={`${cell} disabled:bg-emerald-900/5`}
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

      <div className="flex flex-wrap items-start justify-between gap-3">
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
        <div className="min-w-56 space-y-1 text-right text-sm" data-entry-totals>
          <div className="flex justify-between gap-6">
            <span className="text-emerald-800/60">Разом без ПДВ</span>
            <span className="font-semibold tabular-nums">{fmt.format(totals.net)}</span>
          </div>
          <div className="flex justify-between gap-6">
            <span className="text-emerald-800/60">ПДВ</span>
            <span className="font-semibold tabular-nums">{fmt.format(totals.vat)}</span>
          </div>
          <div className="flex justify-between gap-6 border-t border-emerald-900/15 pt-1 text-base">
            <span className="font-semibold">Разом</span>
            <span className="font-bold tabular-nums">{fmt.format(totals.gross)}</span>
          </div>
        </div>
      </div>

      {clientError && <Alert tone="red">{clientError}</Alert>}
      {state.error && <Alert tone="red">{state.error}</Alert>}
      {state.ok && <Alert tone="green">{state.ok}</Alert>}
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Зберігається…' : 'Додати рядки в накладну'}
      </Button>
    </form>
  );
}
