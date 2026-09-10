# Stores Web Performance Audit — 2026-09-10

Scope: `apps/stores-web` only. Priority pages: `/`, `/amper/`, `/ventil/`, `/metiz-market/`, `/miska/`.
No content, promotions, contact data, or business rules were changed.

## Method and limitation

A full Lighthouse/Core Web Vitals lab run was **not possible in this environment**:
headless Chrome cannot start under the sandbox (ProcessSingleton socket creation is
denied), and no Lighthouse installation exists. The audit was therefore performed
with code review plus a build/runtime-based audit:

- hermetic build with `CONTENT_SOURCE=mock` and runtime inspection of the standalone
  server (`next start` equivalent) using `curl`;
- verified the rendered HTML of all five priority pages (preload hints, `srcset`
  generation, script tags);
- measured homepage JavaScript transfer and `next/image` optimizer output sizes.

Lab CWV numbers (LCP/INP field data) should be collected on the production host
with Lighthouse or CrUX when a browser is available; the fixes below are
asset- and markup-level and are independent of the measurement method.

## Verified findings and fixes

### 1. Oversized fallback raster assets (fixed)

`public/actual/` held photographic PNGs of 1.7–2.0 MB each (7.1 MB total) and a
0.5 MB JPEG. They are the fallback/mock content for the homepage slider and brand
"Актуальное" sections, ship in the Docker image, and are decoded by the image
optimizer on cold cache — including for the preloaded LCP slide right after a
deploy. Yet the layout never displays them wider than ~1152 px (the slider `sizes`
cap is 1200w).

Fix: re-encoded at the maximum width the layout actually requests (1200w for
landscape slides, native 1055w for the portrait card) as WebP q75 — the exact
bytes the optimizer already produced for browsers. `public/actual/` went from
7.1 MB to ~0.5 MB. The optimizer output for the LCP slide is byte-identical to
before (49.6 KB AVIF), so delivered pixels are unchanged.

Brand logos were similarly oversized (83–90 KB JPEGs at ~1000–1300 px; rendered
at ≤272 px CSS). Re-encoded as WebP at sufficient resolution for the CSS zoom
(`amper` uses `transform: scale(2.35)`, so its logo kept 1200w). 83 KB → 8.6 KB,
90 KB → 7.8 KB, 51 KB → 5.5 KB.

The `ventil-logo.svg` (254 KB of machine-generated paths) was minified by
collapsing whitespace and rounding coordinates to integers. At its viewBox of
1152 and render width of ≤272 px this moves edges by ≤0.12 px — visually
identical. 254 KB → 150 KB.

Total `public/`: 7.6 MB → 0.8 MB.

### 2. Inaccurate `sizes` on brand actual cards (fixed)

`BrandActualList` declared `(min-width: 42rem) 50vw` for a grid that stays
single-column (full width) until `64rem`. Between 42rem and 64rem the browser
was told the image occupies half the viewport while it actually fills the
container — causing it to pick an undersized variant (soft images) or, after
rounding, waste. Changed to `(min-width: 64rem) 35rem, 100vw`, matching the CSS
grid breakpoints.

## Reviewed and intentionally left unchanged

- **`export const dynamic = "force-dynamic"` on all pages.** Removing it would
  enable ISR/static prerendering, but production images are built with
  `CONTENT_SOURCE=mock` (Dockerfile default; `compose.production.yml` passes no
  build arg) while runtime content comes from Directus. Static prerendering would
  bake mock content into the first-served HTML after each deploy. Kept as is;
  Directus fetches still use the 300 s Data Cache via `revalidate: 300`.
- **`unoptimized` on `BrandLogo`.** Kept after the source files were slimmed —
  avoids double recompression of brand artwork, and the files are now 4–9 KB.
- **Homepage JS (~186 KB gzip across 10 chunks).** Dominated by the React/Next
  runtime and the interactive slider; no avoidable client components found
  (`TrackedLink`, `YandexMetrika`, `AnalyticsProvider` are small and purposeful).
- **Fonts.** System stack (`Arial, Helvetica, sans-serif`); no webfont blocking
  or font-related CLS.
- **CLS.** All `next/image` usages are `fill` inside containers with fixed
  `aspect-ratio` or fixed height; no layout-shift source found.
- **Yandex Metrika.** Already loads `tag.js` async; inline bootstrap is minimal.
- **`next.config.ts` `images.remotePatterns`.** Dead config (Directus images are
  same-origin via `/api/assets/[id]` with immutable caching); harmless, kept.

## Regression coverage

`tests/public-assets.test.ts` asserts that every local image referenced by mock
content exists in `public/`, uses an efficient format (WebP/AVIF/SVG), and stays
under a 200 KB weight budget.

## Checks

- `npm test` — 40 tests pass (incl. new asset test)
- `npm run lint` — clean
- `npm run typecheck` — clean
- hermetic `CONTENT_SOURCE=mock npm run build` — success
