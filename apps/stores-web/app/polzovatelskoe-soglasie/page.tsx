import type { Metadata } from "next";
import { StaticPage } from "@/components/content/StaticPage";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Пользовательское соглашение",
  description: "Страница для публикации утверждённого пользовательского соглашения.",
  path: "/polzovatelskoe-soglasie/",
  noIndex: true,
});

export default function UserAgreementPage() {
  return (
    <StaticPage
      title="Пользовательское соглашение"
      intro="Документ находится в стадии утверждения."
    >
      <section className="section prose" aria-labelledby="user-agreement-status">
        <h2 id="user-agreement-status">Статус документа</h2>
        <p>
          Пользовательское соглашение сейчас согласовывается с юристом. Утверждённый текст будет опубликован на этой
          странице; до публикации страница исключена из индексации поисковых систем.
        </p>
      </section>
    </StaticPage>
  );
}
