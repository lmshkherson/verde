'use server';

import { revalidatePath } from 'next/cache';
import { transaction } from '@/lib/db';
import { type ActionState, str, strOrNull, toMessage } from '@/lib/action-state';
import { buildPayload, outboxFileName, sendDocument, type Settings } from '@/lib/integrations';
import { requireRole } from '@/lib/session';

export async function saveIntegrationSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireRole();
  const provider = str(formData, 'provider') || 'none';

  if (provider === 'file' && !str(formData, 'export_dir')) {
    return { error: 'Для теки обміну потрібен шлях до неї' };
  }
  if (provider === 'vchasno') {
    if (!str(formData, 'api_base_url')) return { error: 'Вкажіть базову адресу API' };
    if (!str(formData, 'api_token_env')) {
      return { error: 'Вкажіть назву змінної середовища з токеном' };
    }
  }

  try {
    await transaction((c) =>
      c.query(
        `insert into integration_settings
           (legal_entity_id, provider, export_dir, api_base_url, api_token_env, auto_enqueue, updated_at)
         values ($1, $2, $3, $4, $5, $6, now())
         on conflict (legal_entity_id) do update
           set provider = excluded.provider, export_dir = excluded.export_dir,
               api_base_url = excluded.api_base_url, api_token_env = excluded.api_token_env,
               auto_enqueue = excluded.auto_enqueue, updated_at = now()`,
        [
          session.eid,
          provider,
          strOrNull(formData, 'export_dir'),
          strOrNull(formData, 'api_base_url'),
          strOrNull(formData, 'api_token_env'),
          formData.get('auto_enqueue') === 'on',
        ],
      ),
    );
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/integrations');
  return { ok: 'Налаштування збережено' };
}

/**
 * Ставить у чергу податкові накладні й розрахунки коригування періоду.
 *
 * Ідемпотентно: унікальний ключ у базі не дасть покласти той самий документ
 * двічі, тож повторний запуск лише додає нові. Це те саме правило, що й у
 * виписці накладних, і з тієї ж причини — випадковий подвійний клік не має
 * коштувати грошей.
 */
export async function enqueueTaxInvoices(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireRole();
  const period = str(formData, 'period');
  if (!period) return { error: 'Не вказано період' };

  let added = 0;
  try {
    added = await transaction(async (c) => {
      const { rows: entity } = await c.query<{
        name: string;
        edrpou: string | null;
        ipn: string | null;
      }>('select name, edrpou, ipn from legal_entities where id = $1', [session.eid]);

      const { rows: invoices } = await c.query<{
        id: string;
        number: string;
        issued_on: string;
        kind: string;
        counterparty_name: string;
        counterparty_ipn: string | null;
        base_amount: number;
        vat_amount: number;
        total_amount: number;
        edrpou: string | null;
      }>(
        `select t.id, t.number, t.issued_on, t.kind, t.counterparty_name, t.counterparty_ipn,
                t.base_amount, t.vat_amount, t.total_amount, c.edrpou
           from tax_invoices t
           left join customers c on c.id = t.customer_id
          where t.legal_entity_id = $1
            and t.issued_on >= $2::date and t.issued_on < ($2::date + interval '1 month')
            and not exists (
              select 1 from outbox_documents o
               where o.legal_entity_id = t.legal_entity_id
                 and o.doc_type = 'tax_invoice' and o.doc_id = t.id)
          order by t.issued_on, t.number`,
        [session.eid, `${period}-01`],
      );

      for (const inv of invoices) {
        const { rows: lines } = await c.query<{
          name: string;
          qty: number;
          price: number;
          uktzed: string | null;
          uom: string | null;
        }>(
          `select l.description as name, l.qty, l.unit_price as price, l.uktzed, l.uom_code as uom
             from tax_invoice_lines l where l.invoice_id = $1 order by l.line_no`,
          [inv.id],
        );

        const payload = buildPayload({
          docType: inv.kind === 'adjustment' ? 'РК' : 'ПН',
          number: inv.number,
          date: inv.issued_on,
          sellerName: entity[0]?.name ?? '',
          sellerEdrpou: entity[0]?.edrpou ?? null,
          sellerIpn: entity[0]?.ipn ?? null,
          counterparty: inv.counterparty_name,
          counterpartyId: inv.edrpou,
          counterpartyIpn: inv.counterparty_ipn,
          baseAmount: Number(inv.base_amount),
          vatAmount: Number(inv.vat_amount),
          totalAmount: Number(inv.total_amount),
          lines: lines.map((l) => ({
            name: l.name,
            qty: Number(l.qty),
            price: Number(l.price),
            uktzed: l.uktzed,
            uom: l.uom,
          })),
        });

        await c.query(
          `insert into outbox_documents
             (legal_entity_id, doc_type, doc_id, doc_number, doc_date,
              counterparty, counterparty_id, file_name, payload, created_by)
           values ($1, 'tax_invoice', $2, $3, $4, $5, $6, $7, $8, $9)
           on conflict (legal_entity_id, doc_type, doc_id) do nothing`,
          [
            session.eid,
            inv.id,
            inv.number,
            inv.issued_on,
            inv.counterparty_name,
            inv.edrpou ?? inv.counterparty_ipn,
            outboxFileName({
              counterpartyId: inv.edrpou ?? inv.counterparty_ipn,
              docDate: inv.issued_on,
              docType: 'tax_invoice',
              docNumber: inv.number,
            }),
            payload,
            session.uid,
          ],
        );
      }
      return invoices.length;
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/integrations');
  revalidatePath('/vat');
  return { ok: added > 0 ? `У чергу додано документів: ${added}` : 'Нових документів немає' };
}

/**
 * Відправляє все, що чекає в черзі. Кожен документ обробляється окремою
 * транзакцією: збій на третьому не має відкочувати два вдалі.
 */
export async function sendOutbox(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireRole();

  const settings = await transaction(async (c) => {
    const { rows } = await c.query<Settings>(
      `select provider, export_dir, api_base_url, api_token_env
         from integration_settings where legal_entity_id = $1`,
      [session.eid],
    );
    return rows[0] ?? null;
  });

  if (!settings || settings.provider === 'none') {
    return { error: 'Канал обміну не налаштований' };
  }

  const pending = await transaction(async (c) => {
    const { rows } = await c.query(
      `select id, doc_type, doc_number, doc_date, counterparty, counterparty_id, file_name, payload
         from outbox_documents
        where legal_entity_id = $1 and status in ('queued','failed')
        order by queued_at limit 200`,
      [session.eid],
    );
    return rows;
  });

  if (pending.length === 0) return { ok: 'Черга порожня' };

  let ok = 0;
  let bad = 0;
  for (const item of pending) {
    const result = await sendDocument(item, settings);
    if (result.status === 'sent') ok += 1;
    else bad += 1;

    await transaction((c) =>
      c.query(
        `update outbox_documents set
           status = $2, attempts = attempts + 1, external_id = $3, error = $4,
           sent_at = case when $2 = 'sent' then now() else sent_at end
         where id = $1`,
        [item.id, result.status, result.externalId ?? null, result.error ?? null],
      ),
    );
  }

  revalidatePath('/integrations');
  return bad === 0
    ? { ok: `Надіслано документів: ${ok}` }
    : { error: `Надіслано ${ok}, не вдалося ${bad}. Причини — у списку нижче.` };
}

/** Ручна відмітка статусу: квитанції поки читає людина, а не система. */
export async function setOutboxStatus(formData: FormData) {
  await requireRole();
  const id = str(formData, 'outbox_id');
  const status = str(formData, 'status');
  await transaction((c) =>
    c.query(
      `update outbox_documents set status = $2, settled_at = now(),
              error = case when $2 = 'delivered' then null else error end
        where id = $1`,
      [id, status],
    ),
  );
  revalidatePath('/integrations');
}

export async function requeueOutbox(formData: FormData) {
  await requireRole();
  await transaction((c) =>
    c.query("update outbox_documents set status = 'queued', error = null where id = $1", [
      str(formData, 'outbox_id'),
    ]),
  );
  revalidatePath('/integrations');
}

/** Токен приймання замовлень із сайту і юрособа, на яку вони створюються. */
export async function saveShopSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole();
  try {
    await transaction((c) =>
      c.query('update settings set shop_api_token = $1, shop_entity_id = $2 where id = 1', [
        strOrNull(formData, 'shop_api_token'),
        strOrNull(formData, 'shop_entity_id'),
      ]),
    );
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath('/integrations');
  return { ok: 'Налаштування магазину збережено' };
}
