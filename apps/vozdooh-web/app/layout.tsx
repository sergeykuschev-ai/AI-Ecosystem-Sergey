import type { Metadata } from "next";
import { SITE_NAME, getSiteUrl } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: { default: SITE_NAME, template: `%s — ${SITE_NAME}` },
  description: "VOZDOOH — магазин ароматов для дома.",
  applicationName: SITE_NAME,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <div className="site-shell">{children}</div>
      </body>
    </html>
  );
}
