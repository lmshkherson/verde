import type { ReactNode } from "react";

/**
 * Мінімальний рендер розмітки статей: заголовки, списки, жирний текст, абзаци.
 * Свідомо не тягнемо повноцінний markdown-парсер і не використовуємо
 * dangerouslySetInnerHTML — текст статей приходить з адмінки, і повертати
 * туди HTML означало б відкрити XSS.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`${keyPrefix}-${index}`} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={`${keyPrefix}-${index}`}>{part}</span>;
  });
}

export function renderMarkdown(source: string): ReactNode[] {
  const blocks = source.split(/\n{2,}/);
  const nodes: ReactNode[] = [];

  blocks.forEach((block, index) => {
    const trimmed = block.trim();
    if (!trimmed) return;

    if (trimmed.startsWith("### ")) {
      nodes.push(
        <h3 key={index} className="mt-8 text-lg font-bold">
          {renderInline(trimmed.slice(4), `h3-${index}`)}
        </h3>,
      );
      return;
    }

    if (trimmed.startsWith("## ")) {
      nodes.push(
        <h2 key={index} className="mt-10 text-2xl font-bold">
          {renderInline(trimmed.slice(3), `h2-${index}`)}
        </h2>,
      );
      return;
    }

    const lines = trimmed.split("\n");
    const isList = lines.every((line) => /^[-*]\s+/.test(line.trim()));
    if (isList) {
      nodes.push(
        <ul key={index} className="mt-4 flex flex-col gap-2">
          {lines.map((line, lineIndex) => (
            <li key={lineIndex} className="flex gap-3">
              <span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 bg-tan" />
              <span>{renderInline(line.trim().replace(/^[-*]\s+/, ""), `li-${index}-${lineIndex}`)}</span>
            </li>
          ))}
        </ul>,
      );
      return;
    }

    nodes.push(
      <p key={index} className="mt-4 leading-relaxed">
        {renderInline(trimmed.replace(/\n/g, " "), `p-${index}`)}
      </p>,
    );
  });

  return nodes;
}
