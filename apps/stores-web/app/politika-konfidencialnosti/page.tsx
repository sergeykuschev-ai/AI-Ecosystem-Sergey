import type { Metadata } from "next";
import { StaticPage } from "@/components/content/StaticPage";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({ title: "Политика конфиденциальности", description: "Страница для публикации утверждённой политики конфиденциальности.", path: "/politika-konfidencialnosti/", noIndex: true });

export default function PrivacyPage() {
  return (
    <StaticPage title="Политика конфиденциальности" intro="Документ находится в стадии утверждения.">
      <section className="section prose" aria-labelledby="privacy-status">
        <h2 id="privacy-status">Статус документа</h2>
        <p>Политика конфиденциальности сейчас согласовывается с юристом. Утверждённый текст будет опубликован на этой странице.</p>
        <p>До публикации утверждённой редакции страница исключена из индексации поисковых систем.</p>
      </section>
    </StaticPage>
  );
}
