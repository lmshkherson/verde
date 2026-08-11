'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import type { ActionState } from '@/lib/action-state';
import { Alert, Button } from './ui';

/**
 * Введення рядків документа як із паперової накладної: таблиця
 * «№ · номенклатура · кількість · ціна без ПДВ · ціна з ПДВ · сума без ПДВ ·
 * сума з ПДВ» з підсумками внизу і одним збереженням на весь документ.
 *
 * Чотири грошові поля рахуються одне з одного в обидва боки: у паперових
 * накладних постачальники друкують хто ціну без податку, хто суму з ним —
 * оператор вводить те, що бачить, решта заповнюється сама за ставкою ПДВ
 * із картки позиції.
 */

export interface EntryItem {
  id: string;
  name: string;
  sku: string;
  unit: string;
  kind: string;
  /** Ефективна ставка для цього документа — сторінка вже врахувала юрособу. */
  vat_rate: number;
  barcode: string | null;
  /** Ціна без ПДВ, що підставиться сама, щойно позицію розпізнано (прайс). */
  defaultPrice?: number | null;
  /** Довідка під назвою: «доступно 120 шт» тощо. */
  hint?: string;
}

interface RowState {
  key: number;
  text: string;
  itemId: string | null;
  qty: string;
  priceNet: string;
  priceGross: string;
  sumNet: string;
  sumGross: string;
  batch: string;
  expires: string;
}

type MoneyField = 'priceNet' | 'priceGross' | 'sumNet' | 'sumGross';

const emptyRow = (key: number): RowState => ({
  key,
  text: '',
  itemId: null,
  qty: '',
  priceNet: '',
  priceGross: '',
  sumNet: '',
  sumGross: '',
  batch: '',
  expires: '',
});

const toNum = (v: string) => {
  const n = Number(v.replace(',', '.').trim());
  return Number.isFinite(n) ? n : 0;
};

/** До 4 знаків для цін, без хвоста нулів — як пишуть у накладних. */
const fmtPrice = (n: number) => String(Math.round(n * 10000) / 10000);
const fmtSum = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

const fmt = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function LinesEntry({
  docField,
  docId,
  items,
  pricesIncludeVat,
  showBatch = true,
  submitLabel = 'Додати рядки в накладну',
  action,
}: {
  /** Ім'я прихованого поля документа: receipt_id, so_id чи po_id. */
  docField: string;
  docId: string;
  items: EntryItem[];
  /** Як трактувати ціну при збереженні — так само, як рахує проведення. */
  pricesIncludeVat: boolean;
  /** Партія і термін придатності потрібні лише в надходженні. */
  showBatch?: boolean;
  submitLabel?: string;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [rows, setRows] = useState<RowState[]>(() => [1, 2, 3, 4, 5].map(emptyRow));
  const nextKey = useRef(6);
  const [clientError, setClientError] = useState('');
  const [state, formAction, pending] = useActionState(action, {});

  const itemById = useMemo(() => {
    const m = new Map<string, EntryItem>();
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

  // Після успішного збереження таблиця очищається під наступну накладну.
  useEffect(() => {
    if (state.ok) {
      setRows([1, 2, 3, 4, 5].map((n) => emptyRow(nextKey.current + n)));
      nextKey.current += 6;
    }
  }, [state]);

  const rateOf = (r: RowState) => Number(itemById.get(r.itemId ?? '')?.vat_rate ?? 20) / 100;

  /**
   * Перерахунок чотирьох грошових полів від одного зміненого. Канонічне
   * значення — ціна без ПДВ; редаговане поле зберігає текст, як його
   * набрали, решта форматуються.
   */
  const recalc = (row: RowState, edited: MoneyField | 'qty', raw: string): RowState => {
    const next = { ...row, [edited]: raw } as RowState;
    const rate = rateOf(next);
    const qty = toNum(next.qty);

    let priceNet: number | null = null;
    if (edited === 'priceNet') priceNet = toNum(raw);
    else if (edited === 'priceGross') priceNet = toNum(raw) / (1 + rate);
    else if (edited === 'sumNet') priceNet = qty > 0 ? toNum(raw) / qty : null;
    else if (edited === 'sumGross') priceNet = qty > 0 ? toNum(raw) / (1 + rate) / qty : null;
    else if (edited === 'qty') {
      // Кількість змінилась — ціни лишаються, суми перераховуються.
      priceNet = next.priceNet !== '' ? toNum(next.priceNet) : next.priceGross !== '' ? toNum(next.priceGross) / (1 + rate) : null;
    }

    if (raw.trim() === '' && edited !== 'qty') {
      return { ...next, priceNet: '', priceGross: '', sumNet: '', sumGross: '', [edited]: raw };
    }
    if (priceNet === null || !Number.isFinite(priceNet)) return next;

    if (edited !== 'priceNet') next.priceNet = fmtPrice(priceNet);
    if (edited !== 'priceGross') next.priceGross = fmtPrice(priceNet * (1 + rate));
    if (edited !== 'sumNet') next.sumNet = qty > 0 ? fmtSum(priceNet * qty) : '';
    if (edited !== 'sumGross') next.sumGross = qty > 0 ? fmtSum(priceNet * (1 + rate) * qty) : '';
    return next;
  };

  const update = (index: number, patch: Partial<RowState>, edited?: MoneyField | 'qty') => {
    setClientError('');
    setRows((prev) => {
      const next = prev.map((r, i) => {
        if (i !== index) return r;
        const merged = { ...r, ...patch };
        // Позиція щойно розпізналась — перерахувати від уже набраної ціни
        // за її ставкою ПДВ, а коли ціни ще немає — підставити з прайсу.
        if (patch.itemId && patch.itemId !== r.itemId) {
          if (merged.priceNet !== '') return recalc(merged, 'priceNet', merged.priceNet);
          if (merged.priceGross !== '') return recalc(merged, 'priceGross', merged.priceGross);
          const preset = itemById.get(patch.itemId)?.defaultPrice;
          if (preset && preset > 0) return recalc(merged, 'priceNet', fmtPrice(Number(preset)));
          return merged;
        }
        return edited ? recalc(merged, edited, String(patch[edited] ?? '')) : merged;
      });
      if (index === prev.length - 1 && (patch.text ?? '') !== '') {
        next.push(emptyRow(nextKey.current));
        nextKey.current += 1;
      }
      return next;
    });
  };

  const resolve = (text: string): string | null => byText.get(text.trim().toLowerCase()) ?? null;

  const filled = rows.filter(
    (r) => r.text.trim() !== '' || r.qty.trim() !== '' || r.priceNet !== '' || r.priceGross !== '',
  );

  const totals = filled.reduce(
    (acc, r) => {
      if (!r.itemId) return acc;
      const qty = toNum(r.qty);
      const pn = toNum(r.priceNet);
      const rate = rateOf(r);
      const net = pn * qty;
      const vat = net * rate;
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
          // Документ зберігає ціну в тому вигляді, який оголошено в шапці
          // («ціни з ПДВ» чи без) — рівно як рахує проведення.
          unit_price: toNum(pricesIncludeVat ? r.priceGross : r.priceNet),
          batch_code: r.batch,
          expires_on: r.expires,
        })),
      ),
    );
    formAction(formData);
  };

  const UNIT_LABELS: Record<string, string> = { kg: 'кг', g: 'г', l: 'л', ml: 'мл', pcs: 'шт', pack: 'уп' };
  const cell = 'w-full rounded-lg border border-emerald-900/15 bg-white px-2 py-1.5 text-sm';

  return (
    <form action={submit} className="space-y-3">
      <input type="hidden" name={docField} value={docId} />
      <datalist id="entry-items">
        {items.map((i) => (
          <option key={i.id} value={`${i.name} (${i.sku})`} />
        ))}
      </datalist>

      <div className="overflow-x-auto">
        <table className={`w-full ${showBatch ? 'min-w-[1040px]' : 'min-w-[820px]'} border-collapse text-sm`}>
          <thead>
            <tr className="border-b border-emerald-900/15 text-left text-xs uppercase tracking-wide text-emerald-800/60">
              <th className="w-8 py-2 pr-2">№</th>
              <th className="py-2 pr-2">Номенклатура</th>
              <th className="w-12 py-2 pr-2">Од.</th>
              <th className="w-20 py-2 pr-2 text-right">К-сть</th>
              <th className="w-24 py-2 pr-2 text-right">Ціна без ПДВ</th>
              <th className="w-24 py-2 pr-2 text-right">Ціна з ПДВ</th>
              <th className="w-24 py-2 pr-2 text-right">Сума без ПДВ</th>
              <th className="w-24 py-2 pr-2 text-right">Сума з ПДВ</th>
              {showBatch && <th className="w-24 py-2 pr-2">Партія</th>}
              {showBatch && <th className="w-32 py-2 pr-2">Придатний до</th>}
              <th className="w-8 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const item = itemById.get(r.itemId ?? '') ?? null;
              const isService = item?.kind === 'service';
              const money: [MoneyField, string][] = [
                ['priceNet', r.priceNet],
                ['priceGross', r.priceGross],
                ['sumNet', r.sumNet],
                ['sumGross', r.sumGross],
              ];
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
                    {item && (
                      <div className="mt-0.5 text-[11px] text-emerald-800/50">
                        ПДВ {Number(item.vat_rate)}%
                        {isService ? ' · послуга — піде у витрати' : ''}
                        {item.hint ? ` · ${item.hint}` : ''}
                      </div>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 pt-3 text-emerald-800/70" data-row-unit={i}>
                    {item ? (isService ? 'посл.' : UNIT_LABELS[item.unit] ?? item.unit) : '—'}
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      name={`row_qty_${i}`}
                      value={r.qty}
                      onChange={(e) => update(i, { qty: e.target.value }, 'qty')}
                      inputMode="decimal"
                      className={`${cell} text-right`}
                    />
                  </td>
                  {money.map(([field, value]) => (
                    <td key={field} className="py-1.5 pr-2">
                      <input
                        name={`row_${field === 'priceNet' ? 'price_net' : field === 'priceGross' ? 'price_gross' : field === 'sumNet' ? 'sum_net' : 'sum_gross'}_${i}`}
                        value={value}
                        onChange={(e) => update(i, { [field]: e.target.value }, field)}
                        inputMode="decimal"
                        className={`${cell} text-right tabular-nums`}
                      />
                    </td>
                  ))}
                  {showBatch && (
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
                  )}
                  {showBatch && (
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
                  )}
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
            <span className="font-semibold tabular-nums" data-total-net>{fmt.format(totals.net)}</span>
          </div>
          <div className="flex justify-between gap-6">
            <span className="text-emerald-800/60">ПДВ</span>
            <span className="font-semibold tabular-nums" data-total-vat>{fmt.format(totals.vat)}</span>
          </div>
          <div className="flex justify-between gap-6 border-t border-emerald-900/15 pt-1 text-base">
            <span className="font-semibold">Разом з ПДВ</span>
            <span className="font-bold tabular-nums" data-total-gross>{fmt.format(totals.gross)}</span>
          </div>
        </div>
      </div>

      {clientError && <Alert tone="red">{clientError}</Alert>}
      {state.error && <Alert tone="red">{state.error}</Alert>}
      {state.ok && <Alert tone="green">{state.ok}</Alert>}
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Зберігається…' : submitLabel}
      </Button>
    </form>
  );
}
