import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Кошик, оформлення й адмінка не мають потрапляти в індекс.
      disallow: ["/admin", "/cart", "/checkout"],
    },
    sitemap: `${site.url}/sitemap.xml`,
    host: site.url,
  };
}
