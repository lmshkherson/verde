import type { PoolClient } from 'pg';

/**
 * Генерація проводок із документів.
 *
 * Проводки тут — похідна від первинки, а не окремий ручний ввід. Через це вони
 * не можуть розійтися з документами, а зміна правила означає просто
 * перегенерацію періоду, а не пошук і виправлення записів руками.
 *
 * Ознака книги на проводці каже, до якого обліку вона належить:
 *   both        — однакова в обох
 *   accounting  — тільки бухгалтерська
 *   management  — тільки управлінська
 */

export type Book = 'both' | 'accounting' | 'management';

interface Entry {
  debit: string;
  credit: string;
  amount: number;
  book?: Book;
  note?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Рахунок запасів за видом номенклатури. */
function inventoryAccount(kind: string): string {
  if (kind === 'packaging') return '204';
  if (kind === 'finished') return '26';
  return '201';
}

/** Рахунок коштів за способом оплати. */
const cashAccount = (method: string) => (method === 'cash' ? '301' : '311');

/** Рахунок витрат за категорією. Цех виділено окремо — він розходиться між книгами. */
function expenseAccount(category: string): string {
  if (category === 'logistics' || category === 'marketing') return '93';
  if (category === 'spoilage') return '947';
  if (category === 'fx') return '945';
  return '92';
}

const PRODUCTION_CATEGORIES = ['production_salary', 'production_energy'];

/**
 * Рахунок витрат за підрозділом. Для цеху він різний у двох книгах: бухгалтерія
 * веде його через виробництво, управлінський облік — одразу у витрати періоду.
 */
function departmentAccount(department: string, book: 'accounting' | 'management'): string {
  if (department === 'production') return book === 'accounting' ? '23' : '91';
  return department === 'sales' ? '93' : '92';
}

async function addBatch(
  client: PoolClient,
  entityId: string,
  docType: string,
  docId: string | null,
  postedOn: string,
  description: string,
  entries: Entry[],
): Promise<number> {
  const rows = entries.filter((e) => round2(e.amount) > 0);
  if (rows.length === 0) return 0;

  const { rows: batch } = await client.query<{ id: string }>(
    `insert into posting_batches (legal_entity_id, doc_type, doc_id, posted_on, description)
     values ($1, $2, $3, $4, $5) returning id`,
    [entityId, docType, docId, postedOn, description],
  );

  for (const e of rows) {
    await client.query(
      `insert into postings
         (batch_id, legal_entity_id, book, debit_code, credit_code, amount, posted_on, note)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [batch[0].id, entityId, e.book ?? 'both', e.debit, e.credit, round2(e.amount), postedOn, e.note ?? null],
    );
  }
  return rows.length;
}

/**
 * Перегенеровує всі проводки юрособи за місяць. Ідемпотентна: спершу зносить
 * раніше згенеровані пакети періоду, потім будує заново з документів.
 */
export async function regeneratePostings(
  client: PoolClient,
  entityId: string,
  period: string,
  userId: string | null,
): Promise<number> {
  await client.query(
    `delete from posting_batches
      where legal_entity_id = $1
        and posted_on >= $2::date and posted_on < ($2::date + interval '1 month')`,
    [entityId, period],
  );

  let count = 0;
  // Витрати цеху збираються з кількох джерел. Змінні й постійні розносяться
  // по-різному, тож накопичуємо їх окремо.
  let shopVariable = 0;
  let shopFixed = 0;
  const range = [entityId, period];

  // ─── Прихід запасів від постачальника ────────────────────────────────────
  const { rows: receipts } = await client.query<{
    doc_id: string;
    day: string;
    kind: string;
    amount: number;
    number: string | null;
  }>(
    // Прихід заходить двома дверима — приймання за заявкою й самостійне
    // надходження — але це одна господарська операція з однією проводкою.
    `select m.doc_id, m.moved_at::date as day, i.kind, sum(m.qty * m.unit_cost) as amount,
            coalesce(max(p.number), max(r.number)) as number
       from stock_moves m
       join items i on i.id = m.item_id
       left join purchase_orders p on p.id = m.doc_id and m.doc_type = 'purchase_order'
       left join receipts r on r.id = m.doc_id and m.doc_type = 'receipt'
      where m.legal_entity_id = $1 and m.move_type = 'purchase_receipt'
        and m.doc_type in ('purchase_order', 'receipt')
        and m.moved_at >= $2::date and m.moved_at < ($2::date + interval '1 month')
      group by m.doc_id, m.moved_at::date, i.kind`,
    range,
  );
  for (const r of receipts) {
    count += await addBatch(client, entityId, 'purchase_receipt', r.doc_id, r.day, `Прихід ${r.number ?? ''}`.trim(), [
      { debit: inventoryAccount(r.kind), credit: '631', amount: r.amount, note: 'Оприбуткування без ПДВ' },
    ]);
  }

  // Придбання готової продукції у власної юрособи — інша сторона внутрішньої реалізації.
  const { rows: internalBuys } = await client.query<{ doc_id: string; day: string; amount: number }>(
    `select m.doc_id, m.moved_at::date as day, sum(m.qty * m.unit_cost) as amount
       from stock_moves m
      where m.legal_entity_id = $1 and m.move_type = 'purchase_receipt' and m.doc_type = 'shipment'
        and m.moved_at >= $2::date and m.moved_at < ($2::date + interval '1 month')
      group by m.doc_id, m.moved_at::date`,
    range,
  );
  for (const r of internalBuys) {
    count += await addBatch(client, entityId, 'internal_purchase', r.doc_id, r.day, 'Придбання у власної юрособи', [
      { debit: '26', credit: '631', amount: r.amount },
    ]);
  }

  // ─── Податковий кредит із ПДВ ────────────────────────────────────────────
  const { rows: credits } = await client.query<{
    id: string;
    doc_type: string;
    occurred_on: string;
    vat_amount: number;
    doc_number: string | null;
  }>(
    `select id, doc_type, occurred_on, vat_amount, doc_number
       from vat_entries
      where legal_entity_id = $1 and kind = 'credit'
        and occurred_on >= $2::date and occurred_on < ($2::date + interval '1 month')`,
    range,
  );
  for (const v of credits) {
    count += await addBatch(client, entityId, 'vat_credit', v.id, v.occurred_on, `Податковий кредит ${v.doc_number ?? ''}`.trim(), [
      { debit: '6441', credit: '631', amount: v.vat_amount },
    ]);
  }

  // ─── Повернення постачальникам ───────────────────────────────────────────
  // Дзеркало приходу: запаси йдуть зі складу, борг меншає, кредит знімається.
  const { rows: supplierReturns } = await client.query<{
    id: string;
    number: string;
    returned_on: string;
    kind: string;
    net: number;
    vat: number;
  }>(
    `select a.return_id as id, r.number, a.returned_on, i.kind,
            sum(l.qty * l.unit_cost) as net,
            sum(l.qty * l.unit_vat)  as vat
       from v_supplier_return_amounts a
       join supplier_returns r on r.id = a.return_id
       join supplier_return_lines l on l.return_id = a.return_id
       join items i on i.id = l.item_id
      where a.legal_entity_id = $1
        and a.returned_on >= $2::date and a.returned_on < ($2::date + interval '1 month')
      group by a.return_id, r.number, a.returned_on, i.kind`,
    range,
  );
  for (const r of supplierReturns) {
    count += await addBatch(
      client,
      entityId,
      'supplier_return',
      r.id,
      r.returned_on,
      `Повернення постачальнику ${r.number}`,
      [
        { debit: '631', credit: inventoryAccount(r.kind), amount: r.net, note: 'Запаси повернуто' },
        { debit: '631', credit: '6441', amount: r.vat, note: 'Сторно податкового кредиту' },
      ],
    );
  }

  // ─── Оплати постачальникам ───────────────────────────────────────────────
  const { rows: supplierPayments } = await client.query<{ id: string; paid_on: string; amount: number; method: string }>(
    `select id, paid_on, amount, method from supplier_payments
      where legal_entity_id = $1
        and paid_on >= $2::date and paid_on < ($2::date + interval '1 month')`,
    range,
  );
  for (const p of supplierPayments) {
    count += await addBatch(client, entityId, 'supplier_payment', p.id, p.paid_on, 'Оплата постачальнику', [
      { debit: '631', credit: cashAccount(p.method), amount: p.amount },
    ]);
  }

  // ─── Списання сировини у виробництво ─────────────────────────────────────
  const { rows: consumed } = await client.query<{ doc_id: string; day: string; kind: string; amount: number }>(
    `select m.doc_id, m.moved_at::date as day, i.kind, sum(-m.qty * m.unit_cost) as amount
       from stock_moves m join items i on i.id = m.item_id
      where m.legal_entity_id = $1 and m.move_type = 'production_consume'
        and m.moved_at >= $2::date and m.moved_at < ($2::date + interval '1 month')
      group by m.doc_id, m.moved_at::date, i.kind`,
    range,
  );
  for (const c of consumed) {
    count += await addBatch(client, entityId, 'production_consume', c.doc_id, c.day, 'Списано у виробництво', [
      { debit: '23', credit: inventoryAccount(c.kind), amount: c.amount },
    ]);
  }

  // ─── Випуск готової продукції ────────────────────────────────────────────
  const { rows: output } = await client.query<{ doc_id: string; day: string; amount: number }>(
    `select m.doc_id, m.moved_at::date as day, sum(m.qty * m.unit_cost) as amount
       from stock_moves m
      where m.legal_entity_id = $1 and m.move_type = 'production_output'
        and m.moved_at >= $2::date and m.moved_at < ($2::date + interval '1 month')
      group by m.doc_id, m.moved_at::date`,
    range,
  );
  for (const o of output) {
    count += await addBatch(client, entityId, 'production_output', o.doc_id, o.day, 'Випуск продукції', [
      { debit: '26', credit: '23', amount: o.amount, note: 'За вартістю сировини' },
    ]);
  }

  // ─── Відвантаження: дохід, ПДВ, собівартість ─────────────────────────────
  const { rows: shipments } = await client.query<{
    id: string;
    number: string;
    shipped_on: string;
    gross: number;
    vat: number;
    cogs: number;
  }>(
    `select sh.id, sh.number, sh.shipped_on,
            coalesce(sum(sl.qty * l.unit_price * (1 + l.vat_rate / 100)), 0) as gross,
            coalesce(sum(sl.qty * l.unit_price * l.vat_rate / 100), 0)       as vat,
            coalesce((select sum(-m.qty * m.unit_cost) from stock_moves m
                       where m.doc_type = 'shipment' and m.doc_id = sh.id
                         and m.move_type = 'sale_shipment'), 0)              as cogs
       from shipments sh
       join sales_orders o on o.id = sh.so_id
       join shipment_lines sl on sl.shipment_id = sh.id
       join sales_order_lines l on l.id = sl.so_line_id
      where o.legal_entity_id = $1
        and sh.shipped_on >= $2::date and sh.shipped_on < ($2::date + interval '1 month')
      group by sh.id, sh.number, sh.shipped_on`,
    range,
  );
  for (const s of shipments) {
    count += await addBatch(client, entityId, 'shipment', s.id, s.shipped_on, `Відвантаження ${s.number}`, [
      { debit: '361', credit: '701', amount: s.gross, note: 'Дохід із ПДВ' },
      { debit: '701', credit: '6411', amount: s.vat, note: 'Податкове зобов’язання' },
      { debit: '901', credit: '26', amount: s.cogs, note: 'Собівартість реалізації' },
    ]);
  }

  // ─── Інвентаризація: надлишки й нестачі ──────────────────────────────────
  // Коригування залишку — це не технічна правка, а господарська подія:
  // нестача є втратою, надлишок — доходом. Раніше рухи типу adjustment у
  // проводки не потрапляли взагалі, і оборотка про них не знала.
  const { rows: adjustments } = await client.query<{
    doc_id: string | null;
    day: string;
    kind: string;
    surplus: number;
    shortage: number;
    number: string | null;
  }>(
    `select m.doc_id, m.moved_at::date as day, i.kind,
            coalesce(sum(m.qty * m.unit_cost) filter (where m.qty > 0), 0)  as surplus,
            coalesce(sum(-m.qty * m.unit_cost) filter (where m.qty < 0), 0) as shortage,
            max(st.number) as number
       from stock_moves m
       join items i on i.id = m.item_id
       left join stocktakes st on st.id = m.doc_id and m.doc_type = 'stocktake'
      where m.legal_entity_id = $1 and m.move_type = 'adjustment'
        and m.moved_at >= $2::date and m.moved_at < ($2::date + interval '1 month')
      group by m.doc_id, m.moved_at::date, i.kind`,
    range,
  );
  for (const a of adjustments) {
    count += await addBatch(
      client,
      entityId,
      'stocktake',
      a.doc_id,
      a.day,
      `Інвентаризація ${a.number ?? ''}`.trim(),
      [
        { debit: inventoryAccount(a.kind), credit: '719', amount: a.surplus, note: 'Надлишок' },
        { debit: '947', credit: inventoryAccount(a.kind), amount: a.shortage, note: 'Нестача' },
      ],
    );
  }

  // ─── Повернення від клієнтів ─────────────────────────────────────────────
  // Повернення не витрата, а вирахування з доходу: інакше виручка лишалася б
  // завищеною, а маржа — неправдивою. Собівартість повертається з 901 — або
  // на склад, або у втрати, якщо товар непридатний.
  const { rows: returns } = await client.query<{
    id: string;
    number: string;
    returned_on: string;
    gross: number;
    vat: number;
    cost_returned: number;
    cost_lost: number;
  }>(
    `select r.number, a.return_id as id, a.returned_on,
            a.gross_amount as gross, a.vat_amount as vat,
            a.cost_returned, a.cost_lost
       from v_return_amounts a
       join customer_returns r on r.id = a.return_id
      where a.legal_entity_id = $1
        and a.returned_on >= $2::date and a.returned_on < ($2::date + interval '1 month')`,
    range,
  );
  for (const r of returns) {
    count += await addBatch(client, entityId, 'customer_return', r.id, r.returned_on, `Повернення ${r.number}`, [
      { debit: '704', credit: '361', amount: r.gross, note: 'Вирахування з доходу з ПДВ' },
      { debit: '6411', credit: '704', amount: r.vat, note: 'Сторно податкового зобов’язання' },
      { debit: '26', credit: '901', amount: r.cost_returned, note: 'Товар повернуто на склад' },
      { debit: '947', credit: '901', amount: r.cost_lost, note: 'Повернуто непридатним' },
    ]);
  }

  // ─── Банк: операції без документа-посередника ────────────────────────────
  // Комісія банку чи сплата податку не мають ні накладної, ні акта: первинним
  // документом для них є сама виписка. Тому проводка будується з рядка
  // виписки напряму, а рахунок вибирає той, хто розносив.
  const { rows: bankOther } = await client.query<{
    id: string;
    op_date: string;
    amount: number;
    other_account: string;
    note: string | null;
  }>(
    `select id, op_date, amount, other_account, note from bank_transactions
      where legal_entity_id = $1 and status = 'matched' and match_kind = 'other'
        and other_account is not null
        and op_date >= $2::date and op_date < ($2::date + interval '1 month')`,
    range,
  );
  for (const t of bankOther) {
    const outflow = Number(t.amount) < 0;
    count += await addBatch(
      client,
      entityId,
      'bank_transaction',
      t.id,
      t.op_date,
      t.note ?? 'Операція за випискою',
      [
        outflow
          ? { debit: t.other_account, credit: '311', amount: -Number(t.amount) }
          : { debit: '311', credit: t.other_account, amount: Number(t.amount) },
      ],
    );
  }

  // ─── Оплати від покупців ─────────────────────────────────────────────────
  const { rows: customerPayments } = await client.query<{ id: string; paid_on: string; amount: number; method: string }>(
    `select id, paid_on, amount, method from payments
      where legal_entity_id = $1
        and paid_on >= $2::date and paid_on < ($2::date + interval '1 month')`,
    range,
  );
  for (const p of customerPayments) {
    count += await addBatch(client, entityId, 'customer_payment', p.id, p.paid_on, 'Оплата від покупця', [
      { debit: cashAccount(p.method), credit: '361', amount: p.amount },
    ]);
  }

  // ─── Витрати. Тут і проходить головна межа між обліками ──────────────────
  const { rows: expenses } = await client.query<{
    id: string;
    spent_on: string;
    category: string;
    amount_net: number;
    cost_behavior: string;
    description: string | null;
    cash_order_id: string | null;
  }>(
    `select id, spent_on, category, amount_net, cost_behavior, description, cash_order_id from expenses
      where legal_entity_id = $1
        and write_off_id is null
        and spent_on >= $2::date and spent_on < ($2::date + interval '1 month')`,
    range,
  );
  for (const e of expenses) {
    // Витрата з касового ордера оплачена готівкою одразу — кредиторки немає.
    const credit = e.cash_order_id ? '301' : '631';
    if (PRODUCTION_CATEGORIES.includes(e.category)) {
      if (e.cost_behavior === 'fixed') shopFixed += Number(e.amount_net);
      else shopVariable += Number(e.amount_net);
      // Бухгалтерія відносить цех на виробництво, управлінський облік — одразу
      // у витрати періоду. Це і є та сама подія з різними проводками.
      count += await addBatch(client, entityId, 'expense', e.id, e.spent_on, e.description ?? 'Витрати цеху', [
        { debit: '23', credit, amount: e.amount_net, book: 'accounting', note: 'Цех у виробничу собівартість' },
        { debit: '91', credit, amount: e.amount_net, book: 'management', note: 'Цех у витрати періоду' },
      ]);
    } else {
      count += await addBatch(client, entityId, 'expense', e.id, e.spent_on, e.description ?? 'Операційні витрати', [
        { debit: expenseAccount(e.category), credit, amount: e.amount_net },
      ]);
    }
  }

  // ─── Каса: «інші» ордери без контрагента ─────────────────────────────────
  // Оплати покупців/постачальникам готівкою вже запостились через payments і
  // supplier_payments; тут лише внесення й видачі без документа-пари.
  const { rows: cashOther } = await client.query<{
    id: string;
    number: string;
    direction: string;
    occurred_on: string;
    amount: number;
  }>(
    `select id, number, direction, occurred_on, amount from cash_orders
      where legal_entity_id = $1 and kind = 'other'
        and occurred_on >= $2::date and occurred_on < ($2::date + interval '1 month')`,
    range,
  );
  for (const o of cashOther) {
    count += await addBatch(client, entityId, 'cash_order', o.id, o.occurred_on, `Касовий ордер ${o.number}`, [
      o.direction === 'in'
        ? { debit: '301', credit: '685', amount: o.amount }
        : { debit: '685', credit: '301', amount: o.amount },
    ]);
  }

  // ─── Втрати від псування (разові операції без акта) ──────────────────────
  const { rows: writeOffs } = await client.query<{ day: string; kind: string; amount: number }>(
    `select m.moved_at::date as day, i.kind, sum(-m.qty * m.unit_cost) as amount
       from stock_moves m join items i on i.id = m.item_id
      where m.legal_entity_id = $1 and m.move_type = 'write_off'
        and coalesce(m.doc_type, '') <> 'write_off_act'
        and m.moved_at >= $2::date and m.moved_at < ($2::date + interval '1 month')
      group by m.moved_at::date, i.kind`,
    range,
  );
  for (const w of writeOffs) {
    count += await addBatch(client, entityId, 'write_off', null, w.day, 'Списання', [
      { debit: '947', credit: inventoryAccount(w.kind), amount: w.amount },
    ]);
  }

  // ─── Акти списання: собівартість лягає за статтею акта ───────────────────
  const { rows: writeOffActs } = await client.query<{
    id: string;
    number: string;
    category: string;
    day: string;
    kind: string;
    amount: number;
  }>(
    `select w.id, w.number, w.category, m.moved_at::date as day, i.kind,
            sum(-m.qty * m.unit_cost) as amount
       from stock_moves m
       join items i on i.id = m.item_id
       join write_offs w on w.id = m.doc_id
      where m.legal_entity_id = $1 and m.doc_type = 'write_off_act'
        and m.moved_at >= $2::date and m.moved_at < ($2::date + interval '1 month')
      group by w.id, w.number, w.category, m.moved_at::date, i.kind`,
    range,
  );
  for (const w of writeOffActs) {
    count += await addBatch(client, entityId, 'write_off_act', w.id, w.day, `Акт списання ${w.number}`, [
      { debit: expenseAccount(w.category), credit: inventoryAccount(w.kind), amount: w.amount },
    ]);
  }

  // ─── Зарплата: нарахування, утримання, ЄСВ, виплата ──────────────────────
  const { rows: payroll } = await client.query<{
    run_id: string;
    status: string;
    paid_on: string | null;
    period: string;
    department: string;
    cost_behavior: string;
    gross: number;
    pdfo: number;
    military: number;
    esv: number;
    net: number;
  }>(
    `select r.id as run_id, r.status, r.paid_on, r.period, l.department, e.cost_behavior,
            sum(l.gross) as gross, sum(l.pdfo) as pdfo, sum(l.military) as military,
            sum(l.esv) as esv, sum(l.net) as net
       from payroll_runs r
       join payroll_lines l on l.run_id = r.id
       join employees e on e.id = l.employee_id
      where r.legal_entity_id = $1 and r.status <> 'draft' and r.period = $2::date
      group by r.id, r.status, r.paid_on, r.period, l.department, e.cost_behavior`,
    range,
  );

  const monthEnd = new Date(new Date(period).getFullYear(), new Date(period).getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);

  for (const p of payroll) {
    const entries: Entry[] = [];
    if (p.department === 'production') {
      entries.push(
        { debit: '23', credit: '661', amount: p.gross, book: 'accounting', note: 'Зарплата цеху у виробництво' },
        { debit: '91', credit: '661', amount: p.gross, book: 'management', note: 'Зарплата цеху у витрати періоду' },
        { debit: '23', credit: '651', amount: p.esv, book: 'accounting', note: 'ЄСВ цеху' },
        { debit: '91', credit: '651', amount: p.esv, book: 'management', note: 'ЄСВ цеху' },
      );
      const payrollCost = Number(p.gross) + Number(p.esv);
      if (p.cost_behavior === 'fixed') shopFixed += payrollCost;
      else shopVariable += payrollCost;
    } else {
      const account = departmentAccount(p.department, 'accounting');
      entries.push(
        { debit: account, credit: '661', amount: p.gross, note: 'Нарахування зарплати' },
        { debit: account, credit: '651', amount: p.esv, note: 'ЄСВ роботодавця' },
      );
    }

    entries.push(
      { debit: '661', credit: '6412', amount: p.pdfo, note: 'ПДФО' },
      { debit: '661', credit: '6414', amount: p.military, note: 'Військовий збір' },
    );
    if (p.status === 'paid') {
      entries.push({ debit: '661', credit: '311', amount: p.net, note: 'Виплата на картки' });
    }

    count += await addBatch(client, entityId, 'payroll', p.run_id, monthEnd, 'Зарплата за місяць', entries);
  }

  // ─── Придбання основних засобів ──────────────────────────────────────────
  const { rows: acquisitions } = await client.query<{ id: string; acquired_on: string; cost: number; name: string }>(
    `select id, acquired_on, cost, name from fixed_assets
      where legal_entity_id = $1
        and acquired_on >= $2::date and acquired_on < ($2::date + interval '1 month')`,
    range,
  );
  for (const a of acquisitions) {
    count += await addBatch(client, entityId, 'asset_acquisition', a.id, a.acquired_on, `Придбано ${a.name}`, [
      { debit: '104', credit: '631', amount: a.cost },
    ]);
  }

  // ─── Амортизація. Різні строки дають різні суми у двох книгах ────────────
  const { rows: depreciation } = await client.query<{
    run_id: string;
    department: string;
    cost_behavior: string;
    accounting: number;
    management: number;
  }>(
    `select r.id as run_id, l.department, a.cost_behavior,
            sum(l.amount_accounting) as accounting, sum(l.amount_management) as management
       from depreciation_runs r
       join depreciation_lines l on l.run_id = r.id
       join fixed_assets a on a.id = l.asset_id
      where r.legal_entity_id = $1 and r.period = $2::date
      group by r.id, l.department, a.cost_behavior`,
    range,
  );
  for (const d of depreciation) {
    const accAccount = departmentAccount(d.department, 'accounting');
    const mgmtAccount = departmentAccount(d.department, 'management');
    const sameAccount = accAccount === mgmtAccount;
    const sameAmount = Math.abs(Number(d.accounting) - Number(d.management)) < 0.005;

    const entries: Entry[] =
      sameAccount && sameAmount
        ? [{ debit: accAccount, credit: '131', amount: d.accounting, note: 'Амортизація' }]
        : [
            { debit: accAccount, credit: '131', amount: d.accounting, book: 'accounting', note: 'Амортизація' },
            { debit: mgmtAccount, credit: '131', amount: d.management, book: 'management', note: 'Амортизація' },
          ];

    if (d.department === 'production') {
      if (d.cost_behavior === 'fixed') shopFixed += Number(d.accounting);
      else shopVariable += Number(d.accounting);
    }
    count += await addBatch(client, entityId, 'depreciation', d.run_id, monthEnd, 'Амортизація за місяць', entries);
  }

  // ─── Розподіл цеху: лише в бухгалтерській книзі, за НП(С)БО 16 ───────────
  // Змінні ЗВВ лягають на випуск повністю. Постійні — у частці фактичного
  // завантаження до нормальної потужності, а нерозподілений залишок іде прямо
  // в собівартість реалізації: недозавантаження є збитком періоду, а не
  // вартістю продукту.
  if (shopVariable + shopFixed > 0) {
    const { rows: volume } = await client.query<{ produced: number; sold: number }>(
      `select
         coalesce((select sum(produced_qty) from production_orders
                    where legal_entity_id = $1 and status = 'done'
                      and finished_at >= $2::date and finished_at < ($2::date + interval '1 month')), 0) as produced,
         coalesce((select sum(sl.qty) from shipment_lines sl
                     join shipments sh on sh.id = sl.shipment_id
                     join sales_orders o on o.id = sh.so_id
                     join items i on i.id = sl.item_id
                    where o.legal_entity_id = $1 and i.kind = 'finished'
                      and sh.shipped_on >= $2::date and sh.shipped_on < ($2::date + interval '1 month')), 0) as sold`,
      range,
    );
    const produced = Number(volume[0]?.produced ?? 0);
    const sold = Number(volume[0]?.sold ?? 0);
    const soldShare = produced > 0 ? Math.min(1, sold / produced) : 0;

    // Фактична база випуску проти нормальної потужності.
    const { rows: cfg } = await client.query<{ base: string }>(
      'select overhead_allocation_base as base from legal_entities where id = $1',
      [entityId],
    );
    const { rows: outputBase } = await client.query<{ quantity: number; weight_kg: number }>(
      'select quantity, weight_kg from v_output_base_monthly where legal_entity_id = $1 and period = $2::date',
      range,
    );
    const { rows: capacity } = await client.query<{ capacity: number }>(
      `select capacity from normal_capacity
        where legal_entity_id = $1 and valid_from <= $2::date
        order by valid_from desc limit 1`,
      range,
    );

    const byWeight = cfg[0]?.base === 'weight';
    const actualBase = Number(
      byWeight ? (outputBase[0]?.weight_kg ?? 0) : (outputBase[0]?.quantity ?? 0),
    );
    const normalBase = Number(capacity[0]?.capacity ?? 0);

    // Якщо нормальну потужність не задано, розподіляємо все — інакше система
    // мовчки занижувала б вартість запасів.
    const utilization = normalBase > 0 ? Math.min(1, actualBase / normalBase) : 1;
    const fixedAllocated = round2(shopFixed * utilization);
    const fixedUnallocated = round2(shopFixed - fixedAllocated);
    const capitalized = round2(shopVariable + fixedAllocated);

    const lastDay = new Date(new Date(period).getFullYear(), new Date(period).getMonth() + 1, 0)
      .toISOString()
      .slice(0, 10);

    count += await addBatch(client, entityId, 'period_close', null, lastDay, 'Розподіл витрат цеху', [
      {
        debit: '26',
        credit: '23',
        amount: capitalized,
        book: 'accounting',
        note: `Змінні повністю + постійні на ${Math.round(utilization * 1000) / 10}% завантаження`,
      },
      {
        debit: '901',
        credit: '23',
        amount: fixedUnallocated,
        book: 'accounting',
        note: 'Нерозподілені постійні ЗВВ — збиток недозавантаження',
      },
      {
        debit: '901',
        credit: '26',
        amount: capitalized * soldShare,
        book: 'accounting',
        note: `Частка проданого ${Math.round(soldShare * 1000) / 10}%`,
      },
    ]);
  }

  // ─── Закриття доходів і витрат на результат, окремо для кожної книги ─────
  const lastDay = new Date(new Date(period).getFullYear(), new Date(period).getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);

  for (const book of ['accounting', 'management'] as const) {
    const { rows: balances } = await client.query<{ code: string; kind: string; balance: number }>(
      `select t.code, a.kind, sum(t.debit) - sum(t.credit) as balance
         from v_account_turnover t
         join chart_of_accounts a on a.code = t.code
        where t.legal_entity_id = $1 and t.book = $3
          and t.posted_on >= $2::date and t.posted_on < ($2::date + interval '1 month')
          and a.kind in ('income', 'expense')
        group by t.code, a.kind`,
      [entityId, period, book],
    );

    const closing: Entry[] = [];
    for (const b of balances) {
      const balance = Number(b.balance);
      if (Math.abs(balance) < 0.005) continue;
      // Дохід має кредитове сальдо, витрати — дебетове.
      if (balance < 0) closing.push({ debit: b.code, credit: '791', amount: -balance, book });
      else closing.push({ debit: '791', credit: b.code, amount: balance, book });
    }

    count += await addBatch(
      client,
      entityId,
      'period_close',
      null,
      lastDay,
      `Закриття періоду (${book === 'accounting' ? 'бухгалтерський' : 'управлінський'})`,
      closing,
    );
  }

  await client.query(
    `insert into posting_runs (legal_entity_id, period, generated_by, postings_count)
     values ($1, $2, $3, $4)
     on conflict (legal_entity_id, period) do update
       set generated_at = now(), generated_by = excluded.generated_by,
           postings_count = excluded.postings_count`,
    [entityId, period, userId, count],
  );

  return count;
}
