# VOZDOOH — publication readiness

Date: 2026-09-28 · Branch: `ai/kimi-vozdooh-store` · App: `apps/vozdooh-web`

This report records what was verified for the VOZDOOH storefront private preview
(`https://vozdooh27.ru`, staged-1C catalog, Basic Auth + noindex retained) and which
items still require the owner. Nothing here activates public indexing, payments or
infrastructure changes.

## Catalog accounting (re-audited 2026-09-28)

| Metric | Count |
| --- | --- |
| Positive-stock rows in staged 1C snapshot | 148 |
| Visible storefront products (verified image + editorial + price + stock) | 144 |
| Hidden, customer-eligible, NO EXACT IMAGE | 3 |
| Excluded legacy, LEGACY-NOT-FOR-VOZDOOH | 1 |

Hidden: `121211` (rattan reeds 500 ml), `045850b2-9e1f-11ee-b408-d069cd63062f` (AROMAgroup
Салями cartridge 100 ml), `0189` (wick scissors). Each was re-verified 2026-09-28 by
barcode → article → brand → catalog → distributor → retailer searches; no exact
identity/photo binding is provable, so they stay hidden per policy.
Excluded: `445445` (microUSB charger, non-fragrance legacy) via `storefrontExcludedSkus`.
Statuses kept: VERIFIED / CONFLICT / NO EXACT IMAGE / LEGACY-NOT-FOR-VOZDOOH in
`research/catalog-cleanup-evidence-2026-09.md`.

## Readiness table

| Area | Status | Verified | Blocker |
| --- | --- | --- | --- |
| Homepage | READY | Approved hero + ShaderGradient preserved; shader deferred to idle; 6 category + 5 room links 200; no overflow 320–1440 | — |
| Catalog | READY | 144 pictured products; URL-driven filters, chips, reset, back/forward, empty state; filter values limited to catalog data; no internal tier labels in HTML | — |
| Products | READY | All 144 PDPs audited: image, brand, title, Russian display title where confirmed, volume, exact 1C price, stock state, CTA, description, character/mood/room, collection links, brand story, related items; accessories use «О товаре / Детали продукта» | — |
| Images | READY | 144 curated local assets byte-verified on disk; no borrowed lookalike images; no broken images in browser QA | 3 hidden SKUs await exact source photos (owner may supply) |
| Brands | READY | All 13 brand pages: source-backed story, facts, DNA block, products; no invented legends | — |
| Collections | READY | 7 collections built only from positive-stock pictured products with verified family/mood/room; no seasonal/professional mixing | — |
| Cart | READY | Add/remove/quantity/persistence (localStorage), images, names, prices, totals; invalid quantity and stale-stock checkout blocked; no mobile overflow | — |
| Checkout | READY | product → cart → checkout → confirmation E2E with synthetic data; name/phone validation, pickup/courier address conditionality, optional comment, consent gate, clear errors, idempotent retry, server-side price/stock recheck | — |
| Delivery | NEEDS OWNER DATA | Page created; only real behavior described (pickup + courier request modes; courier cost negotiated separately) | Cities/zones, pickup address, cost, timing, operational rules |
| Payment | NEEDS OWNER DATA | Page created; states online payment is not conducted; no card claims | Available payment methods, payment terms, receipts |
| Returns | NEEDS OWNER DATA | Page created with careful statutory structure and honest process | Return address, refund method/timeframes, return shipping cost, courier-return terms |
| Contacts | NEEDS OWNER DATA | Page created; shows repository-verified owner email and domain | Phone, physical address, seller requisites; owner should confirm the public contact email |
| Privacy | NEEDS OWNER DATA | Page created: collected data, purposes, storage, no-PII-to-analytics, user rights; consent is single, required, not pre-checked; ordering needs no marketing consent | Operator legal identity/address, storage retention periods |
| Offer | NEEDS OWNER DATA | Structure prepared with all clause blocks | Legal entity, INN, OGRN, addresses, bank details, final terms |
| Analytics | NEEDS OWNER DATA | Event hooks implemented (view_item, select_item, add_to_cart, remove_from_cart, view_cart, begin_checkout, submit_order, view_brand, view_collection, filter_use); no PII attached | Yandex Metrica counter ID (`NEXT_PUBLIC_YANDEX_METRICA_ID`) |
| SEO | READY | Unique titles/descriptions/canonicals; OG defaults + title template; sitemap (187 URLs) runtime-dynamic; robots keeps Disallow:/ with sitemap wired for cut-over; noindex everywhere | Decision when to lift noindex (owner) |
| Structured data | READY | Product JSON-LD only from real SKU/brand/RUB price/stock/verified image + BreadcrumbList; no ratings/reviews/old prices | — |
| Mobile | READY | 320/390/430/768/1440 audited; no horizontal overflow; 44px tap targets; mobile nav/footer/forms verified | — |
| Performance | READY | Shader chunk (1.2 MB) deferred past loadEventEnd; system font stack; next/image sizing; no CLS observed | — |
| Accessibility | READY | One H1, form labels, alt coverage (decorative empty-alt), keyboard order + focus indicator, landmarks/aria, ≥4.5:1 contrast, alert-associated errors | — |
| Security | READY | No secrets in client bundle; order endpoint enforces same-origin, content-type, body cap, strict field validation, server price/stock recheck, idempotency; generic error page; security headers set | Order-endpoint rate limiting recommended before high-traffic launch (not required while private) |
| Tests | READY | npm test 57 app + 2 receiver PASS; typecheck, zero-warning lint, isolated production build, git diff --check PASS; 100+ browser assertions across 3 QA suites | — |

## Owner blockers (must be supplied before public launch)

1. Seller identity: legal entity/IP name, INN, OGRN, legal + physical address, bank details
   (blocks /offer, /contacts, /returns specifics, /privacy operator block).
2. Public contact data: phone, pickup address, and confirmation of the public email.
3. Delivery terms: cities/zones, pickup point, courier availability, cost, timing, rules.
4. Payment methods and payment terms; receipt issuance.
5. Returns specifics: return address, refund method and timeframe, return-shipping responsibility.
6. Privacy operator details and data-retention periods.
7. Yandex Metrica counter ID to enable analytics.
8. Exact photos for the 3 hidden SKUs (optional; otherwise they stay hidden).
9. Decision on when to remove Basic Auth and lift noindex/robots disallow (site stays private until then).
10. Optional: rate limiting for the order-request endpoint before high-traffic public operation.
