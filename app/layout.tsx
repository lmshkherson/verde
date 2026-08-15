import type { Metadata } from "next";
import { Onest, Unbounded } from "next/font/google";
import { CartProvider } from "@/components/cart/CartProvider";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { site } from "@/lib/site";
import "./globals.css";

const display = Unbounded({
  variable: "--font-unbounded",
  subsets: ["cyrillic", "latin"],
  weight: ["600", "700", "800"],
  display: "swap",
});

const sans = Onest({
  variable: "--font-onest",
  subsets: ["cyrillic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} — авточохли власного виробництва`,
    template: `%s | ${site.name}`,
  },
  description: site.description,
  openGraph: {
    type: "website",
    locale: "uk_UA",
    siteName: site.name,
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="uk"
      className={`${display.variable} ${sans.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <CartProvider>
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
        </CartProvider>
      </body>
    </html>
  );
}
