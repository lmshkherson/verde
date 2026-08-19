'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logout } from '@/app/actions/auth';
import { switchEntity } from '@/app/actions/entities';

export interface EntityOption {
  id: string;
  short_name: string;
  is_vat_payer: boolean;
}

/**
 * Перемикач юрособи. Показуємо статус платника ПДВ поруч із назвою — від нього
 * залежать і ціни, і собівартість, тож користувач має бачити, де він працює.
 */
export function EntitySwitcher({
  entities,
  currentId,
  compact = false,
}: {
  entities: EntityOption[];
  currentId: string;
  compact?: boolean;
}) {
  const current = entities.find((e) => e.id === currentId);

  if (entities.length <= 1) {
    return (
      <div className={compact ? 'text-[11px] text-emerald-800/60' : 'px-2 text-xs text-emerald-800/60'}>
        {current?.short_name}
        {current?.is_vat_payer ? ' · з ПДВ' : ' · без ПДВ'}
      </div>
    );
  }

  return (
    <form action={switchEntity} className={compact ? '' : 'px-2'}>
      <select
        name="entity_id"
        defaultValue={currentId}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={`w-full rounded-lg border border-emerald-900/15 bg-white font-semibold text-emerald-900 ${
          compact ? 'px-2 py-1 text-xs' : 'px-2 py-2 text-sm'
        }`}
      >
        {entities.map((e) => (
          <option key={e.id} value={e.id}>
            {e.short_name} {e.is_vat_payer ? '· з ПДВ' : '· без ПДВ'}
          </option>
        ))}
      </select>
    </form>
  );
}

export interface NavItem {
  href: string;
  label: string;
  short: string;
  icon: string;
}

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

export function Sidebar({
  items,
  name,
  roleLabel,
  entities,
  currentEntityId,
}: {
  items: NavItem[];
  name: string;
  roleLabel: string;
  entities: EntityOption[];
  currentEntityId: string;
}) {
  const pathname = usePathname();

  return (
    <aside className="no-print hidden w-60 shrink-0 flex-col border-r border-emerald-900/10 bg-white lg:flex">
      <div className="px-5 py-5 text-xl font-black tracking-wide text-emerald-900">
        VERDE <span className="rounded-md bg-emerald-500 px-1.5 text-white">ERP</span>
      </div>
      <div className="px-3 pb-3">
        <EntitySwitcher entities={entities} currentId={currentEntityId} />
      </div>
      <nav className="flex-1 space-y-1 px-3">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
              isActive(pathname, item.href)
                ? 'bg-emerald-700 text-white'
                : 'text-emerald-900 hover:bg-emerald-50'
            }`}
          >
            <span aria-hidden>{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="border-t border-emerald-900/10 p-3">
        <Link href="/account" className="block rounded-xl px-2 pb-2 hover:bg-emerald-50">
          <div className="truncate text-sm font-semibold text-emerald-950">{name}</div>
          <div className="text-xs text-emerald-800/60">{roleLabel} · змінити пароль</div>
        </Link>
        <form action={logout}>
          <button className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-emerald-800/70 hover:bg-emerald-50">
            Вийти
          </button>
        </form>
      </div>
    </aside>
  );
}

export function TopBar({
  name,
  roleLabel,
  entities,
  currentEntityId,
}: {
  name: string;
  roleLabel: string;
  entities: EntityOption[];
  currentEntityId: string;
}) {
  return (
    <header className="no-print flex items-center justify-between border-b border-emerald-900/10 bg-white px-4 py-3 lg:hidden">
      <div className="text-lg font-black tracking-wide text-emerald-900">
        VERDE <span className="rounded-md bg-emerald-500 px-1.5 text-white">ERP</span>
      </div>
      <div className="flex items-center gap-3">
        <EntitySwitcher entities={entities} currentId={currentEntityId} compact />
        <div className="text-right">
          <div className="max-w-32 truncate text-xs font-semibold text-emerald-950">{name}</div>
          <div className="text-[11px] text-emerald-800/60">{roleLabel}</div>
        </div>
        <form action={logout}>
          <button className="rounded-lg border border-emerald-900/15 px-3 py-1.5 text-xs font-semibold text-emerald-900">
            Вийти
          </button>
        </form>
      </div>
    </header>
  );
}

/** Нижня панель для телефона: у цеху й на складі великим пальцем зручніше знизу. */
export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="no-print fixed inset-x-0 bottom-0 z-40 flex border-t border-emerald-900/10 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
      {items.slice(0, 5).map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${
            isActive(pathname, item.href) ? 'text-emerald-700' : 'text-emerald-900/50'
          }`}
        >
          <span className="text-lg" aria-hidden>
            {item.icon}
          </span>
          {item.short}
        </Link>
      ))}
    </nav>
  );
}
