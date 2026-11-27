# Exact legacy URL redirects (#310)

Base: `d321cfd97301270b6e374621e76d8df6e93404f5` (`main`, checked 27 November 2026). This candidate is independent of the source changes in #309; the intended release order remains #309, #310, #311. No merge or deployment is authorized by this document.

GET and HEAD for `/kontakty.html` (including its slash variant) return 301 directly to `/contacts`. `/aromaty-dlya-doma/aromaticheskie-svechi`, with or without a final slash, returns 301 directly to `/categories/candles`. Destinations are fixed same-origin paths. Every old query parameter is discarded, and the redirect sets `Referrer-Policy: no-referrer`. No other old product, brand or category path is mapped; non-GET/HEAD requests are not redirected by this policy.

## Routing decision

Next 16.3.8's generated slash-removal 308 precedes user-defined redirects; its `next.config` redirects also preserve incoming query parameters. Therefore a simple redirect entry would add an intermediate hop for the old candle URL and carry its query. The implementation uses the documented `skipTrailingSlashRedirect` option, an explicit slash-removal 308 for other application paths, and three exact Proxy matchers (the existing `/catalog` plus the two old paths). Proxy does not intercept commerce routes. Existing catalog pagination behavior is retained.

References: [Next redirects](https://nextjs.org/docs/app/api-reference/config/next-config-js/redirects), [skipTrailingSlashRedirect](https://nextjs.org/docs/app/api-reference/config/next-config-js/skipTrailingSlashRedirect), and the installed `next/dist/lib/load-custom-routes.js` in 16.3.8. No internal/unsupported Next configuration fields are used. User-defined Next redirects exclude reserved `/_next` asset paths; a noncanonical request such as `/_next/missing/` now returns 404 directly instead of a normalization 308 followed by 404. Canonical generated asset URLs are unchanged. Client links in this app already use canonical slashless paths; HTTP normalization remains explicit.

## Verification

- `npm run verify`: 309 Node application tests, 2 synthetic exchange tests, 9 Python tests, typecheck, lint and isolated production build passed locally (Node 24.18.0, macOS). The first test invocation incorrectly supplied public-indexing environment values; it was corrected to the suite's default private environment. The first build used a cross-worktree dependency symlink rejected by Turbopack; dependencies were installed normally and the final verify passed without changing application configuration for that issue.
- An additional build with public indexing configuration and the same private, read-only catalog snapshot passed. No production secrets or write integrations were configured.
- `VOZDOOH_QA_URL=http://127.0.0.1:34933 node scripts/verify-legacy-redirects.cjs`: 44 actual isolated HTTP checks passed: GET/HEAD, both slash forms, query removal, fixed destination, no loop/intermediate hop, negative legacy paths, final HTTP 200/index/follow/self canonical, catalog pagination, and retained slash normalization on storefront/checkout/cart/payment-callback paths. This script refuses a non-loopback target.
- Sitemap (202 URLs) and YML (108 offers) are byte-identical to the base with the same snapshot and fixed YML date. Prices, inventory, content, images, 1C, checkout, payments and delivery code are unchanged.

After a separately approved release, #282 should record the two old paths' responses and actual crawler visits at day 7, status and referral/click evidence at day 14, and sustained crawl/search evidence at day 28. An HTTP redirect alone does not prove indexing or recovered traffic. No Webmaster mutation or resubmission is part of this candidate.
