import type { Metadata } from "next";
import Link from "next/link";
import { StaticPage } from "@/components/content/StaticPage";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({ title: "Контакты магазинов в Амурске", description: "Контактная информация физических магазинов Ампер, Вентиль, Метиз Маркет и Миска в Амурске.", path: "/kontakty/" });
export default function ContactsPage() {
  return <StaticPage eyebrow="Связаться" title="Контакты" intro="Телефоны, адреса и режим работы публикуются отдельно для каждой подтверждённой торговой точки."><section className="feature-panel" aria-labelledby="contact-store"><h2 id="contact-store">Выберите магазин</h2><p>Откройте список магазинов Амурска, затем выберите нужный магазин.</p><Link href="/stores/amursk/">Магазины Амурска <span aria-hidden="true">→</span></Link></section></StaticPage>;
}
