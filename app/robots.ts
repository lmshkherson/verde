import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

// Кошик, оформлення й адмінка не мають потрапляти в жоден індекс.
const disallow = ["/admin", "/cart", "/checkout"];

/**
 * AI-краулери дозволяємо явно. Для магазину це не витік контенту, а канал
 * продажів: коли покупець питає асистента «де пошити чохли на Octavia»,
 * відповідь береться саме з проіндексованих цими ботами сторінок.
 */
const aiBots = [
  "GPTBot", // OpenAI: індекс для ChatGPT
  "OAI-SearchBot", // OpenAI: пошук у ChatGPT
  "ChatGPT-User", // OpenAI: перехід за посиланням у діалозі
  "ClaudeBot", // Anthropic
  "Claude-User",
  "Claude-SearchBot",
  "PerplexityBot", // Perplexity
  "Perplexity-User",
  "Google-Extended", // Gemini
  "Applebot-Extended", // Apple Intelligence
  "Amazonbot",
  "meta-externalagent", // Meta AI
  "Bytespider", // ByteDance
  "cohere-ai",
  "YouBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      ...aiBots.map((userAgent) => ({ userAgent, allow: "/", disallow })),
    ],
    sitemap: `${site.url}/sitemap.xml`,
    host: site.url,
  };
}
