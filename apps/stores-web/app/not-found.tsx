import type { Metadata } from "next";
import Link from "next/link";
import { StaticPage } from "@/components/content/StaticPage";

// Keep this metadata local so a missing URL cannot look like a normal,
// indexable page.
export const metadata: Metadata = {
  title: "Страница не найдена",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return <StaticPage title="Страница не найдена" intro="Возможно, адрес изменился или страница ещё не опубликована."><section className="section"><h2>Куда перейти</h2><p><Link href="/">На главную</Link> или <Link href="/stores/">к списку магазинов</Link>.</p></section></StaticPage>;
}
