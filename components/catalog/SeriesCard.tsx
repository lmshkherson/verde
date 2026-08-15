import Link from "next/link";
import { SeatPreview } from "@/components/product/SeatPreview";
import { Badge, Price } from "@/components/ui";
import { pluralize } from "@/lib/format";
import { tierLabels } from "@/lib/pricing";

type Props = {
  series: {
    slug: string;
    name: string;
    tagline: string;
    tier: string;
    popular: boolean;
    warrantyMonths: number;
    productionDays: number;
    shortDescription: string;
    material: { name: string; wearYears: number };
    colors: { hex: string; insertHex: string; threadHex: string; name: string }[];
  };
  price: number;
  oldPrice?: number;
  /** Ціна вже під конкретне авто, а не «від» */
  exact?: boolean;
  href?: string;
};

export function SeriesCard({ series, price, oldPrice = 0, exact, href }: Props) {
  const cover = series.colors[0];
  const url = href ?? `/product/${series.slug}`;

  return (
    <article className="group flex flex-col overflow-hidden rounded-[4px] border border-line bg-white transition-shadow hover:shadow-[0_24px_60px_-40px_rgba(20,22,26,0.55)]">
      <Link href={url} className="relative block bg-paper-warm px-6 py-6">
        <div className="absolute left-4 top-4 flex flex-col items-start gap-1.5">
          <Badge tone={series.popular ? "accent" : "neutral"}>
            {tierLabels[series.tier] ?? series.tier}
          </Badge>
          {series.popular ? <Badge tone="sale">Хіт продажів</Badge> : null}
        </div>
        {cover ? (
          <SeatPreview
            hex={cover.hex}
            insertHex={cover.insertHex}
            threadHex={cover.threadHex}
            quilting={series.tier === "premium" ? "romb" : "none"}
            className="mx-auto h-52 w-auto"
            title={`Чохли ${series.name}, колір ${cover.name}`}
          />
        ) : null}
      </Link>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          <h3 className="text-lg font-bold">
            <Link href={url} className="hover:text-tan-deep">
              {series.name}
            </Link>
          </h3>
          <p className="mt-1 text-sm text-ink-muted">{series.tagline}</p>
        </div>

        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">Матеріал</dt>
            <dd className="text-right font-medium">{series.material.name}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">Ресурс</dt>
            <dd className="text-right font-medium">
              {pluralize(series.material.wearYears, "рік", "роки", "років")}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">Гарантія</dt>
            <dd className="text-right font-medium">
              {pluralize(series.warrantyMonths, "місяць", "місяці", "місяців")}
            </dd>
          </div>
        </dl>

        <div className="mt-auto flex items-end justify-between gap-3 border-t border-line-soft pt-4">
          <div>
            {!exact ? (
              <span className="block text-xs text-ink-muted">від</span>
            ) : null}
            <Price value={price} oldValue={oldPrice} />
          </div>
          <Link
            href={url}
            className="rounded-[4px] bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
          >
            Обрати
          </Link>
        </div>
      </div>
    </article>
  );
}
