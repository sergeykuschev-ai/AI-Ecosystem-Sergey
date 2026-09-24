import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StaticPage } from "@/components/content/StaticPage";
import { getArticle } from "@/lib/articles/articles";
import { createPageMetadata } from "@/lib/seo/metadata";

interface PageProps { params: Promise<{ slug: string }>; }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const article = getArticle((await params).slug);
  if (!article) notFound();
  return createPageMetadata({ title: article.title, description: article.description, path: `/stati/${article.slug}/` });
}

export default async function ArticlePage({ params }: PageProps) {
  const article = getArticle((await params).slug);
  if (!article) notFound();
  return (
    <StaticPage eyebrow="Статья" title={article.title} intro={article.intro}>
      <article>
        {article.sections.map((section) => <section className="section" key={section.heading}><h2>{section.heading}</h2>{section.paragraphs.map((p) => <p key={p}>{p}</p>)}</section>)}
        {article.relatedLinks.length > 0 && <section className="section"><h2>По теме</h2><ul className="link-list">{article.relatedLinks.map((link) => <li key={link.href}><Link href={link.href}>{link.label}</Link></li>)}</ul></section>}
      </article>
    </StaticPage>
  );
}
