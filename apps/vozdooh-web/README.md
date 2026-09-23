# VOZDOOH web

Premium home-fragrance storefront in a verified pre-1C demo state.

## Local development
1. Copy `.env.example` to `.env.local`.
2. Run `npm ci`.
3. Run `npm run dev -- -p 3400`.
4. Health endpoint: `/api/health`.
5. Before commit run `npm run verify` (typecheck + lint + build).

## Routes
- `/` — homepage in the approved premium visual direction.
- `/catalog` — demo catalog with working URL-driven filters (category, scent family, mood, room).
- `/catalog/[slug]` — demo product card with editorial demo attributes and explicit 1C placeholders.
- `/brands`, `/collections` — placeholder routes; real brands are never invented and appear only after the 1C import.
- `/finder` — scent finder quiz that filters the demo catalog.
- `/cart` — persistent cart (localStorage), no prices or totals.
- `/checkout` — checkout UI only; order submission and payment are disabled on purpose.

## Demo and 1C boundary
- The catalog contains only explicit DEMO placeholders (`src/catalog/demo.ts`). No real products, prices, stock, notes or fragrance claims are invented.
- 1C trade fields (SKU, name, brand, category, volume, price, stock, barcode, available characteristics) stay inside `TradeProduct` in `src/catalog/contracts.ts` and are null until the exchange exists.
- Editorial content (descriptions, images, scent family, mood, room, recommendations) lives in `EditorialProduct` and never comes from 1C.
- The cart is local-only; there is no order API and no payment integration. See `src/commerce/contracts.ts` and `src/integrations/README.md`.
- The site stays invisible to search engines: every page sets `robots: noindex` and `app/robots.ts` disallows crawling until production data and domain are ready.

## Architecture
- `app/` — Next.js routes, one file per page, thin wiring.
- `components/` — shared UI: header/footer, product card, cart/checkout/finder client components.
- `src/config/` — environment configuration.
- `src/catalog/` — catalog contracts, demo placeholders, filter helpers.
- `src/commerce/` — order/payment contracts (reserved, no demo implementation).
- `src/cart/` — localStorage cart storage helpers.
- `src/integrations/` — adapter boundary documentation for future providers.
