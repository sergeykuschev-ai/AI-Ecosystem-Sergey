import type { Metadata } from "next";
import Link from "next/link";
import { StaticPage } from "@/components/content/StaticPage";
import { EmptyState } from "@/components/ui/EmptyState";
import { getPublishedArticles } from "@/lib/articles/articles";
import { createListingPageMetadata } from "@/lib/seo/metadata";

const metadataInput = {
  title: "Полезные статьи | Магазины Амурска",
  description: "Практические материалы от магазинов Ампер, Вентиль, Метиз Маркет и Миска в Амурске.",
  path: "/stati/",
};

export function generateMetadata(): Metadata {
  return createListingPageMetadata(metadataInput, getPublishedArticles().length);
}

export default function ArticlesPage() {
  const articles = getPublishedArticles();
  return (
    <StaticPage eyebrow="Полезное" title="Статьи" intro="Практические материалы о выборе и использовании товаров наших магазинов.">
      <section className="section" aria-labelledby="articles-list">
        <h2 id="articles-list">Материалы</h2>
        {articles.length === 0 ? (
          <EmptyState title="Статьи готовятся" text="Раздел появится в поиске только после проверки и публикации первого материала." />
        ) : (
          <ul className="link-list">
            {articles.map((article) => <li key={article.slug}><Link href={`/stati/${article.slug}/`}>{article.title}</Link></li>)}
          </ul>
        )}
      </section>
    </StaticPage>
  );
}
