/**
 * Правила ПДВ зібрані в одному місці навмисно: від них залежить собівартість,
 * а отже і вся маржа. Розкидані по діях, вони рано чи пізно розійдуться.
 */

export interface PurchaseVatContext {
  /** Чи є платником ПДВ юрособа, яка купує. */
  buyerIsVatPayer: boolean;
  /** Чи є платником ПДВ постачальник. Неплатник ПДВ у ціні не виставляє. */
  supplierIsVatPayer: boolean;
  /** Ставка на товарі, %. */
  itemVatRate: number;
  /** Чи введена ціна вже містить ПДВ. */
  pricesIncludeVat: boolean;
}

export interface PurchaseVatResult {
  /** База оподаткування на одиницю. */
  net: number;
  /** ПДВ на одиницю. */
  vat: number;
  /** Ціна з ПДВ на одиницю — стільки платимо постачальнику. */
  gross: number;
  /**
   * Собівартість одиниці для складу. Тут і живе головна відмінність:
   * платник ПДВ ставить на облік базу, бо податок поверне податковим кредитом,
   * а єдинник — повну ціну, бо для нього ПДВ постачальника є звичайною витратою.
   */
  unitCost: number;
  /** Сума податкового кредиту на одиницю. Для неплатника — нуль. */
  credit: number;
}

export function calcPurchaseVat(enteredPrice: number, ctx: PurchaseVatContext): PurchaseVatResult {
  const rate = ctx.supplierIsVatPayer ? ctx.itemVatRate : 0;

  const net = ctx.pricesIncludeVat ? enteredPrice / (1 + rate / 100) : enteredPrice;
  const gross = ctx.pricesIncludeVat ? enteredPrice : enteredPrice * (1 + rate / 100);
  const vat = gross - net;

  return {
    net: round4(net),
    vat: round4(vat),
    gross: round4(gross),
    unitCost: round4(ctx.buyerIsVatPayer ? net : gross),
    credit: round4(ctx.buyerIsVatPayer ? vat : 0),
  };
}

/**
 * Ставка, з якою продаємо. Неплатник ПДВ не нараховує його взагалі,
 * тож у рядку замовлення опиниться нуль, а не 20.
 */
export function saleVatRate(sellerIsVatPayer: boolean, itemVatRate: number): number {
  return sellerIsVatPayer ? itemVatRate : 0;
}

export const withVat = (net: number, rate: number) => round2(net * (1 + rate / 100));
export const vatOf = (net: number, rate: number) => round2((net * rate) / 100);

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
