'use server';

import { revalidatePath } from 'next/cache';
import { queryOne, transaction } from '@/lib/db';
import { type ActionState, num, str, strOrNull, toMessage } from '@/lib/action-state';
import { type EntityRef, requireRole, requireSession, setSessionEntity } from '@/lib/session';

/** Перемикання поточної юрособи — усі нові документи підуть від неї. */
export async function switchEntity(formData: FormData) {
  await requireSession();
  const entity = await queryOne<EntityRef>(
    'select id, short_name, is_vat_payer from legal_entities where id = $1 and is_active',
    [str(formData, 'entity_id')],
  );
  if (!entity) return;

  await setSessionEntity(entity);
  revalidatePath('/', 'layout');
}

export async function createLegalEntity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(); // лише власник
  const name = str(formData, 'name');
  const shortName = str(formData, 'short_name');
  const docPrefix = str(formData, 'doc_prefix').toUpperCase();
  const taxSystem = str(formData, 'tax_system') || 'general';
  const isVatPayer = formData.get('is_vat_payer') === 'on';

  if (!name || !shortName) return { error: 'Вкажіть повну й коротку назву' };
  if (!docPrefix) return { error: 'Вкажіть префікс нумерації документів' };
  if (taxSystem === 'single_tax' && isVatPayer) {
    return { error: 'Єдиний податок і статус платника ПДВ разом — перевірте, що саме у вас' };
  }
  if (isVatPayer && !str(formData, 'ipn')) {
    return { error: 'Для платника ПДВ потрібен ІПН' };
  }

  try {
    await transaction((c) =>
      c.query(
        `insert into legal_entities
           (name, short_name, doc_prefix, edrpou, ipn, tax_system, is_vat_payer, vat_rate,
            bank_account, bank_name, address)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          name,
          shortName,
          docPrefix,
          strOrNull(formData, 'edrpou'),
          strOrNull(formData, 'ipn'),
          taxSystem,
          isVatPayer,
          num(formData, 'vat_rate', 20),
          strOrNull(formData, 'bank_account'),
          strOrNull(formData, 'bank_name'),
          strOrNull(formData, 'address'),
        ],
      ),
    );
  } catch (err) {
    const message = toMessage(err);
    return {
      error: message.includes('legal_entities_short_name_key')
        ? `Коротка назва «${shortName}» вже використовується`
        : message.includes('legal_entities_doc_prefix_key')
          ? `Префікс «${docPrefix}» уже зайнятий іншою юрособою`
          : message,
    };
  }

  revalidatePath('/entities');
  return { ok: 'Юрособу додано' };
}

/**
 * Прив'язує клієнта до власної юрособи. Після цього продаж такому клієнту
 * одночасно оприбутковує товар у покупця — це реалізація між своїми.
 */
export async function linkCustomerToEntity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole();
  const customerId = str(formData, 'customer_id');
  const entityId = strOrNull(formData, 'entity_id');

  try {
    await transaction((c) =>
      c.query('update customers set legal_entity_id = $2 where id = $1', [customerId, entityId]),
    );
  } catch (err) {
    return { error: toMessage(err) };
  }

  revalidatePath('/entities');
  revalidatePath('/sales/customers');
  return { ok: entityId ? 'Клієнта позначено як власну юрособу' : "Зв'язок знято" };
}
