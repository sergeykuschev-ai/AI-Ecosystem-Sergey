# KIMI status — VOZDOOH pre-1C storefront

Date: 2026-09-23 · Branch: `ai/kimi-vozdooh-store`

## Completed work
- Homepage finished in the approved premium direction; responsive behavior at 1000/880/800/520px breakpoints (see the redesign entry below).
- Catalog with working URL-driven filters (category, scent family, mood, room) over explicit DEMO placeholders only; invalid params are ignored, empty results show a reset state.
- Brands (`/brands`) and collections (`/collections`) routes exist as honest placeholders — no real brands are invented.
- Product page per demo slug: editorial demo attributes, explicit 1C placeholder rows, working add-to-cart, same-family recommendations, 404 for unknown slugs.
- Scent finder (`/finder`): interactive quiz (character, mood, room, format) with live match count and a link into the filtered catalog.
- Persistent cart: localStorage-backed (`vozdooh-cart-v1`) via `useSyncExternalStore`, quantity controls, remove/clear, live header counter. No prices or totals — none exist yet.
- Checkout UI (`/checkout`): contact/delivery form and order summary, but submission is disabled — no order API, no fake payment, no data leaves the browser.
- Clean 1C boundary: `TradeProduct` (SKU, name, brand, category, volume, price, stock, barcode, available characteristics) vs `EditorialProduct` (descriptions, images, scent families, mood, room, recommendations). Demo catalog merged into one module (`src/catalog/demo.ts`); the duplicate `placeholders.ts` was removed.
- robots: every page sets `noindex, nofollow`; `app/robots.ts` disallows all crawling until production data/domain are ready.
- Docs updated: `README.md`, `AGENTS.md`, `src/integrations/README.md` describe the demo state and the 1C boundary.
- **Visual layer redesigned after owner review (2026-09-23, first direction — superseded by the refinement below).** Header: compact premium mobile bar — restrained menu trigger (two-line icon + Меню/Закрыть label), centered balanced logo with deliberate whitespace, compact cart with count badge; no wrapped five-link nav. Desktop keeps inline nav (11px uppercase, centered). Typography moved off giant Georgia display to a restrained sans scale with hairline rules; Georgia kept only as a small italic accent in the manifesto. Finder page chrome restructured so the header sits on paper and the dark green band holds intro + quiz.

- **Owner direction refinement (2026-09-23, second visual direction).** Header is now a white minimalist bar so the supplied horizontal VOZDOOH logo (white-background webp, unchanged file) sits naturally; mobile dropdown matches white. The homepage opens immediately into a large cinematic warm interior hero — an abstract SVG/CSS atmosphere scene (glowing arched window, console table, unbranded vase with reeds, candle, aroma wisp), explicitly not a VOZDOOH-branded product render; VOZDOOH is the retailer. Hero copy stays concise with one primary CTA (cream button) and a quiet secondary link. Category section moved to a white editorial panel; product tile and cart thumbnails no longer carry the VOZDOOH wordmark (now honest «Фото после 1С» / DEMO placeholders). All routes, filters, cart, quiz, DEMO markers and the 1C boundary unchanged; `public/brand/vozdooh-horizontal.webp` untouched.

## Verification
- `npm run verify` (typecheck + lint + build) — passes.
- Production smoke test on a local port: all routes 200; robots.txt returns `Disallow: /`; filters return correct subsets (e.g. `category=diffusers&family=woody&mood=calm` → только «Демонстрационный товар 01»); unknown product slug → 404; product pages show SKU + explicit 1C placeholders; health endpoint OK.
- Post-redesign smoke (2026-09-23): all routes re-checked on a production build (`/`, catalog with filters, demo product, unknown slug → 404, finder, cart, checkout, brands, collections, robots, health) — all behave as before; rendered HTML contains the new header (menu trigger, nav panel, cart badge) and hero structure.
- Post-refinement smoke (2026-09-23): same route matrix on a production build — all status codes unchanged (`/` 200, filtered catalog 200, demo product 200, unknown slug 404, robots `Disallow: /`, health OK); rendered HTML contains the white header, cinematic hero scene (`heroScene`/`archLight` SVG), editorial white category panel, and the «Фото после 1С» tile placeholders. No headless browser available in this environment, so no screenshot-based check was run.

## Requires user input
- 1C exchange credentials/endpoint and the list of characteristics 1C will actually provide (to finalize `TradeProduct.characteristics` usage).
- Payment provider and delivery terms before the checkout submit can be enabled.
- Real domain + decision when to lift `noindex`/robots disallow.
- Editorial content (descriptions, images, approved fragrance vocabulary) to replace demo editorial values.

## Mobile editorial refinement — 2026-09-23

- Preserved the supplied logo asset and white header; retained the warm hero scene with a refined mobile type scale and viewport sizing.
- Replaced table-like categories with compact two-column mobile material studies; all six category filters remain linked.
- Replaced oversized room rows with five abstract interior tiles, with a wide lead tile on mobile. These are decorative illustrations, not product imagery.
- Made mobile product grids two-up across homepage, catalog and recommendations. Neutral abstract placeholders retain DEMO labels; no products, brands, prices or stock were fabricated.
- Compressed the finder into a six-choice swatch grid, reduced manifesto height, and aligned section spacing and typography. Removed 1C/noindex jargon from homepage and footer; indexing safeguards and integration contracts remain unchanged.
- Browser checks passed at 320, 390, 768 and 1440px: no homepage horizontal overflow, expected discovery/card counts, and mobile products on the same row. Interaction checks passed for menu/Escape, four-part finder filtering, product selection, add-to-cart, quantity changes, reload persistence, removal and disabled checkout. No browser runtime errors.
- Local production route smoke passed for homepage, catalog, filtered catalog, product, finder, cart, checkout, brands, collections, robots and health; unknown product returns 404. Robots still disallows crawling and homepage retains noindex.
- Reusable browser check: `scripts/verify-browser.cjs`. Screenshots are temporary artifacts under `/tmp/vozdooh-home-*.png`, not committed. No public deployment performed.
- Final `npm run verify` passed (typecheck, zero-warning lint, production build). Mobile category/finder/product screenshots were visually inspected. All changed paths are inside `apps/vozdooh-web`; the supplied logo and catalog/cart/checkout/1C implementation files are unchanged.
