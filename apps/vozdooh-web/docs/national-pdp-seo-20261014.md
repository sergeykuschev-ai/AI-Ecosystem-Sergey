# National PDP and sitemap SEO — 2026-10-14

## Verified baseline

- The staged-1c repository already filters `(stock ?? 0) > 0` when loading source catalog products. The raw staged JSON has 803 positions, 148 with positive stock, but these totals are not the actual count of indexable pages: image and other quality filters reduce it.
- Previously the sitemap relied on that upstream filter. Public metadata for individual product pages did not explicitly fail closed when stock, price or valid local image disappeared.
- Existing schema.org Product + Offer and BreadcrumbList JSON-LD remains unchanged. No fabricated ratings, reviews, prices, delivery times or freight costs are introduced.

## Changes

- Explicit `isPubliclyPurchasable` gate (active, unexcluded, URL slug, validated picture, stock >= 1, finite positive price) reused in sitemap, product metadata and public PDP rendering.
- Unavailable PDPs are not indexable. Public route returns 404 for sold-out/inactive/unpictured products; stocked pictured products without a price can remain informational but get `noindex` and no purchase button. Debug previews remain explicitly `noindex`. Source data remains unchanged.
- Generic product metadata titles/descriptions address nationwide customers and describe delivery to available Ozon pickup locations. Canonical URL remains unchanged; priority/reviewed fact copy is preserved.
- Visible navigation breadcrumbs match existing JSON-LD breadcrumb paths; PDP purchase block now links to accurate Ozon delivery, separate delivery payment and free Khabarovsk pickup terms.
- `GET /catalog`, payment/order routes and worker are untouched.

## Acceptance

Run `npm run verify` in `apps/vozdooh-web`. Check homepage, sitemap, robots, product page, delivery, cart and checkout on isolated container. Compare public production HTML/meta after deploying web-only release; retain the previous web Docker image for rollback. Search engine indexing and rankings are external outcomes, not guaranteed by successful code deployment.
