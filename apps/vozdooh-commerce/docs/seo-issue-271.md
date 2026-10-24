# Issue #271: reviewed Aramara variant headings

Candidate-only change for finding `vozdooh-product-h1-e5dad2595c9f`.
Source: https://github.com/sergeykuschev-ai/AI-Ecosystem-Sergey/issues/271

The assignment supplied verified public details rendered from existing 1C trade
fields. No external service or private catalog export was accessed for this task.

| Path | Verified SKU | Source name | Volume |
| --- | --- | --- | --- |
| `/catalog/culti-decor-aramara-1000` | `bf33a951-016c-11ed-b2a4-7c8bca00854e` | Decor Classic диффузор Aramara 1000 мл | 1000 мл |
| `/catalog/culti-decor-aramara-250` | `802e8ae5-d19b-11ec-be83-7c8bca00854e` | Decor Classic диффузор Aramara 250мл | 250 мл |

Previously both presentation headings were `Decor Classic Aramara`. The shared
`productPageHeading` helper now produces `Decor Classic Aramara 1000 мл` and
`Decor Classic Aramara 250 мл` only when the reviewed path, SKU, exact source name
and trimmed trade volume agree. Missing or conflicting data preserves the existing
presentation rather than inferring volume from a URL. A changed source name needs
another review before it qualifies. Existing H1 and Product JSON-LD wiring uses
this helper; card titles and other metadata remain unchanged. Cleaning-fluid
guards and all trade data remain unchanged.

## Local verification (2026-10-24)

Commands run from `apps/vozdooh-commerce`, with synthetic fixtures only:

```powershell
node --require ./scripts/register-typescript.cjs --test tests/aramara-variant-seo.test.cjs tests/product-variant-heading.test.cjs tests/public-product-seo.test.cjs tests/product-seo-iteration.test.cjs tests/product-metadata.test.cjs
```

Result: 39 tests, 39 passed, 0 failed, 0 skipped, 0 cancelled.
The new test file alone was also run against the unchanged HEAD presentation
implementation: 16 tests, 14 passed, 2 failed as expected, exposing both duplicate
headings. The candidate implementation was restored immediately afterward.
The focused Aramara plus cleaning-fluid run passed 26/26 tests.

`npm.cmd run typecheck`: passed (exit 0).
`npm.cmd run lint`: passed (exit 0, no warnings).
`git diff --check`: passed (exit 0).
The initial `npm run typecheck` and `npm run lint` attempts were blocked by
PowerShell's policy for `npm.ps1`; `npm.cmd` avoids that launcher without any
system policy change.

Tests cover both reviewed sizes, missing/conflicting volume and name, different
fragrance/SKU, unreviewed path, unchanged input data, price/currency, SKU/URL and
in-stock/out-of-stock schema behavior. Existing tests check that the page H1 and
Product schema call the shared helper.

No browser/runtime or production verification was performed. Full `verify`
(including build and integration suites) was not run. No production deployment,
push, external messages or service changes were performed. Owner review is required
before any release.
