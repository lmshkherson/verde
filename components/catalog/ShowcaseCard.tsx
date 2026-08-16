import Image from "next/image";
import Link from "next/link";
import { SeatPreview } from "@/components/product/SeatPreview";
import { Badge, Price } from "@/components/ui";

type Props = {
  work: {
    slug: string;
    carLabel: string;
    title: string;
    materialNote: string;
    colorNote: string;
    price: number;
    oldPrice: number;
    series: { name: string } | null;
    photos: { url: string; alt: string; kind: string }[];
  };
};

export function ShowcaseCard({ work }: Props) {
  const cover =
    work.photos.find((photo) => photo.kind === "covers") ?? work.photos[0];

  return (
    <article className="flex flex-col overflow-hidden rounded-[4px] border border-line bg-white transition-shadow hover:shadow-[0_24px_60px_-40px_rgba(20,22,26,0.55)]">
      <Link
        href={`/roboty/${work.slug}`}
        className="relative block aspect-4/3 bg-paper-warm"
      >
        {cover ? (
          <Image
            src={cover.url}
            alt={cover.alt || work.carLabel}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover"
          />
        ) : (
          // Поки фото не завантажили — показуємо схему, а не порожню рамку
          <span className="flex h-full items-center justify-center">
            <SeatPreview
              hex="#2A2E33"
              insertHex="#4E545C"
              threadHex="#8B929B"
              className="h-40 w-auto"
              title={work.carLabel}
            />
          </span>
        )}
        <span className="absolute left-3 top-3">
          <Badge tone="accent">Фото з нашої роботи</Badge>
        </span>
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-5">
        <h3 className="text-lg font-bold">
          <Link href={`/roboty/${work.slug}`} className="hover:text-tan-deep">
            {work.carLabel}
          </Link>
        </h3>

        {work.materialNote ? (
          <p className="text-sm text-ink-muted">{work.materialNote}</p>
        ) : null}
        {work.colorNote ? (
          <p className="text-sm text-ink-muted">{work.colorNote}</p>
        ) : null}

        <div className="mt-auto flex items-end justify-between gap-3 border-t border-line-soft pt-4">
          <Price value={work.price} oldValue={work.oldPrice} />
          <Link
            href={`/roboty/${work.slug}`}
            className="rounded-[4px] bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
          >
            Дивитись
          </Link>
        </div>
      </div>
    </article>
  );
}
