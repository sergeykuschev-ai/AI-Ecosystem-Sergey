# SEO commercial collections (issue #304)

The production revision checked on 2026-11-25 is 96c01b0710b318467c9f2e0cd98e268a96b86ed7.
The candidate adds four fixed destinations to the existing collections template:
- /collections/diffusers-250-ml
- /collections/diffusers-500-ml
- /collections/culti-decor
- /collections/culti-stile

Volumes use the confirmed trade volume (ml), and CULTI lines use the brand, diffuser category and explicit line prefix in the original trade name (including accented Decor). No inference from the slug. The public-purchasable rule and image validation are required; duplicate SKUs/slugs are removed. Minimum three distinct purchasable products is a local merchandising rule, not a search-engine requirement. The existing dynamic route, collection index, and sitemap use the same availability function; product detail links to new selections require the destination to exist and contain the product in the validated catalog snapshot. The legacy eleven editorial definitions are retained. No note taxonomy is inferred.

2026-11-25 read-only production-catalog check in the candidate: 143 purchasable products; 22 / 15 / 8 / 8 products in the respective collections. Server-side rendering and metadata checks on that same source passed with indexing disabled; candidate sitemap has 200 unique URLs. Counts may change with stock. Synthetic regression tests cover exact membership and exclusions, duplicate handling, minimum size, metadata, rendering, links and sitemap. The 11-description regression test only re-pins the deliberately changed collections module after confirming the original hash matched the live base.

Do not deploy from a historical release or unverified main. GitHub compare on 2026-11-25 shows live SHA and main diverged (4 commits on each side). Main lacks the four production-side commits in VOZDOOH paths, including sitemap, feed, regional/delivery files and tests. Reconcile branches and verify the resulting source/image before any release. The candidate is not deployed. Production approval, full verify, independent QA and checked rollback are release gates. No changes to payment, checkout, 1C, tunnel, DNS or production edge. Seasonal gifts and note data are separate follow-up work.

Measure after approved release: index coverage for each new URL, impressions, clicks, organic landing visits, purchases, 7/14/28 days and equivalent prior windows. Do not claim demand or ranking improvements until measured. Existing #282 indexing blocker is separate.

## Independent review, 2026-11-25

Codex CLI 0.172.0 via the approved Amursk SSH tunnel to 89.125.19.70 completed a read-only source review of 1025028 with verdict BLOCK. The follow-up changes use the validated whole catalog for commercial destination eligibility, keep relevance by SKU/slug intersection with the page products, and reject Unicode-letter/number/underscore suffixes on Decor/Stile. Regression tests render collection and brand pages with locally insufficient but globally sufficient products. Existing page examples and legacy navigation remain scoped to the page.

The three Yandex feed files in this PR are a reconciliation with the already-running 96c01b0, not a new change to deployed offer filtering. Exact Docker QA on 1025028 found 108 offer XML elements identical to live. The follow-up makes no changes to those feed files or route. Empty-feed handling and Yandex acceptance remain separately tracked under #288; do not claim acceptance. The next head requires repeat checks and review before release.
