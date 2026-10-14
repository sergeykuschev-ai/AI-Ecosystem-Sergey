# National homepage repositioning — 14 October 2026

The owner authorized national positioning while retaining useful Khabarovsk content. Work began only after both `cart-clear-paid-20261014` (`8ae799c9`) and `search-button-visible-20261014` (`aebb82ec`) completed their commits, deployment and live verification. The clean baseline production image was `vozdooh-web:search-button-visible-20261014`, ID `sha256:e4d1c50cd8061a7ab94258d754539d52def8d06d48a2325c52b4534e923f07ef`.

## Content decisions and evidence

Read-only inspection of the staged production inventory and existing presentation returned 144 storefront products, including diffusers and candles, CULTI MILANO, Lothantique and other brands. Existing curator selection returned CULTI Decor Classic Aramara 250 ml, SKU `802e8ae5-d19b-11ec-be83-7c8bca00854e`. Its image, product link, selection logic and hero scene are preserved.

The hero uses the approved heading, VOZDOOH eyebrow and catalog CTA. Specific stocked brand names replace the proposed blanket European-origin statement. No supplier invoices, authorization documents or authentication evidence were available to this change, so no originality, official-dealer or provenance guarantee was introduced. The first benefit presents product identity and brand collections instead. Ozon delivery is qualified by available destination and tariff; the absolute “all Russia” promise was not used.

The new `/khabarovsk` page addresses an actual local task: free collection at Павла Морозова, 97, readiness confirmation and agreed time, courier alternative and contact details. It has a distinct title/description, self-canonical, the existing public indexing policy, sitemap entry and links from the homepage and footer. Organization address and existing national service area remain intact. Homepage OpenGraph and WebSite description reflect national positioning. Existing robots controls and sitemap routes are preserved; no search-engine submission is performed.

The delivery information page had stale claims that pickup address was unpublished and automatic estimation was not available. Those statements now match the existing checkout, without changing its logic or payment behavior.

## Shipping verification and limits

Through the existing German SOCKS tunnel (`socks5://127.0.0.1:1081`), the live read-only pickup search returned 30 results each for Moscow, Saint Petersburg and Kazan. Kaliningrad returned zero. The current implementation caps upstream discovery at 5,000 points and each filtered response at 30; these samples cannot establish complete geographic coverage. A zero result does not prove Ozon never serves that city, but checkout availability for it is unconfirmed.

Read-only `quoteOzonPickupDelivery` was called in the existing worker environment using an in-memory synthetic request, synthetic phone, 11,200 RUB declared value, and a synthetic 1 kg / 200×150×150 mm parcel. It called only Ozon checkout estimation with mutations disabled. No request was saved, no shipment/payment was created and no email was queued. Responses for the first returned point in each city:

| Destination | Delivery plus insurance | Estimate |
| --- | --- | --- |
| Moscow | 298 RUB | 15 days |
| Saint Petersburg | 312 RUB | 15 days |
| Kazan | 292 RUB | 13 days |

These are dated diagnostic estimates, not storefront rates or commitments for a real basket. Parcel data may be provisional. Delivery is separate from Ozon Pay product payment; final tariff and delivery payment are agreed before dispatch. No real customer records were read for the test.

## Repeatable verification and release

Run `NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost npm run verify`. Browser environment uses the existing Playwright module and Chromium paths in `/tmp/vozdooh-header-browser-env.sh`.

Opt-in checks: `scripts/verify-federal-homepage-browser.cjs`, `scripts/verify-catalog-search-browser.cjs`, `scripts/verify-pickup-browser.cjs`, and `scripts/verify-paid-cart-browser.cjs`. Set `VOZDOOH_QA_URL`, optional `VOZDOOH_QA_PROXY`, `VOZDOOH_QA_SKU`, `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH`. Checkout tests intercept writes. `VOZDOOH_QA_SHIPPING_CITY` selects a synthetic nonlocal destination; `VOZDOOH_QA_QUOTE_RUB` enables a synthetic successful estimate, otherwise the unavailable-estimate path is tested. Mock rates verify UI contracts and do not establish carrier prices.

Deployment replaces only web through `/opt/vozdooh/runtime/compose.yml`. Backup/rollback location: `/opt/vozdooh/backups/deploy/federal-homepage-20261014/rollback.sh`. Preserve the current worker and persisted orders. After launch verify health, national and local HTML/metadata, robots equality, previous sitemap URL retention, hero screenshots at 390/1280 px, catalog search and mocked checkout/payment regression through the German tunnel. SEO eligibility and rendering do not establish indexation, rankings or traffic gains; review first-party search data after recrawling.

## Resumed release validation

The interrupted draft was resumed after confirming the two prerequisite releases and unchanged production baseline. Fresh inventory inspection confirmed 144 storefront products, including 23 CULTI MILANO and 7 Lothantique products. Fresh read-only Ozon search and synthetic quotes reproduced the city availability and estimates above. `npm run verify` passed in the resumed environment on 14 October 2026. The release image is `vozdooh-web:federal-homepage-20261014`; its revision label records the release commit. Browser regression results and production verification are retained in `/tmp/vozdooh-federal-release-*.log`.
