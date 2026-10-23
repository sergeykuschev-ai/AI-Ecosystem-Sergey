# Product SEO iteration — 2026-10-12

## Scope and baseline

Russian product search snippets and visible fragrance facts in the isolated
`/tmp/vozdooh-codex-seo` worktree. Initial worktree: clean. Inventory source
`/opt/vozdooh/data/catalog-staged.json` was read only and is not included in Git.
No production, deployment, Ozon, index controls, notifications or social changes.

The staged repository filters positive stock before applying `stagedTrade`.
All 13 selected raw records have null brands; existing normalization infers brands,
categories and volumes from names (including the existing NIRO category override).
Normalization, slugs, images, prices, stock and ordering policy are unchanged.

| Brand / fragrance | Selected SKU(s) | Observed stock |
| --- | --- | --- |
| Christian Tortu Tuberose | N020291 | 2 |
| Christian Tortu Tomato Leaf | N020713 | 1 |
| Christian Tortu Jardin Citrus | N019873, N019836 | 1 each |
| Christian Tortu Vert Frais | N019834, N019900 | 1 each |
| Vellutier Into the Wilderness | V61028 | 1 |
| Vellutier Siberian Pine Forest | V61036 | 1 |
| Vellutier Vintage Library | V63017 | 1 |
| Vellutier Oudwood Journey | V63011 | 2 |
| Vellutier Midnight Toast | V61014, V62014 | 1 each |
| DANHERA NIRO | DANHNIR250DEC | 1 |

The Christian Tortu ceramic vase N019901 (stock 2) is excluded from fragrance
work. V63017 has the inventory spelling `Vintege Library`, handled by an explicit
alias rather than fuzzy matching.

The suggestion that Lothantique has no stock is false after normalization:
N020528 (2), N020468 (2), N020469 (1), N020458 (2), N020465 (2),
N020480 (1), and reed accessory N020486 (6). Raw names omit the brand.
These products remain unchanged in this iteration.

Before: Into the Wilderness and Vintage Library lacked structured fragrance
facts. Editorial notes for these and the existing Oudwood Journey and Midnight
Toast went beyond the accessible official catalog. Priority metadata could omit
the format; lower-priority targets did not use the verified fragrance profile.

## Evidence and limitations

Verified live on 2026-10-12:

- [Official Vellutier catalog](https://vellutier.com/vellutier.pdf), PDF page index
  19: Into the Wilderness — citrus chords, redcurrant, ambra, teakwood; page index
  17: Vintage Library — dark rum, opopanax, labdanum, bourbon vanilla, Indian
  sandalwood. It also lists the selected 515 g and 90 g formats respectively.
- The same catalog, page indices 10 and 28, confirms existing Oudwood Journey
  and Midnight Toast notes. Editorial summaries now agree with those profiles.

This is an older catalog accessible today, not proof of a current formula or
VOZDOOH supplier relationship. No manufacturing, price or provenance claims are
transferred. No note order, family, room, season or creation year is inferred
in the new fact profiles.

The PDF has no Siberian Pine Forest match. Vellutier's homepage returned 403;
requests to `https://www.danhera.com` and `https://www.lothantique.com` failed in
the available browser. Christian Tortu/DANHERA searches found retailer descriptions
and a third-party hosted exhibitor PDF, without establishing authoritative
manufacturer evidence. Conflicting retailer Vert Frais notes were not adopted.

For Christian Tortu and Siberian Pine Forest, descriptions retain only brand,
named fragrance, format and available volume/mass. Their speculative scent-family,
mood and room fields are removed. No manufacturer attribution or new fragrance
fact profiles are added for these products.

## Implementation and verification

Two new explicit Vellutier matches require brand, candle category, token-bounded
name and positive stock; existing matches are preserved. The existing visible
fragrance section and JSON-LD use the new facts. Thirteen scoped positive-stock
SKUs receive format-aware metadata and Open Graph descriptions. Other products,
brands, demo pages and unavailable stock keep the previous metadata flow.

Regression tests cover staged normalization, spelling alias, verified notes,
snippet content, JSON-LD agreement, unsupported-field omission, brand/category/name
boundaries, unavailable stock and existing profiles. Run `npm run verify` in
`apps/vozdooh-web` for tests, typecheck, lint and build. Dependency installation
was local to this worktree, with `npm ci --ignore-scripts --no-audit --no-fund`.
The task result records checks actually executed and limitations.

## Observation and rollback

Implemented locally; not deployed. Search-platform processing and organic outcomes
are unobserved. No ranking, indexing, traffic or rich-result gain is claimed.
After separately approved deployment, inspect these canonical pages and observe
product-page Search Console impressions/clicks over 28 days, accounting for stock
changes. Sparse data is inconclusive. Revert the isolated commit to roll back.

### Executed result

The final JavaScript test run passed 21 of 23 test files. `catalog.test.cjs` and
`onec-customers-import.test.cjs` fail at CLI subprocess assertions: an isolated
`spawnSync(process.execPath, ['-e', 'console.log(123)'])` reproduces `EPERM` and
empty output in this sandbox. All three SEO test files pass independently; the
new iteration file contains four passing regression cases. The old committed
facts module fails the Vintage Library profile assertion, confirming the baseline.
The nine Python tests pass. Typecheck and zero-warning lint pass.

Exchange integration tests independently fail with `listen EPERM` on localhost.
The default Turbopack build stalled and was stopped. The supported webpack build
fails with `Could not parse output from TypeScript's --showConfig`, consistent
with the sandbox's empty subprocess output. Rendered HTTP checks are unavailable
because localhost binding is forbidden. Code-level checks confirmed the metadata
and Open Graph wiring, and all 13 actual positive-stock records produced scoped
snippets through normalization without inventory mutation.

The required `npm run verify` gate is therefore not green. No commit was created,
no checks were bypassed, and the implementation remains reviewable in the worktree.

## 2026-10-13 integration with live merchandising

The production merchandising commit 2b1dba16 already contained NIRO fragrance facts
from two retailer cards (Bosco and TSUM), not from an official manufacturer
page. The merged version retains these explicitly retailer-attributed facts and
restores the NIRO woody merchandising family, without an unsupported room or
mood recommendation. Regression tests distinguish this case from products
without corroborated note information.
