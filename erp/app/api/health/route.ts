import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Перевірка стану для моніторингу й для того, щоб після розгортання одразу
 * побачити, чи система жива і чи застосовані міграції. Секретів не віддає.
 */
export async function GET() {
  const startedAt = Date.now();

  try {
    const state = await queryOne<{
      migrations: number;
      entities: number;
      users: number;
      weak_users: number;
    }>(`
      select
        (select count(*) from schema_migrations)::int                       as migrations,
        (select count(*) from legal_entities where is_active)::int          as entities,
        (select count(*) from app_users where is_active)::int               as users,
        (select count(*) from app_users where is_active and is_demo)::int   as weak_users
    `);

    const warnings: string[] = [];
    if ((state?.entities ?? 0) === 0) warnings.push('Не налаштовано жодної юридичної особи');
    if ((state?.weak_users ?? 0) > 0) {
      warnings.push(`Активні демо-акаунти: ${state?.weak_users}. Деактивуйте перед бойовим запуском`);
    }

    return NextResponse.json({
      status: warnings.length > 0 ? 'warning' : 'ok',
      database: 'connected',
      migrations: state?.migrations ?? 0,
      entities: state?.entities ?? 0,
      users: state?.users ?? 0,
      warnings,
      latencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        database: 'unavailable',
        message: err instanceof Error ? err.message : 'unknown',
      },
      { status: 503 },
    );
  }
}
