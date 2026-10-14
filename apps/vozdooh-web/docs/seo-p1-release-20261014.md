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

The first image command terminated with exit 143 during final unpacking; it was not accepted as a pass. A cached retry completed with exit 0. Built-image and live checks passed both collections at 390/1280px, including full schema/grid equality. Health passed and worker unchanged. Deployed revision `722097139d14980958ede6376c3641bcc2a5b31b`, image `vozdooh-web:seo-p1-collections-20261014`, ID `sha256:3a0d231a58210f73ec3850e3ad3c5170e49465f0c67022b68797a57957c82469`. Rollback: `/opt/vozdooh/backups/deploy/seo-p1-collections-20261014/rollback.sh`.

## Stage 4 — catalog URL policy

| Representation | HTTP / index / canonical policy |
| --- | --- |
| Clean catalog and public brand pages | 200; existing public indexing switch; self canonical |
| Single recognized stocked brand facet | 200; public indexing switch; canonical to the equivalent existing brand landing |
| `q`, including blank search | 200; noindex/follow; normalized search URL canonical |
| Category/editorial/combined facets without a dedicated equivalent | 200; noindex/follow; deterministic facet URL canonical |
| Invalid nonempty filter value | 200 empty result with an actionable reset message; noindex/follow; normalized utility URL canonical; never unfiltered fallback |
| Unknown or tracking params | Listing unchanged; canonical excludes them; underlying page's index policy preserved; browser URL retained for attribution |
| Exact `page=1` | 308 to the same URL without `page`, preserving other params |
| Other or repeated `page` values | Real 404 + X-Robots-Tag noindex/follow; there are no additional pages |
| Enabled internal debug | Existing noindex/follow and clean catalog canonical retained |

The full listing remains crawlable; no pagination links or facet sitemap entries are generated. Distinct filters are not canonicalized to unrelated full inventory. Query order is stable, search whitespace normalized, repeated facet/search values use the same first value as the UI. The new Proxy matches only `/catalog`; product, API and commerce paths are outside its matcher. Existing robots access stays unchanged so crawlers can read utility noindex directives. No claim is made about Google/Yandex's eventual canonical selection. Source review: [Google canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [pagination guidance](https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading), 14 October 2026.

Fresh `npm run verify` passed (exit 0). Proxy unit tests verified 404 headers, preserving 308 and the catalog-only matcher. Initial browser harness assumptions about relative Location and viewport setup were corrected; the earlier screenshots labeled 390 were rejected. Accepted candidate evidence is `task4/candidate-final/`, with real 390/1280 screenshot dimensions checked. The complete policy matrix passed at both widths; the existing interactive and JavaScript-disabled search regressions also passed. Browser script lint passed after the corrections. Baseline live evidence records page 2 HTTP 200 and CULTI facet canonical to full catalog. Deployment pending image checks.

Deployed revision `c8b192204377b52fbebb9b096f622f2f8e40f36c`, image `vozdooh-web:seo-p1-policy-20261014`, ID `sha256:28f38d76adb09aec37f5b1ba250b77198d3b88526ee5cf8818df631ab1afc821`. Build and image-candidate matrix passed. First live browser run stopped with ERR_NETWORK_CHANGED on its first catalog navigation; HTTP remained healthy. The entire live matrix was repeated successfully, with accepted screenshots under `task4/live-retry/`. Independent HTTP checks confirm page 2 is 404 and CULTI facet canonical points to its matching brand page. Health passed, robots byte-identical, worker unchanged. Rollback: `/opt/vozdooh/backups/deploy/seo-p1-policy-20261014/rollback.sh`.

## Stage 5 — useful page roles and receiving copy

Home remains the store introduction; catalog describes full-assortment search and comparison; categories retain format-specific selection guidance; brand descriptions derive formats from their visible stock; home-fragrance describes cross-format selection and gift-diffusers describes gift selection. Brand/category visible description, metadata and schema share the same inventory-backed text. Existing brand history and product fragrance facts are untouched.

Copy now describes online ordering and product payment through Ozon Pay, separate delivery payment, preliminary Ozon quotes, destination-dependent availability and confirmation before dispatch. Pickup is free at Павла Морозова, 97, Хабаровск, after readiness confirmation. Stale request-only and unfinished-integration delivery wording was removed; no legal conclusion, shipping SLA, universal coverage or delivery-price promise is introduced. The useful delivery page gets a self canonical and the existing public indexing switch, and is added to the sitemap. No payment/order/email/worker implementation changes.

The first full suite exposed legacy local-heading and delivery-sitemap expectations; assertions were updated for the approved page roles while transaction exclusions remain. Fresh full verification then passed (exit 0). The first local browser run found the static delivery page's preview localhost canonical from the default build. A separate production-config build (site URL + indexing flag) passed, and its complete ten-template browser matrix passed at 390/1280px: distinct titles/descriptions, self canonicals, public index/follow, honest copy, collection schema and layout. Accepted screenshots: `task5/candidate-final/`; delivery screenshots visually reviewed. Earlier failed runs remain as evidence.
