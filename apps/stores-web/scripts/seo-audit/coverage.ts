/**
 * Pure sitemap-coverage checks shared by the production SEO audit and the
 * local regression tests. No network access here: callers pass the sets they
 * collected, so the "published page missing from every sitemap" regression
 * can be tested deterministically.
 */

export interface CoverageIssue {
  severity: "error" | "warning";
  scope: string;
  message: string;
}

/**
 * Every published, indexable path must appear in the union of all declared
 * sitemaps. A missing entry means search engines can only discover the page
 * by chance — this is the failure mode the extended audit exists to catch.
 */
export function findMissingPublishedPaths(
  publishedPaths: readonly string[],
  sitemapUrls: ReadonlySet<string>,
  origin: string,
): CoverageIssue[] {
  const issues: CoverageIssue[] = [];
  for (const path of publishedPaths) {
    const url = new URL(path, origin).href;
    if (!sitemapUrls.has(url)) {
      issues.push({
        severity: "error",
        scope: path,
        message: `published indexable page is missing from every declared sitemap (expected ${url})`,
      });
    }
  }
  return issues;
}

/**
 * Unpublished (draft/hidden) pages must not be advertised in any sitemap.
 */
export function findUnpublishedListedPaths(
  unpublishedPaths: readonly string[],
  sitemapUrls: ReadonlySet<string>,
  origin: string,
): CoverageIssue[] {
  const issues: CoverageIssue[] = [];
  for (const path of unpublishedPaths) {
    const url = new URL(path, origin).href;
    if (sitemapUrls.has(url)) {
      issues.push({
        severity: "error",
        scope: path,
        message: `unpublished page must not appear in any sitemap (found ${url})`,
      });
    }
  }
  return issues;
}

/**
 * The same URL in several sitemaps is not an error for search engines, but
 * it signals that sitemap ownership is unclear; report it as informational.
 */
export function findCrossSitemapDuplicates(
  entriesBySitemap: ReadonlyMap<string, readonly string[]>,
): CoverageIssue[] {
  const owners = new Map<string, string[]>();
  for (const [sitemap, urls] of entriesBySitemap) {
    for (const url of new Set(urls)) {
      const list = owners.get(url) ?? [];
      list.push(sitemap);
      owners.set(url, list);
    }
  }
  const issues: CoverageIssue[] = [];
  for (const [url, sitemaps] of owners) {
    if (sitemaps.length > 1) {
      issues.push({
        severity: "warning",
        scope: url,
        message: `URL is listed in ${sitemaps.length} sitemaps (${sitemaps.join(", ")})`,
      });
    }
  }
  return issues;
}

/**
 * A URL must never appear twice within one sitemap.
 */
export function findIntraSitemapDuplicates(
  entriesBySitemap: ReadonlyMap<string, readonly string[]>,
): CoverageIssue[] {
  const issues: CoverageIssue[] = [];
  for (const [sitemap, urls] of entriesBySitemap) {
    const seen = new Set<string>();
    for (const url of urls) {
      if (seen.has(url)) {
        issues.push({ severity: "error", scope: sitemap, message: `duplicate URL within sitemap: ${url}` });
      }
      seen.add(url);
    }
  }
  return issues;
}
