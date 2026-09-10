# Stores Web V1.2 — Production Performance Baseline (CWV) — 2026-09-10

Scope: `apps/stores-web` only. Priority pages: `/`, `/amper/`, `/ventil/`, `/metiz-market/`, `/miska/`.
No business content, promotions, prices, or Directus schema/data were changed. No deploy was performed.

## Method

A full Lighthouse run was **not possible in this environment**: headless Chrome
cannot start under the sandbox (ProcessSingleton socket creation is denied even
with a profile directory inside the worktree), and no Lighthouse installation
exists. This was verified again today by attempting
`chrome --headless=new --user-data-dir=<worktree>/...`, which aborts with
"Failed to create socket directory" (exit 21).

The baseline is therefore a reproducible **lab measurement of the deterministic
signals CWV depends on**, taken against a hermetic production server
(mock content, standalone output, exactly as the Dockerfile assembles it):

```bash
cd apps/stores-web
npm ci
CONTENT_SOURCE=mock NEXT_PUBLIC_SITE_URL=https://stores-ci.example npm run build
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
PORT=3910 CONTENT_SOURCE=mock HOSTNAME=127.0.0.1 node .next/standalone/server.js
node --import tsx scripts/perf/cwv-baseline.ts http://127.0.0.1:3910
```

`scripts/perf/cwv-baseline.ts` reports per page: median TTFB (5 warm runs),
HTML size (raw and gzip wire size), every referenced script/css asset with wire
size and cache headers, image `srcset`/`sizes` correctness, LCP preload hints,
and inline script count. Raw JSON for both runs is stored in
`docs/perf/cwv-baseline-2026-09-10.json` and `docs/perf/cwv-after-2026-09-10.json`.

Lab LCP/CLS/TBT numbers still need a real browser run against production. The
cache change below is header-level and can be validated independently of that
future browser measurement.

## Baseline (before) and after

Server: local standalone build, mock content, warm in-process/data caches.
Transfer sizes are wire bytes (gzip where negotiated).

| Page | TTFB (warm) | HTML gzip | JS gzip (modern browsers) | CSS gzip | Images |
|---|---|---|---|---|---|
| `/` | ~9 ms → ~8 ms | 12.3 KB → 12.3 KB | 143.6 KB → 143.6 KB | 6.0 KB → 6.0 KB | 9 → 9 |
| `/amper/` | ~6 ms → ~5 ms | 11.0 KB → 11.0 KB | 141.5 KB → 141.5 KB | 6.0 KB → 6.0 KB | 4 → 4 |
| `/ventil/` | ~4 ms → ~4 ms | 9.6 KB → 9.6 KB | 141.5 KB → 141.5 KB | 6.0 KB → 6.0 KB | 2 → 2 |
| `/metiz-market/` | ~4 ms → ~4 ms | 8.8 KB → 8.8 KB | 141.5 KB → 141.5 KB | 6.0 KB → 6.0 KB | 2 → 2 |
| `/miska/` | ~4 ms → ~4 ms | 13.0 KB → 13.0 KB | 141.5 KB → 141.5 KB | 6.0 KB → 6.0 KB | 4 → 4 |

TTFB here is localhost loopback and only demonstrates that server-side work is
small; real TTFB depends on Directus latency and is covered by the 300 s Data
Cache (`revalidate: 300`) behind `force-dynamic`.

## Asset-level findings

JavaScript (identical on all five pages):

- `1_vgly0gd1oic.js` 71.6 KB gzip — React DOM/runtime.
- `1w534hvog6gw_.js` 47.3 KB gzip — Next.js client runtime.
- Small shared/page chunks: 3.5–7.6 KB gzip (router, `next/image` client,
  `ActualSlider` 7.6 KB on pages that render it, analytics ~0.7 KB).
- `0cz1d0mv5g_q7.js` 38.7 KB gzip is the **core-js polyfill loaded with
  `nomodule`** — modern browsers skip it entirely. The 141–144 KB figures above
  exclude it.

`/_next/static/*` is served with `Cache-Control: public, max-age=31536000,
immutable` — correct. `/_next/image` optimizer output carries
`Cache-Control: public, max-age=14400, must-revalidate` with `Vary: Accept`
(AVIF/WebP negotiation) — the Next.js default, kept.

Images: homepage LCP slide is preloaded via
`<link rel="preload" as="image" imageSrcSet ... imageSizes>` with
`sizes` capped at 1152 px; all `next/image` usages emit matching `srcset`/`sizes`.
Brand logos render via `unoptimized` `next/image` (5–9 KB WebP; `ventil-logo.svg`
is 152 KB raw / 42 KB gzip — gzipped on the wire, reviewed below).

Fonts: system stack only; no webfont download, no font CLS. CLS: all images are
`fill` inside fixed `aspect-ratio` containers (see PERFORMANCE_AUDIT_2026-09-10.md).

Client JS/hydration: only five client components exist (`ActualSlider`,
`TrackedLink`, `AnalyticsProvider`, `YandexMetrika`, error boundaries);
Header/Footer/navigation are server components.

## Confirmed fixes applied

1. **Public brand/actual images revalidated on every repeat visit.**
   `/brands/*` and `/actual/*` (non-fingerprinted files that change only with
   deploys) were served with `Cache-Control: public, max-age=0`, forcing one
   conditional-request round-trip per asset per visit. Now
   `public, max-age=86400, stale-while-revalidate=31536000` via
   `headers()` in `next.config.ts` (rule ordered after the security catch-all
   so its `Cache-Control` wins). Regression coverage:
   `tests/static-cache-policy.test.ts`.

## Reviewed and intentionally left unchanged

- **`force-dynamic` on all pages** — static prerendering would bake
  `CONTENT_SOURCE=mock` content into first-served HTML after each deploy.
  Rationale documented in PERFORMANCE_AUDIT_2026-09-10.md.
- **Yandex Metrika timing** — `tag.js` (103 KB raw from Yandex CDN) is loaded
  async and does not block rendering; deferring it further would change
  analytics collection behaviour. Left as decided in the previous audit.
- **React/Next runtime size (~142 KB gzip)** — the framework floor for a
  hydrated App Router page; no avoidable client components found.
- **`ventil-logo.svg` geometry** — already minified to integer coordinates in
  the previous audit; further path simplification risks visible changes to a
  brand asset. Ships gzipped at ~42 KB.
- **`images.minimumCacheTTL`** — raising it would extend staleness of Directus
  images served through the optimizer; promotion images must stay fresh.
- **`images.remotePatterns`** — dead but harmless config (Directus images are
  same-origin via `/api/assets/[id]`), kept.

## Remaining work (needs a browser)

Collect lab LCP/CLS/TBT and field CrUX data on the production host with
Lighthouse (mobile + desktop profiles) using the same five URLs; this
environment cannot run Chrome. The tooling and baseline above make any
regression between releases directly comparable.

## Checks

- `npm test` — 113 tests pass (incl. new `static-cache-policy`)
- `npm run lint` — clean
- `npm run typecheck` — clean
- hermetic `CONTENT_SOURCE=mock npm run build` — success
