import pg from 'pg';

// numeric з Postgres приходить рядком, щоб не втратити точність. Для облікових
// сум нам потрібні числа, тож розбираємо явно — інакше "12.5" + "3" дасть "12.53".
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));

const connectionString = process.env.DATABASE_URL;

declare global {
  // Пул переживає hot reload у dev, інакше кожна перекомпіляція плодить нові конекшни.
  var __verdePool: pg.Pool | undefined;
}

function createPool(): pg.Pool {
  if (!connectionString) {
    throw new Error('DATABASE_URL не заданий — скопіюйте .env.example у .env.local');
  }
  return new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    ssl: /supabase|amazonaws|render|neon/.test(connectionString)
      ? { rejectUnauthorized: false }
      : undefined,
  });
}

export const pool: pg.Pool = global.__verdePool ?? createPool();
if (process.env.NODE_ENV !== 'production') global.__verdePool = pool;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Виконує колбек у транзакції. Будь-яка помилка всередині відкочує геть усе —
 * саме тому списання сировини й випуск продукції не можуть «роз'їхатись».
 */
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
