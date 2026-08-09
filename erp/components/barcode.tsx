import { eanSvg } from '@/lib/barcode.mjs';

/**
 * Штрихкод малюнком. SVG вставляється як розмітка, бо його породжує наш власний
 * генератор із перевіреного коду — стороннього вводу тут немає.
 */
export function Barcode({
  value,
  moduleMm = 0.264,
  barHeight = 60,
  className = '',
}: {
  value: string | null | undefined;
  moduleMm?: number;
  barHeight?: number;
  className?: string;
}) {
  if (!value) return null;
  const drawn = eanSvg(value, { moduleMm, barHeight });

  // Код, що не є EAN, показуємо текстом: краще чесна цифра, ніж хибні смуги.
  if (!drawn) return <span className={`font-mono text-[10px] ${className}`}>{value}</span>;

  return (
    <span
      className={`inline-block ${className}`}
      data-barcode={value}
      dangerouslySetInnerHTML={{ __html: drawn.svg }}
    />
  );
}
