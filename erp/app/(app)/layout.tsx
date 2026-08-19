import { BottomNav, Sidebar, TopBar, type EntityOption, type NavItem } from '@/components/nav';
import { query } from '@/lib/db';
import { canAccess, requireSession, ROLE_LABELS, type Section } from '@/lib/session';

const ALL_ITEMS: (NavItem & { section: Section })[] = [
  { section: 'dashboard', href: '/', label: 'Огляд', short: 'Огляд', icon: '📊' },
  { section: 'stock', href: '/stock', label: 'Склад', short: 'Склад', icon: '📦' },
  { section: 'production', href: '/production', label: 'Виробництво', short: 'Цех', icon: '🏭' },
  { section: 'sales', href: '/sales', label: 'Продажі', short: 'Продажі', icon: '🧾' },
  { section: 'sales', href: '/returns', label: 'Повернення', short: 'Поверн.', icon: '↩️' },
  { section: 'purchasing', href: '/receipts', label: 'Надходження', short: 'Надход.', icon: '📥' },
  { section: 'purchasing', href: '/purchasing', label: 'Закупівлі', short: 'Закупки', icon: '🚚' },
  { section: 'purchasing', href: '/purchasing/returns', label: 'Повернення пост.', short: 'Пов.пост', icon: '↪️' },
  { section: 'catalog', href: '/catalog', label: 'Номенклатура', short: 'SKU', icon: '🏷️' },
  { section: 'catalog', href: '/labeling', label: 'Маркування', short: 'Етикетка', icon: '🥜' },
  { section: 'stock', href: '/stocktake', label: 'Інвентаризація', short: 'Інвент.', icon: '📋' },
  { section: 'stock', href: '/writeoffs', label: 'Списання', short: 'Спис.', icon: '🗑️' },
  { section: 'stock', href: '/traceability', label: 'Простежуваність', short: 'Партії', icon: '🔎' },
  { section: 'quality', href: '/quality', label: 'Вхідний контроль', short: 'Вхід.к', icon: '🧪' },
  { section: 'quality', href: '/haccp', label: 'HACCP', short: 'HACCP', icon: '🌡️' },
  { section: 'production', href: '/recalls', label: 'Відкликання', short: 'Відкл.', icon: '⚠️' },
  { section: 'bank', href: '/bank', label: 'Банк', short: 'Банк', icon: '🏦' },
  { section: 'bank', href: '/cash', label: 'Каса', short: 'Каса', icon: '💵' },
  { section: 'reports', href: '/pl', label: 'Фінрезультат', short: 'P&L', icon: '💰' },
  { section: 'reports', href: '/accounting', label: 'Бухоблік', short: 'Бух', icon: '📒' },
  { section: 'reports', href: '/vat', label: 'ПДВ', short: 'ПДВ', icon: '🧮' },
  { section: 'reports', href: '/single-tax', label: 'Єдиний податок', short: 'ЄП', icon: '🧾' },
  { section: 'reports', href: '/payroll', label: 'Зарплата', short: 'ЗП', icon: '👥' },
  { section: 'reports', href: '/assets', label: 'Основні засоби', short: 'ОЗ', icon: '🏗️' },
  { section: 'reports', href: '/reports', label: 'Звіти', short: 'Звіти', icon: '📈' },
  { section: 'reports', href: '/integrations', label: 'Обмін документами', short: 'Обмін', icon: '🔁' },
  { section: 'reports', href: '/entities', label: 'Юрособи', short: 'Юрособи', icon: '🏛️' },
  { section: 'reports', href: '/users', label: 'Користувачі', short: 'Люди', icon: '🔑' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const items = ALL_ITEMS.filter((item) => canAccess(session.role, item.section));
  const roleLabel = ROLE_LABELS[session.role];

  const entities = await query<EntityOption>(
    'select id, short_name, is_vat_payer from legal_entities where is_active order by short_name',
  );

  return (
    <div className="flex min-h-dvh">
      <Sidebar
        items={items}
        name={session.name}
        roleLabel={roleLabel}
        entities={entities}
        currentEntityId={session.eid}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          name={session.name}
          roleLabel={roleLabel}
          entities={entities}
          currentEntityId={session.eid}
        />
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 pb-24 lg:p-8 lg:pb-8">{children}</main>
        <BottomNav items={items} />
      </div>
    </div>
  );
}
