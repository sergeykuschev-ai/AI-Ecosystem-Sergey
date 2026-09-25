# VOZDOOH web

Premium home-fragrance storefront with a default demo catalog, a verified 1C CommerceML receiver, and a private staged-real catalog preview. Private staged-1C checkout accepts durable local order requests for manual processing. Public launch, confirmed orders and payment are not connected.

## Local development
1. Copy `.env.example` to `.env.local`.
2. Run `npm ci`.
3. Run `npm run dev -- --hostname 127.0.0.1 --port 3400`.
4. Health endpoint: `/api/health`.
5. Before commit run `npm run verify` (tests + typecheck + lint + build).

## Routes
- `/` — homepage in the approved premium visual direction.
- `/catalog` — selected catalog with working URL-driven filters (category, scent family, mood, room).
- `/catalog/[slug]` — selected product, with separate trade/editorial fields and explicit DEMO or PREVIEW 1C labels.
- `/brands`, `/collections` — placeholder routes; real brands are never invented and appear only after the 1C import.
- `/finder` — scent finder quiz that filters the selected catalog.
- `/cart` — persistent browser cart with current catalog unit prices and a link to request checkout.
- `/checkout` — staged-1C order-request form with goods total and contact/fulfillment preferences; no payment.
- `/api/order-requests` — durable local request submission; no confirmed-order or payment actions.

## Demo and 1C boundary
- Default `CATALOG_PROVIDER=demo` uses explicit DEMO placeholders (`src/catalog/demo.ts`); legacy `stub` remains an alias. `local-1c` selects the synthetic fixture snapshot and is forbidden in production. `staged-1c` selects a validated real-CommerceML snapshot for private preview only. `1c` fails explicitly until live publication is approved.
- 1C trade fields (SKU, name, brand, category, volume, price, stock, barcode, available characteristics) stay inside `TradeProduct` in `src/catalog/contracts.ts` with optional values null when unknown. Demo names/SKUs/categories are explicit placeholders.
- Editorial content (descriptions, images, scent family, mood, room, recommendations) lives in `EditorialProduct` and never comes from 1C.
- The cart stays in the browser until checkout submits a request to `/api/order-requests`; no payment integration exists. See `src/commerce/contracts.ts` and `src/integrations/README.md`.
- The site stays invisible to search engines: every page sets `robots: noindex` and `app/robots.ts` disallows crawling until production data and domain are ready.

## Architecture
- `app/` — Next.js routes, one file per page, thin wiring.
- `components/` — shared UI: header/footer, product card, cart/checkout/finder client components.
- `src/config/` — environment configuration.
- `src/catalog/` — catalog contracts, validated trade importer, atomic local snapshot store, read-only repositories and filter helpers.
- `src/commerce/` — validated order-request service, durable local store, and reserved order/payment adapter contracts.
- `src/cart/` — localStorage cart storage helpers.
- `src/integrations/` — adapter contracts, local import instructions and remaining live-provider decisions.

### Optional responsive browser verification

After `npm run verify`, start the production build locally with
`npm run start -- --hostname 127.0.0.1 --port 3187`.
With Playwright and its Chromium browser available, run:

```sh
node scripts/verify-browser.cjs
```

The standalone CommonJS runner checks 320/390/430/768/1440px layouts, the mobile
menu, finder-to-catalog filtering, cart persistence and disabled checkout.
Set `PLAYWRIGHT_MODULE` to an absolute Playwright module path when using a
temporary external installation; set `VOZDOOH_TEST_URL` for a different local
port. Playwright is optional tooling, not a storefront dependency. Chromium
requires its standard Linux runtime libraries. Screenshots are written to
`/tmp/vozdooh-home-<width>.png` for review.

The homepage presents typographic category and room discovery, an honest
permanent curation statement, and paired editorial panels for brands and collections.
The approved palette uses warm paper (#F4F1EA), near-black ink (#1C1B17),
deep green (#20362A), clean beige (#EBE5D9) and restrained cognac hero lighting.
The header and footer both use the supplied VOZDOOH logo asset.
It contains no demo merchandise or simulated product photography. Explicit DEMO
cards remain on catalog/product routes for verifying filters and cart behavior.
The browser runner checks homepage copy, discovery links, 44px tap targets and
absence of demo cards as well as existing commerce interactions.

## Local synthetic catalog verification

Run from this app directory; no live endpoint or credentials are needed:

```sh
npm run catalog:import -- tests/fixtures/onec-synthetic.json
npm run catalog:import -- tests/fixtures/onec-synthetic.json
CATALOG_PROVIDER=local-1c npm run dev -- --hostname 127.0.0.1 --port 3188
```

The first import into a new snapshot reports `created: 1`; the repeat reports
`unchanged: 1`. The ignored `.local/onec-catalog.json` contains synthetic data only.
Open `/catalog`: exactly one PREVIEW 1C record, price 12.5 RUB, stock 0, no
invented editorial attributes. Demo records are absent. Checkout stays disabled.
Missing/corrupt imports fail explicitly instead of falling back to demo data.
Stop the dev server when finished; use `CATALOG_PROVIDER=demo` for production
build/browser verification. Do not override `NODE_ENV` to run local data in production.

The existing browser runner also verifies the imported fixture on the dev server:

```sh
VOZDOOH_TEST_CATALOG=local-1c VOZDOOH_TEST_URL=http://127.0.0.1:3188 node scripts/verify-browser.cjs
```

Use the same `PLAYWRIGHT_MODULE` override if required. This checks source-specific
product values, null editorial fields, filtering, cart/checkout, missing cart SKUs,
404s, noindex/robots and the unchanged responsive homepage. Import the supplied
fixture into a clean snapshot for this one-record check. All browser screenshots
remain under `/tmp`; no public deployment is needed.

See [integration documentation](src/integrations/README.md) for the exact JSON
contract, upsert semantics, diagnostics, limits, recovery and live 1C prerequisites.

## Private real-1C preview

The standard 1C receiver stages real CommerceML files without publishing them to the storefront. Convert the latest fully staged catalog/offers pair with:

```sh
npm run catalog:stage -- --exchange-root /opt/vozdooh/data/onec-exchange --output /opt/vozdooh/data/catalog-staged.json --report /opt/vozdooh/data/catalog-staging-report.json
```

Run the closed preview with `CATALOG_PROVIDER=staged-1c`, `ONEC_LOCAL_CATALOG_PATH` pointing at that snapshot, and `ONEC_STAGED_PREVIEW_ENABLED=true`. The converter suppresses prices unless explicitly approved for publication. The current preview snapshot already contains the confirmed Habarovsk VOZDOOH retail prices: preserve it and its environment; do not rerun this command over it without the approved price options. Only positive-stock rows are visible. Checkout accepts requests with valid current prices and stock. The full snapshot retains zero-stock rows.

### Editorial catalog presentation

`/catalog` presents products with existing local raster images; missing/empty files
are excluded from the customer grid without changing repository records. Demo
mode remains explicitly labeled. `?debugCatalog=1` includes products without
images and shows internal source labels and stock diagnostics. This query is a
presentation switch, not authentication; existing private-preview access controls
and noindex remain required. Filter submissions, chips and product links preserve
the explicit debug mode.

Display titles are derived only in `src/catalog/presentation.ts`: known brand,
format and volume tokens are separated, bilingual labels use the first named
part, and the full unmodified trade name stays in expandable product details.
Unknown names fall back to their original text. No scent facts are generated.
The curator introduction selects up to four distinct brands with an image,
description and at least one scent/mood/room field, in the approved brand order.
All pictured products remain in the full collection and all brands remain in
filters. No popularity, novelty or rating claims are inferred.

The native filter disclosure and GET form require no UI dependency and retain
brand/category/family/mood/room URL parameters. The staged preview now uses the confirmed retail prices and an add-to-cart action on eligible product details. Editorial work never changes those trade values. Presentation
regressions run with `npm test`; full checks run with `npm run verify`.

### Confirmed bilingual product names

`src/catalog/productTranslations.ts` owns the presentation-only translation registry.
The original fragrance title remains primary, followed by a smaller Russian line
and the existing type/volume subtitle. Shared cards and product details use the same
presentation result. Trade data and brand labels are unchanged.

The first batch uses six starter translations approved in the storefront brief
(2026-09-24), checked against 18 exact SKU/name bindings in the staged catalog:
ORO → Золото; LOVE → Любовь; DOLCE VANIGLIA → Сладкая ваниль;
FOGLIE DI FICO → Листья инжира; VENTO DI MARE → Морской ветер;
ROSE OUD → Роза и уд. Both SKU and complete source name must match, within TEATRO.
Unknown or changed bindings receive no translation. Slash-separated source text
is not automatically accepted as verified translation.

Unresolved: BIANCO DIVINO, ERA, THÉ, MAREMINERALE and all names outside this registry.
Further research priority: TEATRO, Lothantique, CULTI MILANO, Millefiori Milano,
Christian Tortu, Castelbel, VINOVE, AROMAgroup, DANHERA, MAMI MILANO, Vellutier,
Ladenac Milano, WoodWick. This order does not change storefront sorting.
Before extending the registry, record official brand/distributor evidence and review
exact current bindings. For Lothantique, consult Небо Фрагранс first, then official
Lothantique. Do not infer translations from scent descriptions or translate brands.

`npm test` covers approved bindings, mismatches, unresolved names, source immutability,
display-title regressions and actual card/detail markup.

### Demand-priority merchandising (internal signal)

`src/catalog/demandPriority.ts` is a small checked-in mapping derived from the verified
research in `research/demand-priority-2026-09.md` (external sources verified live on
2026-09-24). It is an INTERNAL signal only:

- Default `/catalog` ordering leads with the 25 researched higher-priority in-stock SKUs
  in research `promotion_rank` order, then keeps the approved brand order with a
  deterministic slug tiebreak. Brand/category/family/mood/room filters and search
  semantics are unchanged; demo records carry no ranks and keep previous behavior.
- The 650KB research JSON is never imported into the client bundle; tests cross-check the
  mapping against the research file (exact TOP-25 coverage, unchanged ranks).
- The three CULTI Thé SKUs (`46091`, `465636`, `802e8b01-…`) receive NO priority or
  popularity treatment: the preliminary Bloomingdale's "bestseller" signal failed
  re-verification and was refuted.
- The only visible popularity cue is a conservative `Популярный аромат` badge (with a
  clarifying note on the product page) for the four CORE fragrances whose popularity is
  confirmed at fragrance level by two independent external bestseller statements. It never
  claims VOZDOOH sales. Internal tier names (CORE/STRONG/NORMAL/SLOW/CLEARANCE) are never
  rendered to customers.
- Merchandising does not change `trade.price`; the staged snapshot owns the confirmed retail prices.

Post-implementation catalog findings live in
`research/catalog-quality-after-merchandising.md` (unresolved problems only; uncertain
facts were left unchanged, not "fixed").

## Order-request stage (implemented)

`POST /api/order-requests` accepts requests only with `CATALOG_PROVIDER=staged-1c`.
Checkout collects name, phone, pickup/courier preference, a courier address when
needed, optional comment and explicit consent. The server rereads the selected
staged snapshot without the storefront cache and validates SKU, positive stock,
whole-unit quantity (1–999), and the price shown to the customer. Changed prices
or insufficient stock require correction; no silent substitutions occur.

Requests are stored outside public assets in ignored `.local/order-requests/`
relative to the app working directory. Receipt includes a generated ID, UTC time
and RUB goods total. No payment takes place, no stock is reserved, no confirmed
order is created in 1C, and no delivery or notification service is called. Manual
operator review is required. Delivery availability and charges are not confirmed
or included in the goods total. The private preview and noindex/robots restrictions
remain in place.

See [request contract and operating guide](src/integrations/order-requests.md)
for retries, storage, manual processing and recovery. Tests use synthetic contacts
only; never commit request records or print customer data into logs.

## Reliability and isolated verification

See [private preview reliability](RELIABILITY.md) for strict staged-converter
validation, audit/retry recovery, checkout receipt checks and the outstanding
frozen-research hash discrepancy. To validate without replacing a running
preview's build artifacts, run `VOZDOOH_ISOLATED_BUILD=true npm run verify`.
This uses `.next-verify` and still runs the full tests, typecheck, lint and build.
