import type { Metadata } from "next";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { StoreNavigationBar } from "@/components/layout/StoreNavigationBar";
import { siteUrl } from "@/lib/seo/metadata";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: { default: "Магазины Амурска", template: "%s" },
  description: "Официальные страницы магазинов Ампер, Вентиль, Метиз Маркет и Миска в Амурске.",
  applicationName: "Магазины Амурска",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>
        <a className="skip-link" href="#main-content">Перейти к содержимому</a>
        <StoreNavigationBar />
        <Header />
        <div id="main-content">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
