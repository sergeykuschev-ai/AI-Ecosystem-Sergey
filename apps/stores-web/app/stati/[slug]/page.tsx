import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StaticPage } from "@/components/content/StaticPage";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { JsonLd } from "@/components/seo/JsonLd";
import { getArticle, getPublishedArticles, type ArticleBlock } from "@/lib/articles/articles";
import { createArticleJsonLd } from "@/lib/seo/json-ld";
import { createPageMetadata } from "@/lib/seo/metadata";

interface PageProps { params: Promise<{ slug: string }>; }

function formatArticleDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function renderBlock(block: ArticleBlock, index: number) {
  if (block.type === "paragraph") return <p key={index}>{block.text}</p>;
  if (block.type === "ordered-list") {
    return <ol key={index}>{block.items.map((item) => <li key={item}>{item}</li>)}</ol>;
  }
  return <ul key={index}>{block.items.map((item) => <li key={item}>{item}</li>)}</ul>;
}

export function generateStaticParams() {
  return getPublishedArticles().map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const article = getArticle((await params).slug);
  if (!article) notFound();
  return createPageMetadata({ title: article.title, description: article.description, path: `/stati/${article.slug}/` });
}

export default async function ArticlePage({ params }: PageProps) {
  const article = getArticle((await params).slug);
  if (!article) notFound();
  const path = `/stati/${article.slug}/`;

  return (
    <>
      <JsonLd data={createArticleJsonLd(article)} />
      <StaticPage
        eyebrow="Статья"
        title={article.title}
        intro={article.intro}
        breadcrumbs={<Breadcrumbs trail={[
          { name: "Главная", path: "/" },
          { name: "Статьи", path: "/stati/" },
          { name: article.title, path },
        ]} />}
      >
        <article className="article-page">
          <p className="article-meta">
            <time dateTime={article.publishedAt}>Опубликовано {formatArticleDate(article.publishedAt)}</time>
          </p>
          {article.sections.map((section) => (
            <section className="section" key={section.heading}>
              <h2>{section.heading}</h2>
              {section.blocks.map(renderBlock)}
            </section>
          ))}
          {article.relatedLinks.length > 0 && (
            <section className="section">
              <h2>По теме</h2>
              <ul className="link-list">
                {article.relatedLinks.map((link) => <li key={link.href}><Link href={link.href}>{link.label}</Link></li>)}
              </ul>
            </section>
          )}
          {article.sources.length > 0 && (
            <section className="section">
              <h2>Источники</h2>
              <ul className="article-sources">
                {article.sources.map((source) => (
                  <li key={source.href}>
                    <a href={source.href} target="_blank" rel="noopener noreferrer">{source.label}</a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>
      </StaticPage>
    </>
  );
}
