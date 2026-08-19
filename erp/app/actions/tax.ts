'use server';

import { revalidatePath } from 'next/cache';
import { transaction } from '@/lib/db';
import { type ActionState, num, str, strOrNull, toMessage } from '@/lib/action-state';
import { requireRole } from '@/lib/session';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Умовний ІПН для покупця-неплатника ПДВ. */
const NON_PAYER_IPN = '100000000000';

/**
 * Граничний строк реєстрації в ЄРПН. Правило залежить від половини місяця,
 * у якій складено накладну, а самі дні беруться з налаштувань — вони
 * змінюються законом, і оновлення програми не має бути умовою дотримання строку.
 */
function registerDeadline(issuedOn: string, firstHalfDay: number, secondHalfDay: number): string {
  const date = new Date(issuedOn);
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();

  const deadline =
    day <= 15
      ? new Date(Date.UTC(year, month + 1, firstHalfDay))
      : new Date(Date.UTC(year, month + 1, secondHalfDay));

  return deadline.toISOString().slice(0, 10);
}

/**
 * Виписує податкові накладні на всі відвантаження періоду, на які їх ще немає.
 * Повторний запуск нічого не дублює — база не дає двох накладних на одне
 * відвантаження.
 */
export async function generateTaxInvoices(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole();
  const period = str(formData, 'period');
  if (!/^\d{4}-\d{2}$/.test(period)) return { error: 'Невірний період' };
  if (!session.vat) return { error: 'Юрособа не платник ПДВ — накладні не виписуються' };

  let created = 0;
  try {
    await transaction(async (c) => {
      const { rows: cfg } = await c.query<{ first: number; second: number }>(
        'select pn_deadline_first_half as first, pn_deadline_second_half as second from settings where id = 1',
      );

      const { rows: shipments } = await c.query<{
        shipment_id: string;
        number: string;
        shipped_on: string;
        customer_id: string;
        customer_name: string;
        customer_ipn: string | null;
        customer_is_vat_payer: boolean;
        base_amount: number;
        vat_amount: number;
      }>(
        `select * from v_shipments_without_invoice
          where legal_entity_id = $1
            and shipped_on >= $2::date and shipped_on < ($2::date + interval '1 month')
          order by shipped_on, number`,
        [session.eid, `${period}-01`],
      );

      for (const sh of shipments) {
        const { rows: seq } = await c.query<{ next: number }>(
          `select coalesce(max(number::bigint), 0) + 1 as next
             from tax_invoices
            where legal_entity_id = $1 and extract(year from issued_on) = extract(year from $2::date)
              and number ~ '^[0-9]+$'`,
          [session.eid, sh.shipped_on],
        );

        const deadline = registerDeadline(sh.shipped_on, cfg[0].first, cfg[0].second);
        const ipn = sh.customer_is_vat_payer ? sh.customer_ipn : NON_PAYER_IPN;

        const { rows: invoice } = await c.query<{ id: string }>(
          `insert into tax_invoices
             (legal_entity_id, number, issued_on, shipment_id, customer_id, counterparty_name,
              counterparty_ipn, base_amount, vat_amount, total_amount, register_deadline, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           returning id`,
          [
            session.eid,
            String(seq[0].next),
            sh.shipped_on,
            sh.shipment_id,
            sh.customer_id,
            sh.customer_name,
            ipn,
            round2(sh.base_amount),
            round2(sh.vat_amount),
            round2(Number(sh.base_amount) + Number(sh.vat_amount)),
            deadline,
            session.uid,
          ],
        );

        await c.query(
          `insert into tax_invoice_lines
             (invoice_id, line_no, item_id, description, uktzed, uom_code,
              qty, unit_price, vat_rate, base_amount, vat_amount)
           select $1,
                  row_number() over (order by i.name),
                  i.id,
                  i.name,
                  i.uktzed,
                  i.uom_code,
                  sum(sl.qty),
                  max(l.unit_price),
                  max(l.vat_rate),
                  round(sum(sl.qty * l.unit_price), 2),
                  round(sum(sl.qty * l.unit_price * l.vat_rate / 100), 2)
             from shipment_lines sl
             join sales_order_lines l on l.id = sl.so_line_id
             join items i on i.id = sl.item_id
            where sl.shipment_id = $2
            group by i.id, i.name, i.uktzed, i.uom_code`,
          [invoice[0].id, sh.shipment_id],
        );
        created += 1;
      }
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/vat');
  return { ok: created > 0 ? `Виписано накладних: ${created}` : 'Нових відвантажень без накладної немає' };
}

export async function setInvoiceStatus(formData: FormData) {
  await requireRole();
  const status = str(formData, 'status');
  await transaction((c) =>
    c.query(
      `update tax_invoices
          set status = $2,
              registered_on = case when $2 = 'registered' then coalesce($3::date, current_date) else null end
        where id = $1`,
      [str(formData, 'invoice_id'), status, strOrNull(formData, 'registered_on')],
    ),
  );
  revalidatePath('/vat');
}

/**
 * Готує декларацію за період. Від'ємне значення попереднього періоду
 * підтягується з попередньої декларації, тож ланцюжок видно й можна перевірити.
 */
export async function prepareVatDeclaration(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireRole();
  const period = str(formData, 'period');
  if (!/^\d{4}-\d{2}$/.test(period)) return { error: 'Невірний період' };
  if (!session.vat) return { error: 'Юрособа не платник ПДВ — декларація не подається' };

  try {
    await transaction(async (c) => {
      const from = `${period}-01`;

      const { rows: totals } = await c.query<{
        liability_base: number;
        liability_vat: number;
        credit_base: number;
        credit_vat: number;
      }>(
        `select
           coalesce(sum(base_amount) filter (where kind = 'liability'), 0) as liability_base,
           coalesce(sum(vat_amount)  filter (where kind = 'liability'), 0) as liability_vat,
           coalesce(sum(base_amount) filter (where kind = 'credit'), 0)    as credit_base,
           coalesce(sum(vat_amount)  filter (where kind = 'credit'), 0)    as credit_vat
         from vat_entries
        where legal_entity_id = $1
          and occurred_on >= $2::date and occurred_on < ($2::date + interval '1 month')`,
        [session.eid, from],
      );

      const { rows: prev } = await c.query<{ negative_carry: number }>(
        `select negative_carry from vat_declarations
          where legal_entity_id = $1 and period = ($2::date - interval '1 month')`,
        [session.eid, from],
      );

      const t = totals[0];
      const prevNegative = Number(prev[0]?.negative_carry ?? 0);
      const net = round2(Number(t.liability_vat) - Number(t.credit_vat) - prevNegative);

      await c.query(
        `insert into vat_declarations
           (legal_entity_id, period, liability_base, liability_vat, credit_base, credit_vat,
            prev_negative, payable, negative_carry, prepared_on, created_by)
         values ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, current_date, $10)
         on conflict (legal_entity_id, period) do update
           set liability_base = excluded.liability_base, liability_vat = excluded.liability_vat,
               credit_base = excluded.credit_base, credit_vat = excluded.credit_vat,
               prev_negative = excluded.prev_negative, payable = excluded.payable,
               negative_carry = excluded.negative_carry, prepared_on = current_date`,
        [
          session.eid,
          from,
          t.liability_base,
          t.liability_vat,
          t.credit_base,
          t.credit_vat,
          prevNegative,
          net > 0 ? net : 0,
          net < 0 ? -net : 0,
          session.uid,
        ],
      );
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/vat');
  return { ok: 'Декларацію підготовлено' };
}

export async function submitVatDeclaration(formData: FormData) {
  await requireRole();
  await transaction((c) =>
    c.query(
      `update vat_declarations set status = 'submitted', submitted_on = current_date
        where id = $1 and status = 'draft'`,
      [str(formData, 'declaration_id')],
    ),
  );
  revalidatePath('/vat');
}

export async function updateItemTaxCodes(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole();
  const itemId = str(formData, 'item_id');
  if (!itemId) return { error: 'Не вказано номенклатуру' };

  try {
    await transaction((c) =>
      c.query('update items set uktzed = $2, uom_code = $3 where id = $1', [
        itemId,
        strOrNull(formData, 'uktzed'),
        strOrNull(formData, 'uom_code'),
      ]),
    );
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/vat');
  return { ok: 'Коди збережено' };
}
