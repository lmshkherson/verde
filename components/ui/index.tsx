import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { formatPrice } from "@/lib/format";

export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-[1200px] px-4 sm:px-6 ${className}`}>
      {children}
    </div>
  );
}

const buttonStyles = {
  primary:
    "bg-ink text-paper hover:bg-ink-soft disabled:bg-ink-faint disabled:cursor-not-allowed",
  accent: "bg-tan text-white hover:bg-tan-deep disabled:bg-ink-faint",
  outline: "border border-ink text-ink hover:bg-ink hover:text-paper",
  ghost: "border border-line text-ink hover:border-ink",
  quiet: "text-ink-muted hover:text-ink",
} as const;

const buttonSizes = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-6 text-[0.95rem]",
  lg: "h-13 px-8 text-base",
} as const;

type ButtonVariant = keyof typeof buttonStyles;
type ButtonSize = keyof typeof buttonSizes;

function buttonClass(variant: ButtonVariant, size: ButtonSize, className = "") {
  return `inline-flex items-center justify-center gap-2 rounded-[4px] font-semibold transition-colors ${buttonStyles[variant]} ${buttonSizes[size]} ${className}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "sale" | "ok";
}) {
  const tones = {
    neutral: "bg-paper-warm text-ink-muted",
    accent: "bg-tan-soft text-tan-deep",
    sale: "bg-sale text-white",
    ok: "bg-ok-soft text-ok",
  };
  return (
    <span
      className={`inline-flex items-center rounded-[3px] px-2 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.1em] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Price({
  value,
  oldValue = 0,
  size = "md",
}: {
  value: number;
  oldValue?: number;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = {
    sm: "text-base",
    md: "text-xl",
    lg: "text-3xl sm:text-4xl",
  };
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className={`tabular font-display font-bold ${sizes[size]}`}>
        {formatPrice(value)} ₴
      </span>
      {oldValue > value ? (
        <span className="tabular text-sm text-ink-faint line-through">
          {formatPrice(oldValue)} ₴
        </span>
      ) : null}
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="max-w-2xl">
        {eyebrow ? <p className="label mb-2">{eyebrow}</p> : null}
        <h2 className="text-2xl font-bold sm:text-3xl">{title}</h2>
        {description ? (
          <p className="mt-2 text-ink-muted">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function Breadcrumbs({
  items,
}: {
  items: { href?: string; label: string }[];
}) {
  return (
    <nav aria-label="Навігація" className="py-4 text-sm text-ink-muted">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex items-center gap-2">
            {item.href ? (
              <Link href={item.href} className="hover:text-ink">
                {item.label}
              </Link>
            ) : (
              <span className="text-ink">{item.label}</span>
            )}
            {index < items.length - 1 ? (
              <span aria-hidden="true" className="text-ink-faint">
                /
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="stitch flex flex-col items-center gap-3 rounded-[4px] bg-white px-6 py-16 text-center">
      <h3 className="text-xl font-bold">{title}</h3>
      <p className="max-w-md text-ink-muted">{description}</p>
      {action}
    </div>
  );
}
