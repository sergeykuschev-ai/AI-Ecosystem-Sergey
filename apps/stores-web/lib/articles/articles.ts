export interface ArticleSection {
  heading: string;
  paragraphs: readonly string[];
}

export interface Article {
  slug: string;
  title: string;
  description: string;
  intro: string;
  publishedAt: string;
  updatedAt: string;
  brand: "amper" | "ventil" | "metiz-market" | "miska" | "general";
  sections: readonly ArticleSection[];
  relatedLinks: readonly { href: string; label: string }[];
}

// Publication registry. Statejnik drafts are not imported here automatically.
// Only reviewed articles explicitly added to this array become public/indexable.
export const ARTICLES: readonly Article[] = [];

export function getArticle(slug: string): Article | undefined {
  return ARTICLES.find((article) => article.slug === slug);
}

export function getPublishedArticles(): readonly Article[] {
  return ARTICLES;
}
