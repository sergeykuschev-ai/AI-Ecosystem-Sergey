import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getPublishedArticles } from "@/lib/articles/articles";
import { createArticleJsonLd } from "@/lib/seo/json-ld";

const articles = getPublishedArticles();

describe("article pilot", () => {
  test("publishes exactly the three reviewed pilot articles with unique slugs", () => {
    assert.equal(articles.length, 3);
    assert.equal(new Set(articles.map((article) => article.slug)).size, articles.length);
  });

  test("ties every article to a commercial support page and verifiable sources", () => {
    for (const article of articles) {
      assert.ok(article.relatedLinks.length >= 1);
      assert.ok(article.relatedLinks.every((link) => link.href.startsWith("/") && link.href.endsWith("/")));
      assert.ok(article.sources.length >= 2);
      assert.ok(article.sources.every((source) => source.href.startsWith("https://")));
    }
  });

  test("renders Article JSON-LD from visible article metadata", () => {
    for (const article of articles) {
      const jsonLd = createArticleJsonLd(article);
      assert.equal(jsonLd["@type"], "Article");
      assert.equal(jsonLd.headline, article.title);
      assert.equal(jsonLd.description, article.description);
      assert.equal(jsonLd.datePublished, article.publishedAt);
      assert.equal(jsonLd.dateModified, article.updatedAt);
      assert.match(String(jsonLd.url), new RegExp(`/stati/${article.slug}/$`));
    }
  });

  test("avoids banned promotional absolutes and hard typography markers", () => {
    const text = JSON.stringify(articles).toLowerCase();
    assert.doesNotMatch(text, /гарантированно/);
    assert.doesNotMatch(text, /\bлучший\b/);
    assert.doesNotMatch(text, /[—–…“”]/);
  });

  test("keeps the electrical safety boundary explicit", () => {
    const article = articles.find((item) => item.brand === "amper");
    assert.ok(article);
    const text = JSON.stringify(article).toLowerCase();
    assert.match(text, /если параметры линии неизвестны/);
    assert.match(text, /квалифицированному специалисту/);
    assert.doesNotMatch(text, /на розетки всегда/);
  });
});
