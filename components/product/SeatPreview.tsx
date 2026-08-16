/**
 * Схематичне зображення сидіння, перефарбоване в обраний колір.
 * Це те, чого немає в конкурентів: покупець одразу бачить поєднання
 * основного кольору, вставок і нитки, а не уявляє його по свотчах.
 *
 * Коли зʼявиться реальна фотозйомка серій, компонент лишається як
 * запасний варіант для комбінацій, які не встигли відзняти.
 */

type Props = {
  hex: string;
  insertHex?: string;
  threadHex?: string;
  /** Стьобання показуємо тільки для преміальних лінійок */
  quilting?: "none" | "romb";
  /** Колір нитки вишивки; порожньо — вишивки немає */
  logoHex?: string;
  className?: string;
  title?: string;
};

export function SeatPreview({
  hex,
  insertHex,
  threadHex = "#ffffff",
  quilting = "none",
  logoHex,
  className,
  title,
}: Props) {
  const insert = insertHex && insertHex.length > 0 ? insertHex : hex;
  // Унікальний суфікс, щоб id градієнтів не конфліктували,
  // коли на сторінці стоїть кілька прев'ю поруч.
  const uid = `${hex}${insert}${threadHex}${quilting}`.replace(/[^a-z0-9]/gi, "");

  return (
    <svg
      viewBox="0 0 200 264"
      className={className}
      role="img"
      aria-label={title ?? "Схематичне зображення сидіння в обраному кольорі"}
    >
      <defs>
        <linearGradient id={`shade-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#000" stopOpacity="0.22" />
          <stop offset="35%" stopColor="#000" stopOpacity="0" />
          <stop offset="65%" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.18" />
        </linearGradient>

        <pattern
          id={`romb-${uid}`}
          width="22"
          height="22"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="22" height="22" fill={insert} />
          <path
            d="M0 0 H22 M0 0 V22"
            stroke={threadHex}
            strokeWidth="1"
            strokeOpacity="0.5"
          />
        </pattern>
      </defs>

      {/* Підголівник */}
      <rect x="66" y="6" width="68" height="42" rx="12" fill={hex} />
      <rect
        x="66"
        y="6"
        width="68"
        height="42"
        rx="12"
        fill={`url(#shade-${uid})`}
      />
      {logoHex ? (
        // Вишивка логотипа йде на підголівнику — саме там її й роблять
        <g stroke={logoHex} strokeWidth="1.6" fill="none" strokeLinecap="round">
          <path d="M90 30 L96 20 L102 30" />
          <path d="M104 20 L104 30 M104 20 L110 20 M104 25 L109 25" />
        </g>
      ) : (
        <path
          d="M78 27 H122"
          stroke={threadHex}
          strokeWidth="1"
          strokeOpacity="0.45"
          strokeDasharray="3 3"
        />
      )}

      {/* Штирі підголівника */}
      <rect x="84" y="46" width="5" height="12" rx="2" fill={hex} opacity="0.8" />
      <rect x="111" y="46" width="5" height="12" rx="2" fill={hex} opacity="0.8" />

      {/* Спинка: бічна підтримка + центральна вставка */}
      <rect x="38" y="56" width="124" height="116" rx="18" fill={hex} />
      <rect
        x="62"
        y="62"
        width="76"
        height="104"
        rx="10"
        fill={quilting === "romb" ? `url(#romb-${uid})` : insert}
      />
      <path
        d="M62 62 V166 M138 62 V166"
        stroke={threadHex}
        strokeWidth="1"
        strokeOpacity="0.55"
        strokeDasharray="4 4"
      />
      <rect
        x="38"
        y="56"
        width="124"
        height="116"
        rx="18"
        fill={`url(#shade-${uid})`}
      />

      {/* Подушка */}
      <rect x="32" y="180" width="136" height="76" rx="16" fill={hex} />
      <rect
        x="58"
        y="186"
        width="84"
        height="64"
        rx="10"
        fill={quilting === "romb" ? `url(#romb-${uid})` : insert}
      />
      <path
        d="M58 186 V250 M142 186 V250"
        stroke={threadHex}
        strokeWidth="1"
        strokeOpacity="0.55"
        strokeDasharray="4 4"
      />
      <rect
        x="32"
        y="180"
        width="136"
        height="76"
        rx="16"
        fill={`url(#shade-${uid})`}
      />
    </svg>
  );
}
