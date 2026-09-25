import { PUBLISHED_ARTICLES } from "./published";
import type { Article } from "./types";
export type { Article, ArticleBlock, ArticleBrand, ArticleLink, ArticleSection } from "./types";

export function getArticle(slug: string): Article | undefined {
  return PUBLISHED_ARTICLES.find((article) => article.slug === slug);
}

export function getPublishedArticles(): readonly Article[] {
  return PUBLISHED_ARTICLES;
}
