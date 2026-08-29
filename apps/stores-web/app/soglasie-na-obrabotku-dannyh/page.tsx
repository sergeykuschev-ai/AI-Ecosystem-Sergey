import type { Metadata } from "next";
import { StaticPage } from "@/components/content/StaticPage";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({ title: "Согласие на обработку персональных данных", description: "Страница для публикации утверждённого согласия на обработку персональных данных.", path: "/soglasie-na-obrabotku-dannyh/", noIndex: true });
export default function ConsentPage() {
  return <StaticPage title="Согласие на обработку персональных данных" intro="Юридически утверждённый текст ещё не предоставлен."><section className="section prose" aria-labelledby="consent-status"><h2 id="consent-status">Статус документа</h2><p>[LEGAL_TEXT_NOT_SET]</p><p>До публикации утверждённой редакции эта страница исключена из индексации.</p></section></StaticPage>;
}
