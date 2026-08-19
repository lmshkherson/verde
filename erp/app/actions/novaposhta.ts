'use server';

import { revalidatePath } from 'next/cache';
import { transaction } from '@/lib/db';
import { type ActionState, str, strOrNull, toMessage } from '@/lib/action-state';
import { createNpTtn } from '@/lib/novaposhta';
import { requireRole } from '@/lib/session';

/** Ключ і реквізити відправника Нової Пошти — в налаштуваннях компанії. */
export async function saveNpSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole();
  try {
    await transaction((c) =>
      c.query(
        `update settings set
           np_api_key = $1, np_sender_city = $2, np_sender_branch = $3,
           np_sender_phone = $4, np_sender_contact = $5
         where id = 1`,
        [
          strOrNull(formData, 'np_api_key'),
          strOrNull(formData, 'np_sender_city'),
          strOrNull(formData, 'np_sender_branch'),
          strOrNull(formData, 'np_sender_phone'),
          strOrNull(formData, 'np_sender_contact'),
        ],
      ),
    );
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath('/integrations');
  return { ok: 'Налаштування Нової Пошти збережено' };
}

/**
 * Створення ТТН у Новій Пошті прямо з відвантаження: вага — з карток товару,
 * оголошена вартість — сума відвантаження, одержувач — з картки клієнта.
 * Номер накладної повертається в документ, як ніби його вписали руками.
 */
export async function createShipmentTtn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('sales', 'warehouse');
  const shipmentId = str(formData, 'shipment_id');

  let soId = '';
  let ttn = '';
  try {
    await transaction(async (c) => {
      const { rows: settingsRows } = await c.query<{
        np_api_key: string | null;
        np_sender_city: string | null;
        np_sender_branch: string | null;
        np_sender_phone: string | null;
      }>('select np_api_key, np_sender_city, np_sender_branch, np_sender_phone from settings where id = 1');
      const s = settingsRows[0];
      if (!s?.np_api_key) {
        throw new Error(
          'Ключ API Нової Пошти не налаштовано — додайте його на сторінці «Обмін документами» або впишіть номер ТТН вручну',
        );
      }
      if (!s.np_sender_city || !s.np_sender_branch || !s.np_sender_phone) {
        throw new Error('Заповніть місто, відділення й телефон відправника в налаштуваннях Нової Пошти');
      }

      const { rows: shipRows } = await c.query<{
        id: string;
        so_id: string;
        ttn_number: string | null;
        customer_name: string;
        contact: string | null;
        phone: string | null;
        np_city: string | null;
        np_branch: string | null;
      }>(
        `select sh.id, sh.so_id, sh.ttn_number, c.name as customer_name, c.contact, c.phone,
                c.np_city, c.np_branch
           from shipments sh
           join sales_orders o on o.id = sh.so_id
           join customers c on c.id = o.customer_id
          where sh.id = $1 for update of sh`,
        [shipmentId],
      );
      const ship = shipRows[0];
      if (!ship) throw new Error('Відвантаження не знайдено');
      if (ship.ttn_number) throw new Error(`У відвантаження вже є ТТН ${ship.ttn_number}`);
      soId = ship.so_id;

      if (!ship.np_city || !ship.np_branch) {
        throw new Error(
          `У картці клієнта «${ship.customer_name}» не заповнені місто і відділення Нової Пошти`,
        );
      }
      if (!ship.phone) throw new Error(`У картці клієнта «${ship.customer_name}» немає телефону`);

      const { rows: totals } = await c.query<{ weight_kg: number; gross: number; qty: number }>(
        `select coalesce(sum(sl.qty * coalesce(i.weight_g, 0)) / 1000, 0) as weight_kg,
                coalesce(sum(round(sl.qty * l.unit_price * (1 + l.vat_rate / 100), 2)), 0) as gross,
                coalesce(sum(sl.qty), 0) as qty
           from shipment_lines sl
           join items i on i.id = sl.item_id
           join sales_order_lines l on l.id = sl.so_line_id
          where sl.shipment_id = $1`,
        [shipmentId],
      );

      const result = await createNpTtn({
        apiKey: s.np_api_key,
        senderCity: s.np_sender_city,
        senderBranch: s.np_sender_branch,
        senderPhone: s.np_sender_phone,
        recipientCity: ship.np_city,
        recipientBranch: ship.np_branch,
        recipientName: ship.contact ?? ship.customer_name,
        recipientPhone: ship.phone,
        weightKg: Number(totals[0].weight_kg),
        seats: 1,
        cost: Number(totals[0].gross),
        description: `Батончики VERDE, ${Math.round(Number(totals[0].qty))} шт`,
      });
      ttn = result.ttnNumber;

      await c.query("update shipments set ttn_number = $2, carrier = 'Нова пошта' where id = $1", [
        shipmentId,
        ttn,
      ]);
    });
  } catch (err) {
    return { error: toMessage(err) };
  }

  if (soId) revalidatePath(`/sales/${soId}`);
  revalidatePath(`/shipments/${shipmentId}/ttn`);
  return { ok: `ТТН ${ttn} створено в Новій Пошті` };
}
