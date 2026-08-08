import Link from 'next/link';
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-emerald-950 sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-emerald-800/70">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({
  title,
  children,
  className = '',
  action,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section className={`rounded-2xl border border-emerald-900/10 bg-white shadow-sm ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-emerald-900/10 px-4 py-3">
          {title && <h2 className="text-sm font-bold uppercase tracking-wide text-emerald-900">{title}</h2>}
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'warn' | 'danger' | 'good';
}) {
  const tones = {
    default: 'text-emerald-950',
    good: 'text-emerald-600',
    warn: 'text-amber-600',
    danger: 'text-red-600',
  };
  return (
    <div className="rounded-2xl border border-emerald-900/10 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-emerald-800/60">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tones[tone]}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-emerald-800/60">{hint}</div>}
    </div>
  );
}

const badgeTones: Record<string, string> = {
  gray: 'bg-emerald-900/8 text-emerald-900',
  green: 'bg-emerald-100 text-emerald-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-700',
  blue: 'bg-sky-100 text-sky-800',
};

export function Badge({ children, tone = 'gray' }: { children: ReactNode; tone?: keyof typeof badgeTones }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${badgeTones[tone]}`}>
      {children}
    </span>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[540px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-emerald-900/10 text-left">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-2 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-800/60">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <tr className="border-b border-emerald-900/5 last:border-0 hover:bg-emerald-50/40">{children}</tr>;
}

export function Cell({
  children,
  align = 'left',
  className = '',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <td className={`px-2 py-2 ${align === 'right' ? 'text-right tabular-nums' : ''} ${className}`}>
      {children}
    </td>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-emerald-800/50">{children}</p>;
}

export function Button({
  children,
  type = 'submit',
  variant = 'primary',
  className = '',
  ...rest
}: {
  children: ReactNode;
  type?: 'submit' | 'button';
  variant?: 'primary' | 'ghost' | 'danger';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants = {
    primary: 'bg-emerald-700 text-white hover:bg-emerald-800',
    ghost: 'border border-emerald-900/15 bg-white text-emerald-900 hover:bg-emerald-50',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  };
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold transition disabled:opacity-50 ${variants[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = 'ghost' }: { href: string; children: ReactNode; variant?: 'primary' | 'ghost' }) {
  const variants = {
    primary: 'bg-emerald-700 text-white hover:bg-emerald-800',
    ghost: 'border border-emerald-900/15 bg-white text-emerald-900 hover:bg-emerald-50',
  };
  return (
    <Link
      href={href}
      className={`inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold transition ${variants[variant]}`}
    >
      {children}
    </Link>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-emerald-800/70">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-emerald-800/50">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full min-h-11 rounded-xl border border-emerald-900/15 bg-white px-3 text-base text-emerald-950 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20';

export function Alert({ children, tone = 'red' }: { children: ReactNode; tone?: 'red' | 'amber' | 'green' }) {
  const tones = {
    red: 'border-red-200 bg-red-50 text-red-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  };
  return <div className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>;
}
