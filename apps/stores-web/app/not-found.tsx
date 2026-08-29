import Link from "next/link";
import { StaticPage } from "@/components/content/StaticPage";

export default function NotFound() {
  return <StaticPage title="Страница не найдена" intro="Возможно, адрес изменился или страница ещё не опубликована."><section className="section"><h2>Куда перейти</h2><p><Link href="/">На главную</Link> или <Link href="/stores/">к списку магазинов</Link>.</p></section></StaticPage>;
}
