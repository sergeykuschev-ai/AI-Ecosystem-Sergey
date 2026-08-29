import type { Metadata } from "next";
import { StaticPage } from "@/components/content/StaticPage";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({ title: "Политика конфиденциальности", description: "Страница для публикации утверждённой политики конфиденциальности.", path: "/politika-konfidencialnosti/", noIndex: true });
export default function PrivacyPage() {
  return <StaticPage title="Политика конфиденциальности" intro="Юридически утверждённый текст ещё не предоставлен."><section className="section prose" aria-labelledby="privacy-status"><h2 id="privacy-status">Статус документа</h2><p>[LEGAL_TEXT_NOT_SET]</p><p>До публикации утверждённой редакции эта страница исключена из индексации.</p></section></StaticPage>;
}
