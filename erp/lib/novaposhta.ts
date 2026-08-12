/**
 * Адаптер API Нової Пошти (api.novaposhta.ua, версія 2.0).
 *
 * Створення ТТН — ланцюжок довідникових запитів: місто → відділення →
 * контрагент-одержувач → сама накладна. Кожен крок повертає зрозумілу
 * помилку, якщо НП відмовила: користувач бачить її текст, а не «щось пішло
 * не так». Без ключа адаптер не викликається взагалі — номер ТТН, як і
 * раніше, можна вписати руками.
 */

const NP_URL = 'https://api.novaposhta.ua/v2.0/json/';

interface NpResponse<T> {
  success: boolean;
  data: T[];
  errors: string[];
  warnings: string[];
}

async function npCall<T>(
  apiKey: string,
  modelName: string,
  calledMethod: string,
  methodProperties: Record<string, unknown>,
): Promise<T[]> {
  const res = await fetch(NP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey, modelName, calledMethod, methodProperties }),
    // ТТН створюється в інтерактивній дії — довго чекати не можна.
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Нова Пошта відповіла HTTP ${res.status}`);
  const body = (await res.json()) as NpResponse<T>;
  if (!body.success) {
    throw new Error(`Нова Пошта: ${body.errors?.join('; ') || 'запит відхилено без пояснення'}`);
  }
  return body.data;
}

async function cityRef(apiKey: string, cityName: string): Promise<string> {
  const cities = await npCall<{ Ref: string; Description: string }>(apiKey, 'Address', 'getCities', {
    FindByString: cityName,
  });
  if (cities.length === 0) throw new Error(`Місто «${cityName}» не знайдено в довіднику Нової Пошти`);
  return cities[0].Ref;
}

async function warehouseRef(apiKey: string, cityRefValue: string, branch: string): Promise<string> {
  // Номер відділення шукаємо і як число, і як підрядок назви («Відділення №5»).
  const warehouses = await npCall<{ Ref: string; Description: string; Number: string }>(
    apiKey,
    'Address',
    'getWarehouses',
    { CityRef: cityRefValue, FindByString: branch },
  );
  const exact = warehouses.find((w) => w.Number === branch.replace(/\D/g, ''));
  const found = exact ?? warehouses[0];
  if (!found) throw new Error(`Відділення «${branch}» не знайдено в цьому місті`);
  return found.Ref;
}

/** Відправник має бути заведений в акаунті НП — беремо першого. */
async function senderRefs(apiKey: string) {
  const counterparties = await npCall<{ Ref: string }>(apiKey, 'Counterparty', 'getCounterparties', {
    CounterpartyProperty: 'Sender',
    Page: '1',
  });
  if (counterparties.length === 0) {
    throw new Error('В акаунті Нової Пошти немає контрагента-відправника — заведіть його в кабінеті НП');
  }
  const senderRef = counterparties[0].Ref;
  const contacts = await npCall<{ Ref: string }>(
    apiKey,
    'Counterparty',
    'getCounterpartyContactPersons',
    { Ref: senderRef, Page: '1' },
  );
  if (contacts.length === 0) {
    throw new Error('У відправника в НП немає контактної особи — додайте її в кабінеті НП');
  }
  return { senderRef, contactSenderRef: contacts[0].Ref };
}

async function recipientRefs(apiKey: string, fullName: string, phone: string) {
  const parts = fullName.trim().split(/\s+/);
  const data = await npCall<{ Ref: string; ContactPerson: { data: { Ref: string }[] } }>(
    apiKey,
    'Counterparty',
    'save',
    {
      CounterpartyType: 'PrivatePerson',
      CounterpartyProperty: 'Recipient',
      FirstName: parts[1] ?? parts[0],
      LastName: parts[0],
      MiddleName: parts[2] ?? '',
      Phone: phone,
    },
  );
  const ref = data[0]?.Ref;
  const contactRef = data[0]?.ContactPerson?.data?.[0]?.Ref;
  if (!ref || !contactRef) throw new Error('Нова Пошта не повернула одержувача');
  return { recipientRef: ref, contactRecipientRef: contactRef };
}

export interface NpTtnInput {
  apiKey: string;
  senderCity: string;
  senderBranch: string;
  senderPhone: string;
  recipientCity: string;
  recipientBranch: string;
  recipientName: string;
  recipientPhone: string;
  /** кг, > 0 — НП відхиляє нульову вагу. */
  weightKg: number;
  seats: number;
  /** Оголошена вартість, грн. */
  cost: number;
  description: string;
}

export interface NpTtnResult {
  ttnNumber: string;
  ref: string;
  estimatedDeliveryDate: string | null;
  costOnSite: number | null;
}

export async function createNpTtn(input: NpTtnInput): Promise<NpTtnResult> {
  const [citySender, cityRecipient, { senderRef, contactSenderRef }] = await Promise.all([
    cityRef(input.apiKey, input.senderCity),
    cityRef(input.apiKey, input.recipientCity),
    senderRefs(input.apiKey),
  ]);
  const [senderAddress, recipientAddress, { recipientRef, contactRecipientRef }] = await Promise.all([
    warehouseRef(input.apiKey, citySender, input.senderBranch),
    warehouseRef(input.apiKey, cityRecipient, input.recipientBranch),
    recipientRefs(input.apiKey, input.recipientName, input.recipientPhone),
  ]);

  const docs = await npCall<{
    Ref: string;
    IntDocNumber: string;
    EstimatedDeliveryDate: string;
    CostOnSite: number;
  }>(input.apiKey, 'InternetDocument', 'save', {
    PayerType: 'Sender',
    PaymentMethod: 'Cash',
    CargoType: 'Cargo',
    ServiceType: 'WarehouseWarehouse',
    Weight: String(Math.max(input.weightKg, 0.1)),
    SeatsAmount: String(Math.max(input.seats, 1)),
    Cost: String(Math.max(Math.round(input.cost), 1)),
    Description: input.description,
    DateTime: new Intl.DateTimeFormat('uk-UA').format(new Date()),
    CitySender: citySender,
    Sender: senderRef,
    SenderAddress: senderAddress,
    ContactSender: contactSenderRef,
    SendersPhone: input.senderPhone,
    CityRecipient: cityRecipient,
    Recipient: recipientRef,
    RecipientAddress: recipientAddress,
    ContactRecipient: contactRecipientRef,
    RecipientsPhone: input.recipientPhone,
  });

  const doc = docs[0];
  if (!doc?.IntDocNumber) throw new Error('Нова Пошта не повернула номер накладної');
  return {
    ttnNumber: doc.IntDocNumber,
    ref: doc.Ref,
    estimatedDeliveryDate: doc.EstimatedDeliveryDate ?? null,
    costOnSite: doc.CostOnSite != null ? Number(doc.CostOnSite) : null,
  };
}
