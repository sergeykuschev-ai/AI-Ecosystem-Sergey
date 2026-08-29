import type { Metadata } from "next";
import { StaticPage } from "@/components/content/StaticPage";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({ title: "О компании", description: "О web-платформе магазинов Ампер, Вентиль, Метиз Маркет и Миска.", path: "/o-kompanii/" });
export default function AboutPage() {
  return <StaticPage eyebrow="О платформе" title="О компании" intro="Сайт объединяет официальную информацию о магазинах «Ампер», «Вентиль», «Метиз Маркет» и «Миска»."><section className="section prose" aria-labelledby="principles"><h2 id="principles">Четыре магазина — единый удобный доступ</h2><p>Каждый магазин сохраняет собственное имя, логотип и визуальную идентичность. Информация о городах и физических торговых точках хранится отдельно, поэтому новые точки и города можно добавлять без изменения структуры сайта.</p><h2>Первый этап</h2><p>Сейчас платформа работает для Амурска и публикует справочную информацию. Каталог, цены, остатки и онлайн-покупка не входят в первую версию.</p></section></StaticPage>;
}
