import { CartProvider } from "@/components/cart/CartProvider";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { OrganizationJsonLd, WebSiteJsonLd } from "@/components/seo/JsonLd";

/** Макет вітрини: шапка, підвал і кошик. Адмінка живе поза цією групою. */
export default function ShopLayout({ children }: LayoutProps<"/">) {
  return (
    <CartProvider>
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
      <OrganizationJsonLd />
      <WebSiteJsonLd />
    </CartProvider>
  );
}
