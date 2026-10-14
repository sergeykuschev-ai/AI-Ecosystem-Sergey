# VOZDOOH homepage final merchandising polish — 14 October 2026

## Scope

- Homepage popular-fragrances shelf now contains only independently researched and stocked items whose enriched catalog category is `Диффузоры` or `Свечи`. Automotive sachets, refills and related items remain available in the full catalog.
- Four featured brands get unique, concise descriptions derived from documented editorial `brandLandings[].story`, without modifying full brand landing pages.
- Homepage product cards use flex columns with bottom-aligned prices and a consistent view-product CTA; all cards remain real PDP links, not fake buy buttons.
- Mobile hero foregrounds an existing verified product photo (`heroImage`) above the headline, and simplifies the redundant editorial slogan to a short standalone line.
- SEO metadata, structured data, cart, checkout, orders, pricing, inventory, delivery and worker code remain unchanged.

## Verification and release

Run `npm run verify`; test coverage for SKU/formats and the homepage rendering is in `tests/demand-merchandising.test.cjs` and `tests/mobile-home-layout.test.cjs`. Build a new **web-only** Docker tag; smoke-test `/`, `/catalog`, `/cart`, `/checkout`, `/delivery`, `/brands`, `/robots.txt` and `/sitemap.xml` before deploying. Keep the previous image `vozdooh-web:mobile-polish-20261014` for rollback, and never recreate the commerce worker during this update.
