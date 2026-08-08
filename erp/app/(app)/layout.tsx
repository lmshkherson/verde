import { BottomNav, Sidebar, TopBar, type NavItem } from '@/components/nav';
import { canAccess, requireSession, ROLE_LABELS, type Section } from '@/lib/session';

const ALL_ITEMS: (NavItem & { section: Section })[] = [
  { section: 'dashboard', href: '/', label: 'Огляд', short: 'Огляд', icon: '📊' },
  { section: 'stock', href: '/stock', label: 'Склад', short: 'Склад', icon: '📦' },
  { section: 'production', href: '/production', label: 'Виробництво', short: 'Цех', icon: '🏭' },
  { section: 'sales', href: '/sales', label: 'Продажі', short: 'Продажі', icon: '🧾' },
  { section: 'purchasing', href: '/purchasing', label: 'Закупівлі', short: 'Закупки', icon: '🚚' },
  { section: 'catalog', href: '/catalog', label: 'Номенклатура', short: 'SKU', icon: '🏷️' },
  { section: 'reports', href: '/reports', label: 'Звіти', short: 'Звіти', icon: '📈' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const items = ALL_ITEMS.filter((item) => canAccess(session.role, item.section));
  const roleLabel = ROLE_LABELS[session.role];

  return (
    <div className="flex min-h-dvh">
      <Sidebar items={items} name={session.name} roleLabel={roleLabel} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar name={session.name} roleLabel={roleLabel} />
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 pb-24 lg:p-8 lg:pb-8">{children}</main>
        <BottomNav items={items} />
      </div>
    </div>
  );
}
