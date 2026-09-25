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

## Owner-approved art-direction pass 2 — 2026-09-23

This entry supersedes the homepage material studies, repeated room scenes and
homepage demo cards described in the earlier refinement.

- Kept the white header, supplied logo asset and warm cinematic hero unchanged.
- Replaced geometric category placeholders with a restrained typographic index;
  all six category filter destinations remain intact.
- Replaced repeated room illustrations with an editorial lead room and compact
  discovery rows, preserving all five room filter destinations.
- Removed demo products and development-status language from the homepage.
  The curated section now honestly says the first selection is being prepared;
  no products, brands, prices, stock or fragrance claims were invented.
- Added context to the brands/collections bridge and tightened the manifesto
  and footer. Footer navigation has a minimum 44px target height.
- Catalog demos remain explicitly labeled on their existing routes. Cart,
  finder, checkout, indexing safeguards and the 1C boundary are unchanged.
- Updated README and browser regression checks for the pre-catalog homepage.
- `npm run verify` passed: TypeScript, zero-warning ESLint and production build.
  An initial overlapping build lock was resolved by running verification serially.
- Chromium checks passed at 320, 390, 430, 768 and 1440px: no horizontal overflow,
  six category/five room links returning 200, no homepage demo cards or technical
  copy, and minimum 44px discovery/footer targets. Visually inspected full-page
  screenshots at 390 and 430px, stored temporarily under `/tmp`.
- Menu/Escape, finder filters, product selection, cart quantity/persistence/removal
  and disabled checkout passed with no browser runtime errors. Fixed an assertion
  to account for uppercase CSS rendering of the selection status.
- All changes are inside `apps/vozdooh-web`. No public deployment performed.

## Final owner-approved color polish — 2026-09-23

This entry supersedes the selection-in-preparation copy described above.

- Preserved the approved header, hero composition, category grid and room discovery.
- Kept paper #F4F1EA and ink #1C1B17; refined green to #20362A and editorial beige
  to #EBE5D9. Graded existing hero lighting toward restrained cognac/amber brown.
- Replaced homepage prelaunch wording with a permanent curation philosophy.
  Brands/collections now use paired editorial panels with numbered captions,
  serif titles and existing destinations; no merchandise or claims were invented.
- Footer uses the unchanged supplied horizontal logo asset with a 44px home link.
- Darkened muted text to #656156: 4.93:1 against beige. Checked editorial body
  text (5.15:1), finder secondary text (7.15:1), ink controls (13.74:1) and green
  titles (10.32:1) on their solid backgrounds. This is a targeted contrast check,
  not a claim of a complete accessibility audit.
- Updated README and browser checks for permanent copy and the loaded footer logo.
  The logo check scrolls into view before decoding the lazy-loaded image.
- Verification: `npm run verify` passed (TypeScript, zero-warning lint, production
  build). Chromium layout checks passed at 320, 390, 430, 768 and 1440px; menu,
  finder, product, cart quantity/persistence/removal and disabled checkout passed
  without browser runtime errors. Visually reviewed 390px and 430px screenshots
  for color balance, spacing, readable text and footer logo rendering.
- All changed paths are inside `apps/vozdooh-web`; routes, commerce behavior,
  indexing safeguards and the 1C boundary are preserved. No public deployment.

## Final hero-light micro-polish — 2026-09-23

- Increased only the existing central amber CSS glow opacity from .42 to .48
  for a subtle midtone lift; retained its RGB color, SVG composition, geometry,
  copy, CTA placement and strong bottom vignette.
- `npm run verify` passed in this app (typecheck, zero-warning lint, build).
- Existing Chromium checks passed at 320, 390, 430, 768 and 1440px, including
  menu, finder, product, cart persistence/removal and disabled checkout checks;
  no browser runtime errors.
- Visually inspected 390px and 430px mobile screenshots and compared the original
  glow: restrained cognac/amber lighting, legible hero text and the unchanged
  transition into the white catalog section. Screenshots remain under `/tmp`.
- Only this app's hero CSS and status note changed. No public deployment.

## Final hero light micro-polish — 2026-09-23

- Increased only the existing central cognac/amber hero glow opacity from 0.42 to 0.48 (about 14% relative, a subtle perceived 5–10% lift).
- Hero composition, copy, logo, bottom vignette and all other sections remain unchanged.
- `npm run verify` passed. Chromium checks passed at 320, 390, 430, 768 and 1440px, including menu, finder, product, cart and disabled checkout flows.
- Mobile hero screenshots were generated at 390px and 430px for before/after comparison. No public deployment.

## 1C catalog integration foundation — 2026-09-23

- Added a catalog source boundary with explicit `demo`, development/test-only `local-1c`, and intentionally unconfigured live `1c` modes. There is no silent fallback from a selected 1C source to demo data.
- Added strict versioned 1C trade-record normalization for SKU, name, brand, category, volume, price, stock, barcode and available characteristics. Editorial descriptions, images, scent family, mood, room, recommendations and SEO remain separate and cannot enter through the trade importer.
- Added idempotent SKU upsert, duplicate rejection, preservation of explicit zero/fractional price and stock, atomic local snapshot publication, writer locking, size/product limits and structured diagnostics without raw payload values.
- Added an internal synthetic fixture and CLI import path. Re-importing the same fixture reports unchanged data rather than duplicates; malformed batches preserve the previous snapshot.
- Catalog, product routes, finder, cart and checkout now consume the selected catalog through the repository boundary. Missing editorial data remains null/empty; missing cart SKUs stay visible and removable. Checkout remains disabled.
- Added 14 integration/unit tests covering validation, boundaries, idempotency, duplicates, stock=0, price updates, editorial separation, source guards, atomic persistence, CLI behavior, filters and snapshot limits.
- `npm run verify` passes: all 14 tests, TypeScript, zero-warning ESLint and production build. The earlier Turbopack dynamic-filesystem tracing warning was removed with a development-only tracing exclusion.
- Chromium verification passes in both default demo mode and `local-1c` synthetic mode at 320/390/430/768/1440px, including menu, finder, product, cart persistence/removal and disabled checkout.
- Live 1C still requires the real transport/schema, endpoint/authentication method, actual characteristic names, currency/stock units, category mapping, delta/deletion policy and operational retry/audit requirements. No credentials or production endpoint were invented or committed.
- All changes are inside `apps/vozdooh-web`. AmurskMarket was not modified. No public deployment. `noindex` and robots disallow remain in place.

## Live 1C exchange receiver — 2026-09-23

- Added an isolated VOZDOOH CommerceML receiver for the standard 1C website catalog exchange.
- Supported catalog modes: `checkauth`, `init`, chunked `file`, and `import`; order exchange remains disabled.
- Receiver uses dedicated VOZDOOH credentials, signed session cookies, upload size limits and path traversal protection.
- Real 1C files are staged only. They are not published to the storefront until the first actual export is inspected and mapped to the normalized catalog importer.
- Receiver tests pass and are included in `npm test`; the full `npm run verify` suite passes.
- Runtime is isolated in Docker on localhost port 3421 with `restart: unless-stopped`.
- Exchange now uses the existing HTTPS reverse proxy at `/api/vozdooh-1c/exchange`; the temporary Tailscale 8446/Funnel exposure is disabled.
- Credentials live only in `/opt/vozdooh/secrets/onec-exchange.env` (mode 600), outside Git.

## Real CommerceML staging preview — 2026-09-23

- First real 1C CommerceML 2.07 export received and staged successfully: 803 catalog rows and 803 offers.
- Added a converter that joins import/offers by 1C ID, reads stock only from the selected VOZDOOH warehouse, suppresses prices by default, cleans control characters and falls back to stable 1C IDs when articles are unsafe or duplicated.
- Staging report: 148 positive-stock products, 2 negative stock values clamped to zero, 793 rows with a nonzero selected price present but not published, 138 SKU fallbacks.
- `staged-1c` is a private preview source. The preview exposes only positive-stock products while the full snapshot retains all 803 rows for future stock transitions.
- Product/editorial content stays separate: no 1C descriptions or fragrance claims are published. Checkout and price publication remain disabled.
- Production-mode staged preview is fail-closed unless explicitly enabled and remains noindex.
- Chromium verification passed at 320/390/430/768/1440px plus finder, product, cart persistence/removal and disabled checkout.
- Private preview is served only inside Tailscale on port 8447.

## Demand-priority merchandising + catalog quality pass — 2026-09-24

### Implemented (all inside apps/vozdooh-web)
- `src/catalog/demandPriority.ts`: small checked-in INTERNAL merchandising mapping from
  `research/demand-priority-2026-09` — exactly the researched TOP-25 SKU ranks (1–25) plus a
  conservative externally-confirmed popularity set limited to the 4 CORE fragrances
  (Aramara ×3 formats, Tessuto). The three CULTI Thé SKUs (`46091`, `465636`,
  `802e8b01-…`) carry NO rank and NO popularity treatment — the preliminary Bloomingdale's
  "bestseller" signal failed re-verification on 2026-09-24 and is refuted. Tier names are
  never rendered to customers; the 650KB research JSON is not bundled.
- `storefrontProducts` default ordering: researched higher-priority in-stock products first
  in research order, then approved brand order with a deterministic slug tiebreak. Filters,
  brand/category semantics and demo behavior unchanged.
- Conservative popularity cue: `Популярный аромат` card badge + product-page note
  «Популярность аромата подтверждена внешними источниками; это не рейтинг продаж VOZDOOH.»
  Only for the 4 externally confirmed CORE fragrances.
- 14 CORE/STRONG cards: 4 descriptions improved strictly per confirmed card_preparation
  facts (Tessuto notes + official 3-month duration + floral family; Mareminerale auto-sachet
  7×7 см format; Dolce Vaniglia 250/500 enriched with the confirmed six notes); Tessuto →
  «Ткань» translation binding added (Candlesbox-confirmed); same-fragrance recommendation
  links for Aramara/Aqqua/Dolce Vaniglia formats; NIRO category corrected to «Диффузоры»
  (external Bosco/TSUM cards confirm the type). 7 of 14 cards were already sufficient and
  keep their verified copy (all 3 Aqqua, both Aramara Decor, Les Secrets d'Antoine, Bianco
  Divino, Dolce Vaniglia refill, NIRO copy). All 14 images verified byte-identical to the
  research `best_existing_image`; no imagery changed. `trade.name`/`trade.price` untouched;
  staged prices stay null; no numeric prices introduced.
- Tests: new `tests/merchandising.test.cjs` (7 tests) — mapping covers exactly the TOP-25
  with unchanged ranks; Thé SKUs excluded from rank and popularity; popularity cue limited
  to the 4 eligible SKUs; deterministic, price-blind priority ordering; price never
  rendered; rendered catalog/page leaks no internal labels and shows priority order.
- Audit: `research/catalog-quality-after-merchandising.md` — unresolved problems only
  (12 without exact image, 5 unknown brand, 27 AROMAgroup template descriptions, identity
  conflicts/mismatches, format/volume inconsistencies, 0 CORE/STRONG cards blocked).

### Validation (all PASS, run 2026-09-24 in this environment)
- `node research/validate-demand-2026-09.cjs` — 148 SKU / 220 units, TOP-25, high-stock consistent.
- `npm run typecheck` PASS · `npm test` 31/31 PASS (29 app + 2 exchange integration) ·
  `npm run lint` zero warnings · `npm run build` PASS (`.next` rotated aside first: previous
  build output was root-owned and blocked the build as kimiworker) · `git diff --check` PASS.
- Preview evidence: new production build served with the documented staged mechanism on a
  temporary loopback port (3413) because 3411 is held by a root-owned process (see blocker
  B2). Verified: `/catalog` and `/brands` 200; all 14 CORE/STRONG product pages 200; all 14
  CORE/STRONG images 200; rendered grid first-25 == research TOP-25 order; popularity badge
  only on the 4 CORE cards; Thé product pages carry no cue; brand/category filters and debug
  view intact; homepage untouched; no internal tier labels; no prices rendered.

### BLOCKERS (permissions; no workaround attempted per policy)
- B1 — git commit/push: `git add` fails with «insufficient permission for adding an object
  to repository database /var/lib/kimi-worker/repo/.git/objects». The shared object store
  has mixed root/kimiworker ownership; the fanout directories needed by the new blobs are
  root-owned (`drwxr-xr-x root`). User kimiworker has no sudo. All changes are validated and
  left uncommitted in the worktree; the index is clean (failed add was atomic). A maintainer
  with write access to the object store (or a re-owned objects dir) can commit the exact
  file list from the final report. Per task policy no object-store workarounds were attempted.
- B2 — staged preview restart on 127.0.0.1:3411: the existing preview (next-server PID
  2409879, started as root) cannot be signalled (kill → EPERM as kimiworker) and the port
  stays bound, so the new build cannot take over 3411. The old build keeps serving 3411
  unchanged. A maintainer can restart it with the documented mechanism:
  `CATALOG_PROVIDER=staged-1c ONEC_LOCAL_CATALOG_PATH=/opt/vozdooh/data/catalog-staged.json
  ONEC_STAGED_PREVIEW_ENABLED=true npx next start -H 127.0.0.1 -p 3411`.
- `apps/vozdooh-web/next-env.d.ts` is modified by the build tooling and was intentionally
  NOT staged for commit.

### Authorized finalization — 2026-09-25
- The earlier Git-permission blocker was resolved from the authorized server context; the normal repository object store is used, with no alternate object-store workaround.
- The root-owned staged preview blocker was resolved: the previous listener was stopped and the freshly validated production build now serves staged-1C on `127.0.0.1:3411`.
- Final preview verification: `/catalog` and `/brands` return 200; all 14 CORE/STRONG product routes and exact image URLs return 200; the main catalog grid has 136 pictured products and its first 25 exactly match the checked-in research priority order; normal customer HTML leaks no internal research tiers, preview noise or currency prices.
- A final source hygiene pass removed two literal NUL bytes from `src/catalog/presentation.ts` by expressing the same separator as `\\u0000`; validation was rerun afterward.

## Autonomous reliability pass — 2026-09-25

- Preserved existing staged source/price/stock data, order records, homepage,
  image mappings, TOP-25 and branch. No external commerce integrations enabled.
- Hardened complete-snapshot conversion with duplicate/join/numeric/SKU/reader-limit
  validation, source hash auditing, source-change detection, exclusive locking and
  unique durable temporary publication. Only synthetic conversion tests executed.
- Added stored-receipt integrity checks, bounded checkout confirmation wait with
  retained retry identity, client receipt validation and accessible pending state.
- Added Russian error/404 recovery screens, corrected duplicate checkout headings,
  neutralized stale demo metadata, and supplemented noindex with an HTTP header.
- Added isolated `.next-verify` build mode to preserve a running preview's output.
- See `RELIABILITY.md` for recovery procedures and the frozen research snapshot-hash
  discrepancy. The strict frozen audit is not relaxed; 12 image/five brand blockers
  remain unresolved.
- Verification passed: `npm test` (47 app + 2 receiver + 9 Python cases),
  `npm run typecheck`, `npm run lint`, isolated `npm run build`, and
  `git diff --check`. `npm run verify` also passed with isolated output.
  Initial sandbox subprocess/build restrictions were resolved through scoped
  authorized execution and separate build artifacts; no checks were disabled.
- Read-only Chromium checks passed on loopback port 3419 at 390/430/1440 px:
  21 route/viewport cases, expected 200/404, one H1, no horizontal overflow,
  noindex HTTP headers, robots disallow, 136 pictured cards and exact TOP-25.
  No browser runtime errors or order submissions. Existing port 3411 unchanged.
- Restored generated `next-env.d.ts`. Snapshot SHA-256 remained unchanged across
  this pass. The frozen research validator still rejects the pre-existing hash
  discrepancy documented above; this is not reported as a passing provenance audit.
