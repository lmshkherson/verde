#!/usr/bin/env node
/**
 * Прибирає демонстраційну номенклатуру після переходу на власні дані.
 *
 *   DATABASE_URL=... node scripts/purge-demo-items.mjs [--dry-run]
 *
 * Позицію, за якою немає жодного документа, видаляє повністю (разом з
 * алергенами й специфікаціями картки). Позицію, що вже фігурує в документах,
 * видалити чесно неможливо — вона деактивується: зникає з усіх списків
 * вибору, але історія документів лишається читабельною.
 */
import pg from 'pg';

const dryRun = process.argv.includes('--dry-run');
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL не заданий');
  process.exit(1);
}

// Повний перелік SKU із демо-сіда (scripts/seed.mjs). Тільки вони: чужого
// цей скрипт не чіпає, тому запускати його безпечно й після імпорту.
const DEMO_SKUS = [
  'VRD-Z-PIST', 'VRD-Z-ARAH', 'VRD-Z-MIGD', 'VRD-Z-KOKO', 'VRD-Z-FUND', 'VRD-COLLAGEN',
  'VRD-TEST-OLD',
  'RAW-FINIK', 'RAW-PIST', 'RAW-ARAH', 'RAW-MIGD', 'RAW-KOKO', 'RAW-FUND', 'RAW-KAKAO',
  'RAW-OLIA', 'RAW-CYKOR', 'RAW-PROTEIN', 'RAW-COLLAG', 'RAW-VITC', 'RAW-GUARANA',
  'RAW-MAGNIY', 'RAW-OMEGA', 'RAW-VITB12', 'RAW-VITD3',
  'PAK-FLOW', 'PAK-BOX', 'PAK-ETIK',
  'SRV-RENT', 'SRV-DELIV', 'SRV-ACC',
];

const client = new pg.Client({
  connectionString,
  ssl: /supabase|amazonaws|render|neon/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
});
await client.connect();

let deleted = 0;
let deactivated = 0;
let absent = 0;

try {
  for (const sku of DEMO_SKUS) {
    const { rows } = await client.query('select id, name, is_active from items where sku = $1', [sku]);
    if (!rows[0]) {
      absent += 1;
      continue;
    }
    const item = rows[0];

    if (dryRun) {
      console.log(`[dry-run] ${sku} — ${item.name}`);
      continue;
    }

    try {
      await client.query('begin');
      // Залежності самої картки — не документи, їх можна прибрати разом:
      // специфікації, рецептури цієї позиції та її входження в чужі рецептури.
      await client.query('delete from product_specs where item_id = $1', [item.id]);
      await client.query(
        `delete from recipe_lines
          where item_id = $1
             or recipe_id in (select id from recipes where product_item_id = $1)`,
        [item.id],
      );
      await client.query('delete from recipes where product_item_id = $1', [item.id]);
      await client.query('delete from items where id = $1', [item.id]);
      await client.query('commit');
      deleted += 1;
      console.log(`видалено: ${sku} — ${item.name}`);
    } catch {
      // Є документи (партії, рухи, рядки) — видалення зруйнувало б історію.
      await client.query('rollback');
      await client.query('update items set is_active = false where id = $1', [item.id]);
      const { rows: stock } = await client.query(
        'select coalesce(sum(qty), 0) as qty from stock_moves where item_id = $1',
        [item.id],
      );
      const qty = Number(stock[0].qty);
      deactivated += 1;
      console.log(
        `деактивовано (є документи): ${sku} — ${item.name}` +
          (Math.abs(qty) > 0.0005 ? ` — увага, залишок ${qty} схований зі складських екранів` : ''),
      );
    }
  }

  console.log(
    `\nГотово: видалено ${deleted}, деактивовано ${deactivated}, не знайдено ${absent} із ${DEMO_SKUS.length}.`,
  );
  if (deactivated > 0) {
    console.log(
      'Деактивовані позиції зникли зі списків вибору; їхні документи лишилися в історії.',
    );
  }
} finally {
  await client.end();
}
