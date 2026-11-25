# SEO stage 3 — issue #306 candidate

Reviewed locally on 2026-11-25. Branch: `codex/vozdooh-seo306`; exact initial
HEAD: `d0d7e1392fdc7103bd9d04def6e94d83c9caadd1`. Changes are uncommitted,
confined to this app. No release, network retrieval, dependency installation,
live catalog access, payment, order creation or external integration was performed.

## Implementation and diff

- `src/catalog/verifiedNotes.ts`: small editorial allowlist; exact SKU + slug,
  brand, category, token-bounded fragrance and volume/mass guards. Each record
  carries its source URL, repository evidence document and original verification
  date. Binding review date is separate from source verification. Existing
  `fragranceFacts.ts` supplies the already reviewed display notes; no new pyramid
  is inferred from a name or family. Research JSON is not bundled into the app.
- `src/catalog/collections.ts`: five bounded note definitions reuse the existing
  collection route/index/sitemap. At least three distinct purchasable SKU and
  distinct slugs are required, after image validation by callers. This is a local
  merchandising rule, not a search-engine requirement. No combinatorial routes.
- `src/catalog/contextualLinks.ts`: exact pair Set replaces the lossy SKU-to-slug
  Map; note links require both an available destination and a matching page pair.
- `app/catalog/[slug]/page.tsx`: source/date attribution for the six bound products;
  existing collection link mechanism also exposes available relevant note pages.
- `src/catalog/seasonalGifts.ts`, `components/SeasonalGifts.tsx`,
  `components/CatalogLanding.tsx`, `app/collections/[slug]/page.tsx`: winter gift
  section on existing gifts category and gift-diffusers collection. It reads the
  current full validated provider snapshot, checks exact SKU/slug/brand and public
  purchasability, deduplicates and disappears when empty. It uses existing product
  cards for current names/prices. No separate seasonal URL or delivery/discount claim.
- `tests/seo-stage3.test.cjs`, `tests/seo-stage3-ssr.test.cjs`: provenance,
  wrong identity/format, availability, duplicate pairs, minimum assortment,
  relevant links, seasonal cards, absent routes and SSR metadata/H1/schema/canonical/
  indexing/sitemap regressions. Existing tests were not changed or weakened.

## Evidence accepted

All evidence below was already in the repository. No source was fetched again;
the dates describe recorded checks, not fresh manufacturer verification.

| Exact binding | Source and recorded check | Target notes |
| --- | --- | --- |
| `V63017` / `vellutier-vintage-library-90`, 90 g | [Official Vellutier PDF](https://vellutier.com/vellutier.pdf), zero-based page 17, verified 2026-10-12 in `research/product-seo-2026-10-12.md` | vanilla, sandalwood |
| `V63011` / `vellutier-oudwood-journey-90`, 90 g | Same PDF, zero-based page 10, same dated review | oud |
| `df29d344-d192-11ec-be83-7c8bca00854e` / `culti-stile-aramara-250` | [Official Stile Aramara 250](https://www.culti.com/it/diffusore-stile-aramara-250ml.html), 2026-09-24, demand evidence `Eaaa45d1c90` and catalog cleanup review | bergamot, sandalwood |
| `802e8ae5-d19b-11ec-be83-7c8bca00854e` / `culti-decor-aramara-250` | [Official Decor Aramara 250](https://www.culti.com/en/diffusore-decor-aramara-250ml.html), 2026-09-24, separate exact variant confirmed in `research/catalog-cleanup-evidence-2026-09.md` | bergamot, sandalwood |
| `df29d34a-d192-11ec-be83-7c8bca00854e` / `culti-stile-aqqua-250` | [Official Stile Aqqua 250](https://www.culti.com/eu/catalog/product/view/id/3441/s/diffusore-stile-aqqua-250ml-3441/category/21/), 2026-09-24, demand evidence `E68c6d5e964` | bergamot, sandalwood |
| `DV250TFU` / `teatro-dolce-vaniglia-250` | [Official Dolce Vaniglia 250 with sticks](https://teatrofragranzeuniche.it/it/dolce-vaniglia-ml-250-con-bastoncini), 2026-09-24, demand evidence `E92c0243b26` | vanilla |

SKU/fragrance/format relations and confirmed main notes are recorded in
`research/demand-evidence-2026-09.json` product `card_preparation` and summarized in
`research/demand-priority-2026-09.md`. Slugs are bound by `src/catalog/stagedEditorial.ts`.
The new regression checks all six against recorded original names and volumes.
The Vellutier catalog is historical evidence, not proof of a current formulation.
Brand stories and product-card completeness reviews were inspected; brand history,
an existing photo/description and demand class alone are not note evidence.

| Proposed route | Maximum bound distinct SKU before live eligibility | Behavior |
| --- | ---: | --- |
| `/collections/notes-bergamot` | 3 | Available only when all three qualify in current provider snapshot |
| `/collections/notes-sandalwood` | 4 | Available only when at least three qualify |
| `/collections/notes-vanilla` | 2 | 404 / absent from index, sitemap and note links |
| `/collections/notes-oud` | 1 | Same safe exclusion |
| `/collections/notes-fig` | 0 | Same safe exclusion |

These are evidence counts, not observed current stock counts. Synthetic fixtures
prove the gating logic; current production eligibility remains unobserved.

## Exclusions and sources still needed

- No notes copied from Candlesbox and no inferred search volume, traffic or rank.
- Aramara 1000 ml, Aqqua Decor/spray and Dolce Vaniglia 500 ml/refill are not
  admitted by transferring the cited 250 ml product page. Obtain official exact
  variant pages or a manufacturer document explicitly linking their formulations.
- NIRO retailer evidence is retained in the existing facts module, but is not
  newly admitted to note collections. Obtain DANHERA's exact NIRO 250 ml source.
- Foglie di Fico has legacy fragrance facts; obtain dated official per-format
  sources and exact SKU binding before enabling fig selection. At least three
  eligible distinct SKU remain necessary; do not create inventory to meet a quota.
- Lothantique SANDALWOOD naming/family is not proof of a note pyramid. Its recorded
  refill review cannot establish diffuser notes. Obtain exact official product evidence.
- Unsupported AROMAgroup/Christian Tortu notes and brand-story generalizations are
  excluded. Existing unrelated editorial content is preserved.
- Seasonal pairs are `CAND-XM180` / `teatro-xmas-candle-180` and `CAPP-XMTFU` /
  `teatro-xmas-gift-set`, as explicitly supplied in the task and bound in existing
  editorial data. No scent claims are added to the seasonal section. Their current
  availability must come from the rendering provider, never the historical snapshot.

## Executed verification

Dependencies are absent (`node_modules`, including the required installed Next.js
guide). No packages were downloaded and no substitute dependency tree was used.
The existing route conventions were reused; installed Next.js documentation could
not be read. PowerShell's `npm.ps1` is disabled, so commands were retried via `npm.cmd`
without changing execution policy.

| Command | Actual result |
| --- | --- |
| `npm.cmd run test` | BLOCKED: `Cannot find module 'typescript'` at preload; standard suite did not run |
| `npm.cmd run typecheck` | BLOCKED: `tsc` not found |
| `npm.cmd run lint` | BLOCKED: `eslint` not found |
| `npm.cmd run build` | BLOCKED: `next` not found |
| `npm.cmd run verify` | BLOCKED at test preload, same missing TypeScript |
| Native Node command below | PASS: 8 tests, 0 failures (6 new domain tests and 2 existing tests) |
| `node --check tests/seo-stage3.test.cjs` and `node --check tests/seo-stage3-ssr.test.cjs` | PASS: JavaScript syntax only |
| `python -B -m unittest discover -s tests -p '*_test.py'` | FAIL: 9 tests ran, 7 XML ParseError errors (`line 1, column 6`), 2 passed; synthetic fixtures only; Python code/fixtures unchanged |
| `git diff --check` | PASS |

Reproduce the dependency-free domain checks on the installed Node 24:

```powershell
node --experimental-strip-types -e "require('node:module').registerHooks({resolve(s,c,n){try{return n(s,c)}catch(e){if(s.startsWith('.'))return n(s+'.ts',c);throw e}}});require('./tests/seo-stage3.test.cjs');require('./tests/fragrance-facts.test.cjs');require('./tests/contextual-catalog-links.test.cjs')"
```

This loader only strips types and resolves local TypeScript imports. It is not a
typecheck or a replacement for the standard CommonJS compiler test harness.
An initial combined native run reached the SSR test and failed for missing
TypeScript; SSR tests were then placed in their own file and remain unexecuted.
SSR output, full existing commercial regressions, browser/mobile checks and build
are NOT verified. No production HTTP/canonical/robots/schema/feed checks were made.

## PR acceptance and release gate

1. Review this complete candidate diff, then run `npm run verify` in an authorized
   dependency-equipped environment. Resolve the Python failures without weakening
   tests. Run both new test files through the normal harness; independent review
   and CI must pass before release approval.
2. Using an isolated catalog fixture, confirm enabled note routes render one H1,
   unique metadata, self canonical, CollectionPage/ItemList JSON-LD and the existing
   indexing switch. Remove stock/price/image or reduce to two SKU: metadata must
   noindex, page must 404 and sitemap/internal links must omit the destination.
3. Compare exact old sitemap URL set against the same provider snapshot at base
   HEAD; preserve every old URL, including the four #304/#305 destinations. Previous
   definitions, paths, metadata, robots and sitemap code were not changed. The
   task's 200 URLs / 108 Yandex offers are supplied baseline observations, not
   reproduced here. New valid routes may add at most two URLs with current evidence.
4. Verify gift section at desktop/mobile widths on existing gifts/gift-diffusers
   pages, including zero and one eligible product. Verify product source attribution
   and relevant links. Compare Yandex offer set on the same fixture: feed code,
   pricing, 1C, checkout, order and payment mechanisms have no diff.
5. Keep #282 and #288 as separate blockers; this candidate does not close them.
   Obtain operator review, independent review, CI, PR and owner release approval.

## Rollback

No candidate commit exists. Before integration, remove only the changes listed in
this report after reviewing the diff; preserve other contributors' work. After an
approved integration, revert its isolated commit/PR through the normal review and
release process. No data migration or trade-data rollback is needed. Confirm the
previous exact URL set and disappearance of the two new note URLs. Do not roll back
#304/#305, change indexing controls, or touch orders/payments for this rollback.

## Post-release baseline (unmeasured)

Record release date/time, exact URL groups, inventory eligibility and indexing
settings. For each of 7, 14 and 28 complete days after release, compare the same
number of complete days immediately before release, using identical timezone,
filters, attribution and sources. Separate new note URLs (no prior URL history)
from existing product/gift URLs; note stock changes and winter seasonality.

| Metric | Source / comparison |
| --- | --- |
| Indexed eligible URLs | Search Console / Yandex Webmaster, same URL cohort and report dates; record exclusions |
| Organic impressions and clicks | Search Console / Webmaster, same engine, country, device and page filters |
| Organic visits | Existing analytics, same organic-channel definition and timezone |
| Purchases | Existing verified paid-purchase reporting, same attribution window; never count saved requests as paid purchases |

All numerical cells remain **not measured** until an authorized operator supplies
the reports. Record data lag and small samples; no uplift or causal claim is made.
