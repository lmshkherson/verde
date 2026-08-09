import { matchTransaction, unmatchTransaction } from '@/app/actions/bank';
import { ActionForm } from './action-form';
import { Badge, inputClass } from './ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { suggestByName } from '@/lib/bank';

export interface BankTx {
  id: string;
  op_date: string;
  amount: number;
  counterparty_name: string | null;
  counterparty_edrpou: string | null;
  counterparty_iban: string | null;
  purpose: string | null;
  doc_number: string | null;
  status: string;
  match_kind: string | null;
  other_account: string | null;
  note: string | null;
  matched_name: string | null;
}

export interface Party {
  id: string;
  name: string;
  edrpou: string | null;
  iban: string | null;
}

/** Рахунки для операцій, у яких контрагента як такого немає. */
export const OTHER_ACCOUNTS: [string, string][] = [
  ['92', 'Комісія банку та адмінвитрати'],
  ['641', 'Сплата податків'],
  ['651', 'Сплата ЄСВ'],
];

/**
 * Рядок виписки з формою рознесення.
 *
 * Ціль вибирається одним списком: клієнт, постачальник, рахунок обліку або
 * «не потребує». Підказка за ЄДРПОУ чи назвою одразу підставляється в select,
 * але лишається саме підказкою — рознесення підтверджує людина.
 */
export function BankRow({
  tx,
  customers,
  suppliers,
  statementId,
}: {
  tx: BankTx;
  customers: Party[];
  suppliers: Party[];
  statementId?: string;
}) {
  const inflow = Number(tx.amount) > 0;
  const pool = inflow ? customers : suppliers;
  const prefix = inflow ? 'customer' : 'supplier';

  const byCode =
    (tx.counterparty_edrpou ? pool.find((p) => p.edrpou === tx.counterparty_edrpou) : undefined) ??
    (tx.counterparty_iban ? pool.find((p) => p.iban === tx.counterparty_iban) : undefined);
  const suggestedId = byCode?.id ?? suggestByName(tx.counterparty_name, pool);
  const suggested = suggestedId ? `${prefix}:${suggestedId}` : '';

  return (
    <div className="rounded-xl border border-emerald-900/10 p-3" data-tx={tx.id}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="text-xs text-emerald-800/60">{fmtDate(tx.op_date)}</span>
          <span className="ml-2 font-semibold text-emerald-950">
            {tx.counterparty_name ?? 'Без назви контрагента'}
          </span>
          {tx.counterparty_edrpou && (
            <span className="ml-2 text-xs text-emerald-800/50">{tx.counterparty_edrpou}</span>
          )}
          {tx.purpose && (
            <div className="mt-0.5 truncate text-xs text-emerald-800/60" title={tx.purpose}>
              {tx.purpose}
            </div>
          )}
        </div>
        <div className={`text-right font-bold tabular-nums ${inflow ? 'text-emerald-700' : 'text-red-600'}`}>
          {inflow ? '+' : '−'}
          {fmtMoney(Math.abs(Number(tx.amount)))}
        </div>
      </div>

      {tx.status === 'new' ? (
        <div className="mt-2">
          <ActionForm action={matchTransaction} submitLabel="Рознести" variant="ghost" hideSuccess>
            <input type="hidden" name="tx_id" value={tx.id} />
            {statementId && <input type="hidden" name="statement_id" value={statementId} />}
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
              <select name="target" defaultValue={suggested} className={inputClass} required>
                <option value="" disabled>
                  Куди відносити…
                </option>
                <optgroup label={inflow ? 'Надходження від клієнта' : 'Оплата постачальнику'}>
                  {pool.map((p) => (
                    <option key={p.id} value={`${prefix}:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={inflow ? 'Повернення постачальника' : 'Повернення клієнту'}>
                  {(inflow ? suppliers : customers).map((p) => (
                    <option key={p.id} value={`${inflow ? 'supplier' : 'customer'}:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Без контрагента">
                  {OTHER_ACCOUNTS.map(([code, label]) => (
                    <option key={code} value={`account:${code}`}>
                      {label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Інше">
                  <option value="ignore">Не потребує рознесення</option>
                </optgroup>
              </select>
              <input
                name="note"
                className={inputClass}
                placeholder={tx.doc_number ? `Документ ${tx.doc_number}` : 'Примітка'}
              />
            </div>
          </ActionForm>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={tx.status === 'ignored' ? 'gray' : 'green'}>
            {tx.status === 'ignored'
              ? 'Не потребує рознесення'
              : tx.match_kind === 'other'
                ? `Рахунок ${tx.other_account}`
                : (tx.matched_name ?? 'Рознесено')}
          </Badge>
          {tx.note && <span className="text-xs text-emerald-800/60">{tx.note}</span>}
          <form action={unmatchTransaction} className="ml-auto">
            <input type="hidden" name="tx_id" value={tx.id} />
            {statementId && <input type="hidden" name="statement_id" value={statementId} />}
            <button className="text-xs font-semibold text-emerald-700 hover:underline">
              Скасувати рознесення
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
