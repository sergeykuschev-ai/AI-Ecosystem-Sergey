# VOZDOOH web

Premium home-fragrance storefront with a default demo catalog and an isolated local synthetic 1C adapter. Live 1C and checkout are not connected.

## Local development
1. Copy `.env.example` to `.env.local`.
2. Run `npm ci`.
3. Run `npm run dev -- --hostname 127.0.0.1 --port 3400`.
4. Health endpoint: `/api/health`.
5. Before commit run `npm run verify` (tests + typecheck + lint + build).

## Routes
- `/` — homepage in the approved premium visual direction.
- `/catalog` — selected catalog with working URL-driven filters (category, scent family, mood, room).
- `/catalog/[slug]` — selected product, with separate trade/editorial fields and explicit demo or internal-test labels.
- `/brands`, `/collections` — placeholder routes; real brands are never invented and appear only after the 1C import.
- `/finder` — scent finder quiz that filters the selected catalog.
- `/cart` — persistent cart (localStorage); imported unit prices can be shown, totals/order creation remain disabled.
- `/checkout` — checkout UI only; order submission and payment are disabled on purpose.

## Demo and 1C boundary
- Default `CATALOG_PROVIDER=demo` uses explicit DEMO placeholders (`src/catalog/demo.ts`); legacy `stub` remains an alias. `local-1c` selects only the imported synthetic snapshot and is forbidden in production. `1c` fails explicitly until a live adapter exists.
- 1C trade fields (SKU, name, brand, category, volume, price, stock, barcode, available characteristics) stay inside `TradeProduct` in `src/catalog/contracts.ts` with optional values null when unknown. Demo names/SKUs/categories are explicit placeholders.
- Editorial content (descriptions, images, scent family, mood, room, recommendations) lives in `EditorialProduct` and never comes from 1C.
- The cart is local-only; there is no order API and no payment integration. See `src/commerce/contracts.ts` and `src/integrations/README.md`.
- The site stays invisible to search engines: every page sets `robots: noindex` and `app/robots.ts` disallows crawling until production data and domain are ready.

## Architecture
- `app/` — Next.js routes, one file per page, thin wiring.
- `components/` — shared UI: header/footer, product card, cart/checkout/finder client components.
- `src/config/` — environment configuration.
- `src/catalog/` — catalog contracts, validated trade importer, atomic local snapshot store, read-only repositories and filter helpers.
- `src/commerce/` — order/payment contracts (reserved, no demo implementation).
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
Open `/catalog`: exactly one INTERNAL TEST record, price 12.5 RUB, stock 0, no
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
