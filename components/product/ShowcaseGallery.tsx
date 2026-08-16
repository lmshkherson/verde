"use client";

import Image from "next/image";
import { useState } from "react";
import { SeatPreview } from "@/components/product/SeatPreview";

type Photo = { id: number; url: string; alt: string; kind: string };

export function ShowcaseGallery({
  photos,
  carLabel,
}: {
  photos: Photo[];
  carLabel: string;
}) {
  // Першим показуємо салон із чохлами — заради нього людина й прийшла.
  const ordered = [
    ...photos.filter((photo) => photo.kind === "covers"),
    ...photos.filter((photo) => photo.kind !== "covers"),
  ];
  const [active, setActive] = useState(0);
  const current = ordered[active];

  if (ordered.length === 0) {
    return (
      <div className="flex aspect-4/3 items-center justify-center rounded-[4px] border border-line bg-paper-warm">
        <SeatPreview
          hex="#2A2E33"
          insertHex="#4E545C"
          threadHex="#8B929B"
          className="h-64 w-auto"
          title={carLabel}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-4/3 overflow-hidden rounded-[4px] border border-line bg-paper-warm">
        <Image
          src={current.url}
          alt={current.alt || carLabel}
          fill
          sizes="(max-width: 1024px) 100vw, 60vw"
          priority
          className="object-cover"
        />
        <span className="absolute bottom-3 left-3 rounded-[3px] bg-ink/80 px-2.5 py-1 text-xs font-semibold text-paper">
          {current.kind === "car" ? "Автомобіль" : "Чохли в салоні"}
        </span>
      </div>

      {ordered.length > 1 ? (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {ordered.map((photo, index) => (
            <li key={photo.id}>
              <button
                type="button"
                onClick={() => setActive(index)}
                aria-label={`Фото ${index + 1}`}
                aria-current={index === active}
                className={`relative block aspect-4/3 w-full overflow-hidden rounded-[3px] border-2 transition-colors ${
                  index === active ? "border-ink" : "border-line hover:border-ink-faint"
                }`}
              >
                <Image
                  src={photo.url}
                  alt={photo.alt || carLabel}
                  fill
                  sizes="120px"
                  className="object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
