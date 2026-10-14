# Sequential SEO P1 implementation — 14 October 2026

Owner-approved scope: seven stages in order; preserve commerce, production catalog, public indexing and existing German tunnel. Search demand and search-platform processing remain unverified. Evidence root: `/opt/vozdooh/state/seo-p1-20261014/`. No search engine submissions or outbound notifications are authorized by this implementation.

## Stage 1 — mobile overflow

Baseline: clean `a672dfd7`; running web revision `3a2a8374`, image `sha256:4c0371eb260fd83bfb65a993a6d64387416ca67c4de90da72082453ebbb718ff`. Live health HTTP 200. The gift collection heading's unbroken first word exceeds its 12ch box. Live document widths at 320/375/390/430px: 392/395/396/430px. The new browser regression fails against unchanged production at 320px.

Mobile collection headings now use the available content width and can wrap long words. Desktop rules, font size, colors and spacing remain unchanged; overflow is not hidden. Opt-in regression: source `/tmp/vozdooh-header-browser-env.sh`, then run `scripts/verify-seo-layout-browser.cjs` with `VOZDOOH_QA_URL`, optional `VOZDOOH_QA_PROXY` and `VOZDOOH_QA_OUTPUT`. It checks ten public routes at 320/375/390/430/1280px, waits for fonts and records 390/1280px screenshots. Only same-origin GET requests are allowed.

Release gates and deployed revision/image/rollback will be recorded after fresh verification.

Fresh `npm run verify` passed (exit 0). The candidate passed all 50 route/viewport combinations; 390/1280 screenshots are in `task1/candidate/` and the gift collection was visually inspected. Regression fails before and passes after the fix. Deployment gate passed; only the web target will be built and replaced. Existing compose's web-only recreation has a short startup interval; rollback retains the prior web image and never restarts the worker.

Deployed and live-verified: revision `228f4ae40a27eb2002309ed3a1d6074a6c5f1e3c`, image `vozdooh-web:seo-p1-layout-20261014`, immutable ID `sha256:f5656249cca3a0e36d48d4f11e4366d4298a1afa8bdf40b0f0157a83e1395c7b`. The image candidate and live site each passed all 50 checks. Live health passed; robots is byte-identical and the sitemap retains exactly 193 URLs. Worker container/image/start time remained unchanged. Rollback: `/opt/vozdooh/backups/deploy/seo-p1-layout-20261014/rollback.sh`. No commerce writes occurred. No search processing or ranking outcome is claimed.

## Stage 2 — contextual discovery

A server-rendered navigation section connects home/catalog to stocked CULTI/TEATRO, diffuser/candle pages, home-fragrance/gift-diffusers collections and three actual product examples. Brand/category/collection pages derive their links from their visible stocked subset; unavailable destinations and the current landing are omitted. Product examples identify brand and volume. Existing product links back to brand, category and collections remain. Tests cover zero/negative stock, inactive or unpictured products, empty inventory and self-link exclusion. No city or filter landing is created.

Fresh `npm run verify` passed (exit 0); raw HTML link assertions and layout checks passed on ten routes at 390/1280px. Candidate screenshots and results: `task2/candidate/`. The preceding stage's live screenshots are the before baseline. New navigation uses the existing landing typography and wrapping link styles. Deployment pending fresh image checks.

Deployed and live-verified: revision `9b3f9f995a78b4a1ae270b9b9015c94ffbb00546`, image `vozdooh-web:seo-p1-links-20261014`, ID `sha256:d441daee70d3a02d472bd48292f6c8957f0a7a9d7def085ad7b74c2bb8b56d13`. Built-image checks passed; navigation screenshots were visually reviewed at both widths. Live raw HTML/link/layout checks passed all 20 combinations. Health passed, robots unchanged, worker unchanged. Rollback: `/opt/vozdooh/backups/deploy/seo-p1-links-20261014/rollback.sh`.

## Stage 3 — collection structured data

Collections now emit CollectionPage, ItemList and BreadcrumbList using their existing visible stocked product array and stable product URLs. Page references connect the item list and breadcrumb graph. The visible breadcrumb mirrors home → collections → current collection. No review, rating, shipping guarantee or duplicate Offer data is added. Tests check exact product order/URLs, sequential positions, the hierarchy, empty arrays and safe script serialization. Browser checks compare the full visible grid to ItemList and confirm schema in initial HTML.

Schema semantics reviewed on 14 October 2026: [CollectionPage](https://schema.org/CollectionPage), [ItemList](https://schema.org/ItemList), [Google breadcrumb guidance](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb). Local parsing and graph/DOM equality do not establish engine rich-result eligibility or display.

Fresh `npm run verify` passed (exit 0); both priority collection pages passed schema/raw HTML/grid equality and layout checks at 390/1280px. Screenshots: `task3/candidate/`. Existing product, brand and category schema tests passed. Deployment pending image verification.
