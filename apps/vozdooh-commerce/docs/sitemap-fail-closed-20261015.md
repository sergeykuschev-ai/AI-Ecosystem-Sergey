# VOZDOOH sitemap reliability — 2026-10-15

## Problem

The sitemap endpoint silently returned only static URLs when staged 1C catalog retrieval failed. A transient outage could therefore replace the normal 194-URL XML with 17 static-only URLs, giving crawlers a misleading inventory of public pages. Stock fluctuations legitimately change the catalog; this fix is exclusively for a *failure* to retrieve its data.

## Fix

Fail closed with `SITEMAP_CATALOG_UNAVAILABLE` on catalog retrieval errors instead of issuing a valid partial sitemap. Emit only a coarse error code, not credentials, orders, customer data, or source paths. Next.js maps a thrown error to a temporary server error response; once the source recovers, the full live sitemap is returned again. Do not cache unverified stale stock in search output. When the catalog is healthy, URL selection, priorities, and robots rules are unchanged.

## Test and release gates

Regression `tests/public-product-seo.test.cjs` asserts a temporary catalog outage is rejected (not converted to a static-only map) and the coarse error is logged. `npm run verify` covers commerce, SEO, TypeScript, lint, and Next.js build. Release only the web service to `stores-web1`, retain the previous Docker tag, and compare before/after public sitemap URL sets plus principal checkout routes. Check search indexing in the external search engine separately, not by assuming HTTP 200 means indexing.
