export type ArticleBrand = "amper" | "ventil" | "metiz-market" | "miska" | "general";

export type ArticleBlock =
  | { type: "paragraph"; text: string }
  | { type: "unordered-list"; items: readonly string[] }
  | { type: "ordered-list"; items: readonly string[] };

export interface ArticleSection {
  heading: string;
  blocks: readonly ArticleBlock[];
}

export interface ArticleLink {
  href: string;
  label: string;
}

export interface Article {
  slug: string;
  title: string;
  description: string;
  intro: string;
  publishedAt: string;
  updatedAt: string;
  brand: ArticleBrand;
  sections: readonly ArticleSection[];
  relatedLinks: readonly ArticleLink[];
  sources: readonly ArticleLink[];
}
