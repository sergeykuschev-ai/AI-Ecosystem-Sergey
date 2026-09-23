# KIMI status — VOZDOOH pre-1C storefront

Date: 2026-09-23 · Branch: `ai/kimi-vozdooh-store`

## Completed work
- Homepage finished in the approved premium direction; mobile responsiveness rebuilt (header wraps with scrollable nav, hero/sections/cards stack at 1000/800/520px breakpoints).
- Catalog with working URL-driven filters (category, scent family, mood, room) over explicit DEMO placeholders only; invalid params are ignored, empty results show a reset state.
- Brands (`/brands`) and collections (`/collections`) routes exist as honest placeholders — no real brands are invented.
- Product page per demo slug: editorial demo attributes, explicit 1C placeholder rows, working add-to-cart, same-family recommendations, 404 for unknown slugs.
- Scent finder (`/finder`): interactive quiz (character, mood, room, format) with live match count and a link into the filtered catalog.
- Persistent cart: localStorage-backed (`vozdooh-cart-v1`) via `useSyncExternalStore`, quantity controls, remove/clear, live header counter. No prices or totals — none exist yet.
- Checkout UI (`/checkout`): contact/delivery form and order summary, but submission is disabled — no order API, no fake payment, no data leaves the browser.
- Clean 1C boundary: `TradeProduct` (SKU, name, brand, category, volume, price, stock, barcode, available characteristics) vs `EditorialProduct` (descriptions, images, scent families, mood, room, recommendations). Demo catalog merged into one module (`src/catalog/demo.ts`); the duplicate `placeholders.ts` was removed.
- robots: every page sets `noindex, nofollow`; `app/robots.ts` disallows all crawling until production data/domain are ready.
- Docs updated: `README.md`, `AGENTS.md`, `src/integrations/README.md` describe the demo state and the 1C boundary.

## Verification
- `npm run verify` (typecheck + lint + build) — passes.
- Production smoke test on a local port: all routes 200; robots.txt returns `Disallow: /`; filters return correct subsets (e.g. `category=diffusers&family=woody&mood=calm` → только «Демонстрационный товар 01»); unknown product slug → 404; product pages show SKU + explicit 1C placeholders; health endpoint OK.

## Requires user input
- 1C exchange credentials/endpoint and the list of characteristics 1C will actually provide (to finalize `TradeProduct.characteristics` usage).
- Payment provider and delivery terms before the checkout submit can be enabled.
- Real domain + decision when to lift `noindex`/robots disallow.
- Editorial content (descriptions, images, approved fragrance vocabulary) to replace demo editorial values.
