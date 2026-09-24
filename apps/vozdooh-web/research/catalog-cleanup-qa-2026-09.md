# Catalog cleanup verification — 24 September 2026

## Outcome

Implementation is present in the working tree only. Base/HEAD:
`218f8ba24fe539194d97cf018f87c564ba982d77`, branch `ai/kimi-vozdooh-store`.
No commit or push. No staged preview restart. Required production-build and
browser gates are **not passed**; this is not a launch-ready verification claim.

## Files changed

All paths below are relative to `apps/vozdooh-web`:

- `app/brands/page.tsx`: stock-driven discovery with concise brand introductions.
- `app/brands/[slug]/page.tsx`: 12 available brand routes, metadata/canonicals, 404 for unavailable slugs.
- `app/categories/page.tsx`: category discovery.
- `app/categories/[slug]/page.tsx`: 10 available category routes and metadata.
- `app/catalog/page.tsx`: discovery links and preserved filter context on card links.
- `app/catalog/[slug]/page.tsx`: canonical metadata, filter-preserving return link, brand/category links, omitted empty descriptions and inapplicable volume rows.
- `app/globals.css`: scoped discovery layout, wrapping, focus and minimum touch-height rules.
- `components/CatalogLanding.tsx`: shared inventory landing presentation.
- `components/ProductCard.tsx`: validated catalog-filter context in links.
- `src/catalog/landings.ts`: inventory-grounded copy and deterministic positive-stock discovery.
- `src/catalog/reviewedContent.ts`: 24 exact-name-guarded AROMAgroup descriptions and six display-title fixes.
- `src/catalog/presentation.ts`: reviewed titles and accessory subtitle correction.
- `src/catalog/stagedEditorial.ts`: format precedence, specific Millefiori category, conservative unsupported descriptions.
- `tests/catalog-cleanup.test.cjs`: six grouped regression tests, all 22 landing renders, boundaries and TOP-25.
- `scripts/verify-catalog-visual.cjs`: repeatable production-browser check for 390/430/1440 px.
- `scripts/verify-rendered-catalog.cjs`: read-only SSR/HTML/CSS fallback.
- `research/catalog-cleanup-evidence-2026-09.md`: evidence and unresolved identity/photo limits.
- `research/catalog-quality-after-merchandising.md`: explicit RESOLVED and UNRESOLVED sections.
- `research/catalog-cleanup-qa-2026-09.md`: this report.

No dependency, font, tracker, image asset, homepage/hero, checkout, source snapshot,
research rank or other-app changes. `next-env.d.ts` is tracked in the base repository
but unchanged and explicitly excluded from the attempted staging command.

## Catalog and SEO

- Improved 24/27 AROMAgroup fallback descriptions; three remain conservative.
- Restored the five VINOVE city/collection titles, corrected Lamborghini display
  spelling, distinguished refills/accessory boxes, and classified Mimosa Flower
  specifically as water-soluble fragrance.
- Preserved separate Aramara variants and review-scope boundaries. Found diffuser
  format evidence for Bianco Divino 500 ml. Removed unsupported XMAS composition
  and rattan dimensions from editorial claims.
- All 12 missing photos and five unknown brands remain explicit and hidden from
  ordinary discovery. No new image permission or exact asset match established.
- Brand routes: `culti-milano`, `teatro-fragranze-uniche`, `lothantique`,
  `christian-tortu`, `vellutier`, `danhera`, `mami-milano`, `vinove`,
  `millefiori-milano`, `castelbel`, `ladenac-milano`, `aromagroup`.
- Category routes: `diffusers`, `candles`, `car`, `sprays`, `refills`,
  `accessories`, `water-soluble`, `home-fragrance`, `gifts`, `professional`.
- H1/H2 hierarchy, crawlable internal links and relative canonical metadata are
  present. Existing metadataBase, global noindex and robots disallow stay intact.
  No fake history, reviews, FAQ, sales or bestseller additions.

## Visual QA: fallback performed, geometry unverified

Actual browser execution was attempted with available Playwright. Initially
Chromium lacked `libgbm.so.1`. Using the already available library directory
`/tmp/vozdooh-browser-libs/extracted/usr/lib/x86_64-linux-gnu` resolved that loader
failure, but Chromium then terminated at `sandbox_host_linux.cc:41` with
`shutdown: Operation not permitted (1)`. No screenshots were produced by this run.
No browser security/process restriction was bypassed.

The read-only fallback rendered **175 route cases** (catalog, two filters, discovery,
all 22 landings, all 148 product pages) from the actual staged snapshot. It checked
one H1 per page, no visible price/internal-tier/order-button text, valid local image
references and exact TOP-25 order. HTML with the current CSS is in
`/tmp/vozdooh-catalog-rendered-qa/`; route mapping is `routes.json`.
These are React server-component renders, **not a successful production build or
HTTP status test**. Browser hydration and computed geometry remain unverified.

CSS/markup inspection for 390/430 px and desktop:

- Existing product cards retain two-line clamps and contain image frames.
- New discovery tiles use a single mobile column, wrapping headings and minmax
  grid tracks; mobile 390/430 px uses the existing <=760px breakpoint.
- New navigation links have minimum 44px height and wrap instead of overflowing.
- Brand/original title/approved Russian title/type-volume hierarchy is retained.
- Empty description paragraphs and inapplicable empty volume rows are omitted.
- Source details remain available for traceability; no duplicate new technical blocks.
- Filter query context is preserved through catalog card -> product -> catalog,
  including brand, category, family and debug semantics. Landing cards also retain
  their brand/category selection.

Observed code-level defects were fixed without redesigning the homepage. No claim
is made that overflow, every touch target or image loading passed browser measurement.

## Commands and exact results

Run from `apps/vozdooh-web`:

| Check | Result |
|---|---|
| `node research/validate-demand-2026-09.cjs` | PASS: 148 SKU, 220 units, 155 sources, TOP-25, 9 high-stock SKU; JSON/CSV/ranking/snapshot consistency. |
| `npm run typecheck` | PASS. |
| `npm run lint` | PASS, zero warnings. |
| `npm test` | FAIL: cleanup, merchandising and presentation suites pass; pre-existing catalog suite fails in two CLI child-process cases. |
| `node --require ./scripts/register-typescript.cjs tests/catalog-cleanup.test.cjs` | PASS: all six grouped tests, including every landing render. |
| `node --require ./scripts/register-typescript.cjs tests/catalog.test.cjs` | 13/15 pass; CLI cases receive empty child stdout/stderr. Independent `spawnSync` probe returns `EPERM`. |
| `node --test integrations/onec-exchange/server.test.mjs` | FAIL. Direct diagnostic execution confirms both cases fail with `listen EPERM: operation not permitted 127.0.0.1`. |
| `npm run verify` | FAIL at the same existing catalog test suite; subsequent commands also run individually. |
| `npm run build` | FAIL: `EACCES: permission denied, open '.../apps/vozdooh-web/.next/trace'`. No successful build claimed. |
| `CATALOG_PROVIDER=staged-1c ONEC_LOCAL_CATALOG_PATH=/opt/vozdooh/data/catalog-staged.json node scripts/verify-rendered-catalog.cjs` | PASS: 175 SSR cases. |
| `PLAYWRIGHT_MODULE=/root/.npm/_npx/420ff84f11983ee5/node_modules/playwright node scripts/verify-catalog-visual.cjs` | BLOCKED as above, including retry with available shared libraries. |
| `git diff --check` | PASS. |
| Rendered no-price/no-tier checks | PASS across all 175 cases; existing synthetic-price rendering test also passes. |
| Scope and source/rank checks | Only this app changed; demand JSON/CSV/rank module unchanged; snapshot hash validator passes. |
| `next-env.d.ts` | No diff, not included in staging command. |

Baseline reproduction loaded the original modules from `218f8ba2` and compared
identical inputs: ORO refill and TEATRO sticks were both “Диффузоры” before the fix;
now “Рефилы” and “Аксессуары”. VINOVE N020445 was “Ароматизатор для автомобиля”;
now “Rome · Evolution Excellence”. No source name was changed.

## Git and runtime blockers

Scoped `git add` failed before staging:

```text
fatal: Unable to create '/var/lib/kimi-worker/repo/.git/worktrees/vozdooh-store/index.lock': Read-only file system
```

No commit SHA was created; HEAD stays at the base above. No push attempted, no
alternate object store, history operation or changes to main. Full verification is
also incomplete, so the checks were not bypassed for publication.

`curl --noproxy '*' -I --max-time 5 http://127.0.0.1:3411/catalog` could not connect
in this execution environment. A pre-existing PID file contains `2409854`, but
that PID is not visible to `ps` here; ownership/aliveness cannot be confirmed.
No kill was attempted, and no root-owned restart/EPERM claim is inferred from the
stale PID file. Restart is pending a validated build and successful commit/push.
No staged HTTP routes or optimized image requests are claimed verified.

## Remaining work and decisions

Infrastructure, not business policy: make normal build output/Git worktree writable
and allow required child processes/local sockets, then rerun the required checks,
inspect browser screenshots at 390/430/1440 px, commit/push only this branch and
restart staged preview on 127.0.0.1:3411. The two verification scripts above are ready.

Sergey/supplier evidence: physical WoodWick identity; five accessory brands and
specs; Ladenac variant; XMAS contents; TEATRO/rattan pack specs; microUSB ratings;
AROMAgroup cartridge models; exact image assets and reuse rights; CULTI Lamborghini
finish/edition and physical photo checks for the 14 priority cards. Production
domain/indexing and any checkout/payment/order launch still require approval.
