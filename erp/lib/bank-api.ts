/**
 * Адаптери API банків для синхронізації виписки.
 *
 * Обидва повертають рухи в одному внутрішньому форматі — тому самому, в
 * який розбирається CSV: далі конвеєр імпорту їх не розрізняє. ext_id
 * банку гарантує, що повторна синхронізація не створить дублів.
 */

export interface ApiBankRow {
  opDate: string;
  /** Гривні зі знаком: + надходження, − списання. */
  amount: number;
  currency: string;
  counterpartyName: string | null;
  counterpartyEdrpou: string | null;
  counterpartyIban: string | null;
  purpose: string | null;
  docNumber: string | null;
  extId: string;
}

/** monobank: особистий/ФОП токен, https://api.monobank.ua */
async function monobankRows(token: string, iban: string, fromSec: number, toSec: number): Promise<ApiBankRow[]> {
  const info = await fetch('https://api.monobank.ua/personal/client-info', {
    headers: { 'X-Token': token },
    signal: AbortSignal.timeout(20_000),
  });
  if (info.status === 403) throw new Error('monobank відхилив токен — перевірте його в застосунку банку');
  if (!info.ok) throw new Error(`monobank: HTTP ${info.status}`);
  const client = (await info.json()) as { accounts?: { id: string; iban: string; currencyCode: number }[] };

  const account =
    client.accounts?.find((a) => a.iban?.replace(/\s/g, '') === iban.replace(/\s/g, '')) ??
    client.accounts?.[0];
  if (!account) throw new Error('У monobank не знайдено жодного рахунку за цим токеном');

  const res = await fetch(
    `https://api.monobank.ua/personal/statement/${account.id}/${fromSec}/${toSec}`,
    { headers: { 'X-Token': token }, signal: AbortSignal.timeout(30_000) },
  );
  if (res.status === 429) throw new Error('monobank обмежує частоту запитів — спробуйте за хвилину');
  if (!res.ok) throw new Error(`monobank statement: HTTP ${res.status}`);
  const items = (await res.json()) as {
    id: string;
    time: number;
    description: string;
    amount: number;
    counterEdrpou?: string;
    counterIban?: string;
    counterName?: string;
  }[];

  return items.map((t) => ({
    opDate: new Date(t.time * 1000).toISOString().slice(0, 10),
    amount: Math.round(t.amount) / 100,
    currency: 'UAH',
    counterpartyName: t.counterName ?? null,
    counterpartyEdrpou: t.counterEdrpou ?? null,
    counterpartyIban: t.counterIban ?? null,
    purpose: t.description ?? null,
    docNumber: null,
    extId: `mono:${t.id}`,
  }));
}

/** Приват24 для бізнесу: токен у форматі «clientId:token», https://acp.privatbank.ua */
async function privatRows(credentials: string, iban: string, fromSec: number): Promise<ApiBankRow[]> {
  const [clientId, token] = credentials.split(':');
  if (!clientId || !token) {
    throw new Error('Для Приват24 токен вводиться у форматі «id:token» з кабінету АП24');
  }
  const start = new Date(fromSec * 1000);
  const startDate = `${String(start.getDate()).padStart(2, '0')}-${String(start.getMonth() + 1).padStart(2, '0')}-${start.getFullYear()}`;

  const res = await fetch(
    `https://acp.privatbank.ua/api/statements/transactions?acc=${encodeURIComponent(iban)}&startDate=${startDate}&limit=400`,
    {
      headers: { id: clientId, token, 'Content-Type': 'application/json;charset=utf8' },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (res.status === 401 || res.status === 403) {
    throw new Error('Приват24 відхилив доступ — перевірте id і token автоклієнта');
  }
  if (!res.ok) throw new Error(`Приват24: HTTP ${res.status}`);
  const body = (await res.json()) as {
    status: string;
    transactions?: {
      ID: string;
      DAT_OD: string; // DD.MM.YYYY
      SUM_E: string;
      TRANTYPE: 'C' | 'D';
      AUT_CNTR_NAM: string;
      AUT_CNTR_CRF: string;
      AUT_CNTR_ACC: string;
      OSND: string;
      NUM_DOC: string;
    }[];
  };
  if (body.status !== 'SUCCESS' || !body.transactions) {
    throw new Error('Приват24 повернув помилку — перевірте IBAN і права токена');
  }

  return body.transactions.map((t) => {
    const [d, m, y] = t.DAT_OD.split('.');
    const signed = (Number(t.SUM_E) || 0) * (t.TRANTYPE === 'C' ? 1 : -1);
    return {
      opDate: `${y}-${m}-${d}`,
      amount: Math.round(signed * 100) / 100,
      currency: 'UAH',
      counterpartyName: t.AUT_CNTR_NAM || null,
      counterpartyEdrpou: t.AUT_CNTR_CRF || null,
      counterpartyIban: t.AUT_CNTR_ACC || null,
      purpose: t.OSND || null,
      docNumber: t.NUM_DOC || null,
      extId: `pb:${t.ID}`,
    };
  });
}

export async function fetchBankRows(
  provider: string,
  token: string,
  iban: string,
  days = 31,
): Promise<ApiBankRow[]> {
  const toSec = Math.floor(Date.now() / 1000);
  const fromSec = toSec - days * 86_400;
  if (provider === 'monobank') return monobankRows(token, iban, fromSec, toSec);
  if (provider === 'privat24') return privatRows(token, iban, fromSec);
  throw new Error('Невідомий банк — оберіть monobank або Приват24');
}
