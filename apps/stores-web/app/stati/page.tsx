import type { Metadata } from "next";
import Link from "next/link";
import { StaticPage } from "@/components/content/StaticPage";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { EmptyState } from "@/components/ui/EmptyState";
import { getPublishedArticles } from "@/lib/articles/articles";
import { createListingPageMetadata } from "@/lib/seo/metadata";

const metadataInput = {
  title: "Полезные статьи | Магазины Амурска",
  description: "Практические материалы от магазинов Ампер, Вентиль, Метиз Маркет и Миска в Амурске.",
  path: "/stati/",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}

export function generateMetadata(): Metadata {
  return createListingPageMetadata(metadataInput, getPublishedArticles().length);
}

export default function ArticlesPage() {
  const articles = getPublishedArticles();
  return (
    <StaticPage
      eyebrow="Полезное"
      title="Статьи"
      intro="Практические материалы о выборе и использовании товаров наших магазинов."
      breadcrumbs={<Breadcrumbs trail={[{ name: "Главная", path: "/" }, { name: "Статьи", path: "/stati/" }]} />}
    >
      <section className="section" aria-labelledby="articles-list">
        <h2 id="articles-list">Материалы</h2>
        {articles.length === 0 ? (
          <EmptyState title="Статьи готовятся" text="Раздел появится в поиске только после проверки и публикации первого материала." />
        ) : (
          <div className="article-index">
            {articles.map((article) => (
              <article className="article-index__item" key={article.slug}>
                <p className="article-meta"><time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time></p>
                <h3><Link href={`/stati/${article.slug}/`}>{article.title}</Link></h3>
                <p>{article.description}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </StaticPage>
  );
}
