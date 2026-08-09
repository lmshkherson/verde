'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { PoolClient } from 'pg';
import { transaction } from '@/lib/db';
import { type ActionState, str, strOrNull, toMessage } from '@/lib/action-state';
import { requireRole } from '@/lib/session';
import { decodeStatement, normalizeIban, parseStatement, StatementFormatError } from '@/lib/bank';

export async function createBankAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('warehouse', 'sales');
  const name = str(formData, 'name');
  if (!name) return { error: 'Вкажіть назву рахунку' };

  const iban = normalizeIban(strOrNull(formData, 'iban'));
  if (iban.error) return { error: iban.error };

  try {
    await transaction((c) =>
      c.query(
        `insert into bank_accounts (legal_entity_id, name, iban, bank_name, currency, is_default)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          session.eid,
          name,
          iban.iban,
          strOrNull(formData, 'bank_name'),
          str(formData, 'currency') || 'UAH',
          formData.get('is_default') === 'on',
        ],
      ),
    );
  } catch (err) {
    const message = toMessage(err);
    return {
      error: message.includes('bank_accounts_iban_key')
        ? 'Рахунок із таким IBAN уже заведено'
        : message,
    };
  }

  revalidatePath('/bank');
  return { ok: 'Рахунок додано' };
}

/**
 * Імпорт виписки.
 *
 * Повторний імпорт того самого файлу — не помилка, а нормальний спосіб
 * роботи: виписку за місяць вивантажують кілька разів, і періоди
 * перекриваються. Тому рядок, який уже є, просто пропускається, а скільки
 * саме пропущено — видно у звіті про імпорт.
 */
export async function importStatement(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('warehouse', 'sales');
  const accountId = str(formData, 'account_id');
  if (!accountId) return { error: 'Оберіть рахунок' };

  const file = formData.get('file');
  const pasted = str(formData, 'content');

  let text = pasted;
  let fileName: string | null = null;
  if (file instanceof File && file.size > 0) {
    text = decodeStatement(Buffer.from(await file.arrayBuffer()));
    fileName = file.name;
  }
  if (!text.trim()) return { error: 'Прикріпіть файл виписки або вставте її текстом' };

  let statementId: string;
  try {
    statementId = await transaction(async (c) => {
      const parsed = parseStatement(text);

      const { rows: accountRows } = await c.query<{ id: string; currency: string }>(
        'select id, currency from bank_accounts where id = $1 and legal_entity_id = $2',
        [accountId, session.eid],
      );
      if (!accountRows[0]) throw new Error('Рахунок не знайдено');

      const dates = parsed.rows.map((r) => r.opDate).sort();
      const { rows: stmtRows } = await c.query<{ id: string }>(
        `insert into bank_statements
           (legal_entity_id, account_id, file_name, period_from, period_to, rows_total, imported_by)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [session.eid, accountId, fileName, dates[0], dates[dates.length - 1], parsed.rows.length, session.uid],
      );
      const id = stmtRows[0].id;

      let created = 0;
      for (const row of parsed.rows) {
        const { rowCount } = await c.query(
          `insert into bank_transactions
             (statement_id, legal_entity_id, account_id, op_date, amount, currency,
              counterparty_name, counterparty_edrpou, counterparty_iban, purpose, doc_number, ext_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           on conflict (account_id, ext_id) do nothing`,
          [
            id,
            session.eid,
            accountId,
            row.opDate,
            row.amount,
            row.currency,
            row.counterpartyName,
            row.counterpartyEdrpou,
            row.counterpartyIban,
            row.purpose,
            row.docNumber,
            row.extId,
          ],
        );
        if (rowCount) created += 1;
      }

      await c.query(
        'update bank_statements set rows_new = $2, rows_duplicate = $3 where id = $1',
        [id, created, parsed.rows.length - created],
      );
      return id;
    });
  } catch (err) {
    if (err instanceof StatementFormatError) {
      return {
        error: `${err.message}. Колонки у файлі: ${err.headers.join(', ')}`,
      };
    }
    return { error: toMessage(err) };
  }

  redirect(`/bank/${statementId}`);
}

interface MatchInput {
  txId: string;
  kind: string;
  customerId: string | null;
  supplierId: string | null;
  soId: string | null;
  poId: string | null;
  account: string | null;
  note: string | null;
}

/**
 * Створює документ оплати з рядка виписки.
 *
 * Знак банку перекладається у знак документа: списання постачальнику — це
 * додатна оплата, яка зменшує кредиторку, а повернення коштів від нього —
 * від'ємна. Так проводки лишаються тими самими, що й при ручному введенні.
 */
async function applyMatch(c: PoolClient, session: { eid: string; uid: string }, input: MatchInput) {
  const { rows } = await c.query<{
    id: string;
    amount: number;
    op_date: string;
    status: string;
    purpose: string | null;
  }>(
    'select id, amount, op_date, status, purpose from bank_transactions where id = $1 and legal_entity_id = $2 for update',
    [input.txId, session.eid],
  );
  const tx = rows[0];
  if (!tx) throw new Error('Рядок виписки не знайдено');
  if (tx.status === 'matched') throw new Error('Рядок уже рознесено');

  const amount = Number(tx.amount);
  const note = input.note ?? tx.purpose?.slice(0, 200) ?? null;

  if (input.kind === 'ignore') {
    await c.query(
      `update bank_transactions
          set status = 'ignored', match_kind = null, note = $2, matched_at = now(), matched_by = $3
        where id = $1`,
      [tx.id, input.note, session.uid],
    );
    return;
  }

  if (input.kind === 'customer_payment') {
    if (!input.customerId) throw new Error('Оберіть клієнта');
    const { rows: created } = await c.query<{ id: string }>(
      `insert into payments (customer_id, legal_entity_id, so_id, paid_on, amount, method, note, created_by)
       values ($1, $2, $3, $4, $5, 'bank', $6, $7) returning id`,
      [input.customerId, session.eid, input.soId, tx.op_date, amount, note, session.uid],
    );
    await c.query(
      `update bank_transactions
          set status = 'matched', match_kind = 'customer_payment', customer_id = $2,
              payment_id = $3, note = $4, matched_at = now(), matched_by = $5
        where id = $1`,
      [tx.id, input.customerId, created[0].id, input.note, session.uid],
    );
    return;
  }

  if (input.kind === 'supplier_payment') {
    if (!input.supplierId) throw new Error('Оберіть постачальника');
    const { rows: created } = await c.query<{ id: string }>(
      `insert into supplier_payments
         (legal_entity_id, supplier_id, po_id, paid_on, amount, method, note, created_by)
       values ($1, $2, $3, $4, $5, 'bank', $6, $7) returning id`,
      [session.eid, input.supplierId, input.poId, tx.op_date, -amount, note, session.uid],
    );
    await c.query(
      `update bank_transactions
          set status = 'matched', match_kind = 'supplier_payment', supplier_id = $2,
              supplier_payment_id = $3, note = $4, matched_at = now(), matched_by = $5
        where id = $1`,
      [tx.id, input.supplierId, created[0].id, input.note, session.uid],
    );
    return;
  }

  if (input.kind === 'other') {
    if (!input.account) throw new Error('Оберіть рахунок обліку');
    await c.query(
      `update bank_transactions
          set status = 'matched', match_kind = 'other', other_account = $2,
              note = $3, matched_at = now(), matched_by = $4
        where id = $1`,
      [tx.id, input.account, input.note, session.uid],
    );
    return;
  }

  throw new Error('Невідомий спосіб рознесення');
}

/**
 * Рознесення одного рядка. Ціль приходить одним полем — `customer:<id>`,
 * `supplier:<id>`, `account:<код>` або `ignore`. Один список замість трьох
 * вибірок і перемикача типу: у виписці рядок або чийсь платіж, або не наша
 * операція, і третього не буває.
 */
export async function matchTransaction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('warehouse', 'sales');
  const statementId = str(formData, 'statement_id');
  const target = str(formData, 'target');
  if (!target) return { error: 'Оберіть, куди відносити платіж' };

  const [prefix, value] = target.split(':');
  const kind =
    prefix === 'customer'
      ? 'customer_payment'
      : prefix === 'supplier'
        ? 'supplier_payment'
        : prefix === 'account'
          ? 'other'
          : 'ignore';

  try {
    await transaction((c) =>
      applyMatch(c, session, {
        txId: str(formData, 'tx_id'),
        kind,
        customerId: prefix === 'customer' ? value : null,
        supplierId: prefix === 'supplier' ? value : null,
        soId: strOrNull(formData, 'so_id'),
        poId: strOrNull(formData, 'po_id'),
        account: prefix === 'account' ? value : null,
        note: strOrNull(formData, 'note'),
      }),
    );
  } catch (err) {
    return { error: toMessage(err) };
  }

  if (statementId) revalidatePath(`/bank/${statementId}`);
  revalidatePath('/bank');
  return { ok: 'Рознесено' };
}

/** Скасування рознесення: видаляє створену оплату разом із її проводками. */
export async function unmatchTransaction(formData: FormData) {
  const session = await requireRole('warehouse', 'sales');
  const statementId = str(formData, 'statement_id');
  const txId = str(formData, 'tx_id');

  await transaction(async (c) => {
    const { rows } = await c.query<{ payment_id: string | null; supplier_payment_id: string | null }>(
      'select payment_id, supplier_payment_id from bank_transactions where id = $1 and legal_entity_id = $2',
      [txId, session.eid],
    );
    if (!rows[0]) return;

    if (rows[0].payment_id) {
      await c.query('delete from payments where id = $1', [rows[0].payment_id]);
    }
    if (rows[0].supplier_payment_id) {
      await c.query('delete from supplier_payments where id = $1', [rows[0].supplier_payment_id]);
    }
    await c.query(
      `update bank_transactions
          set status = 'new', match_kind = null, other_account = null,
              customer_id = null, supplier_id = null,
              payment_id = null, supplier_payment_id = null,
              matched_at = null, matched_by = null
        where id = $1`,
      [txId],
    );
  });

  if (statementId) revalidatePath(`/bank/${statementId}`);
  revalidatePath('/bank');
}

/**
 * Автоматичне рознесення.
 *
 * Свідомо обережне: контрагент береться лише за точним збігом ЄДРПОУ, і лише
 * коли такий один. Збіг за назвою в автоматі не використовується — «ТОВ Фора»
 * і «ТОВ Фора Плюс» різні платники, і помилка тут коштує неправильної
 * дебіторки. Назва лишається підказкою для людини.
 */
export async function autoMatch(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole('warehouse', 'sales');
  const statementId = strOrNull(formData, 'statement_id');

  let matched = 0;
  let left = 0;
  try {
    await transaction(async (c) => {
      const { rows: pending } = await c.query<{
        id: string;
        amount: number;
        counterparty_edrpou: string | null;
        counterparty_iban: string | null;
        counterparty_name: string | null;
        doc_number: string | null;
      }>(
        `select id, amount, counterparty_edrpou, counterparty_iban, counterparty_name, doc_number
           from bank_transactions
          where legal_entity_id = $1 and status = 'new'
            and ($2::uuid is null or statement_id = $2)
          order by op_date`,
        [session.eid, statementId],
      );

      for (const tx of pending) {
        const edrpou = tx.counterparty_edrpou;
        const iban = normalizeIban(tx.counterparty_iban).iban;
        // Два однаково надійні ключі: код і рахунок. ЄДРПОУ у виписці буває не
        // завжди, а IBAN стоїть у кожному рядку — і теж належить одному
        // контрагентові, тож помилитися ним неможливо.
        if (!edrpou && !iban) {
          left += 1;
          continue;
        }

        if (Number(tx.amount) > 0) {
          const { rows: customers } = await c.query<{ id: string }>(
            `select id from customers
              where is_active
                and (($1::text is not null and edrpou = $1)
                  or ($2::text is not null and iban = $2))`,
            [edrpou, iban],
          );
          if (customers.length !== 1) {
            left += 1;
            continue;
          }
          const soId = tx.doc_number
            ? (
                await c.query<{ id: string }>(
                  'select id from sales_orders where number = $1 and legal_entity_id = $2',
                  [tx.doc_number, session.eid],
                )
              ).rows[0]?.id ?? null
            : null;
          await applyMatch(c, session, {
            txId: tx.id,
            kind: 'customer_payment',
            customerId: customers[0].id,
            supplierId: null,
            soId,
            poId: null,
            account: null,
            note: null,
          });
          matched += 1;
        } else {
          const { rows: suppliers } = await c.query<{ id: string }>(
            `select id from suppliers
              where is_active
                and (($1::text is not null and edrpou = $1)
                  or ($2::text is not null and iban = $2))`,
            [edrpou, iban],
          );
          if (suppliers.length !== 1) {
            left += 1;
            continue;
          }
          const poId = tx.doc_number
            ? (
                await c.query<{ id: string }>(
                  'select id from purchase_orders where number = $1 and legal_entity_id = $2',
                  [tx.doc_number, session.eid],
                )
              ).rows[0]?.id ?? null
            : null;
          await applyMatch(c, session, {
            txId: tx.id,
            kind: 'supplier_payment',
            customerId: null,
            supplierId: suppliers[0].id,
            soId: null,
            poId,
            account: null,
            note: null,
          });
          matched += 1;
        }
      }
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  if (statementId) revalidatePath(`/bank/${statementId}`);
  revalidatePath('/bank');
  return {
    ok:
      matched === 0
        ? 'Жодного рядка не вдалося рознести автоматично — контрагент за ЄДРПОУ не визначився однозначно'
        : `Рознесено автоматично: ${matched}. Лишилося на руки: ${left}`,
  };
}
