# Issue #262: duplicate product headings (review only)

Task: `VOZDOOH_SEO_15_GROUPS_FIX_REVIEW_GATE_20261029`. Status: `needs_review`.
Candidate baseline: `ccefca657c73a4cfda149abc744895124b7085d4`.

## Change and evidence

`src/catalog/presentation.ts` adds exact SKU/source-name guards for 35 variants
in all 15 requested groups. The evidence is the already tracked, sanitized
`research/data/logistics-eligible-skus-2026-10-02.json` (recorded upstream source_sha256
`a71400f603b5b8169fa02cf5cdfd78f192973c002832ae2b7f8eddd0d113120f`).
No external service or live catalog was consulted. Its raw volume fields are
null; sizes and units below are explicit in its original trade names. Existing
`stagedTrade`/`inferStagedVolume` normalization supplies these volumes at runtime.
The new guard requires the exact reviewed name and matching normalized trade
volume. Missing or conflicting sized-product volumes preserve the old heading.
Potpourri names establish type alone; no quantity is invented.

The shared `productPageHeading` already feeds the displayed H1 and Product.name.
The existing JSON-LD breadcrumb name also follows this helper. No schema module,
metadata function, catalog card title, canonical, URL, ID, SKU, price, stock or
availability logic changed. Existing cleaning-fluid and Aramara guards remain.
Runtime changes are limited to the heading helper; tests use synthetic catalog
records with synthetic prices, stock, IDs, paths and images.

| Reviewed group | Verified variants / suffix facts | Outcome |
| --- | --- | --- |
| TEATRO CERESIA | stick diffuser 250 / 500 ml | Implemented |
| TEATRO DOLCE VANIGLIA | stick diffuser 250 / 500 ml; diffuser refill 500 ml | Implemented |
| Christian Tortu JARDIN CITRUS | potpourri; potpourri refresher 15 ml | Implemented |
| MAMI NUVOLA DI COTONE | stick diffuser 200 ml; diffuser refill 250 ml | Implemented |
| TEATRO ROSE OUD | stick diffuser 250 ml; candle 180 g | Implemented |
| CULTI The | diffuser refill 1000 ml; room spray 100 ml | Implemented |
| Christian Tortu VERT FRAIS | potpourri; potpourri refresher 15 ml | Implemented |
| MAMI VIA DELLE SPEZIE | stick diffuser 200 ml; diffuser refill 250 ml | Implemented |
| AROMAgroup BERBERI | 100 / 110 / 150 / 180 ml | Implemented |
| AROMAgroup BORDO | 110 / 150 ml | Implemented |
| AROMAgroup IGRISTAYA MALINA | 110 / 150 ml | Implemented |
| AROMAgroup MAGMA | 100 / 150 / 500 ml | Implemented |
| AROMAgroup MALDIVY | 110 / 150 ml | Implemented |
| AROMAgroup TADZH MAHAL | 100 / 110 / 150 ml | Implemented |
| VELLUTIER MIDNIGHT TOAST | candle 225 / 515 g | Implemented |

No requested group was left untouched for absent evidence. Exact identities and
expected Russian suffixes are enumerated in the `const variants` array in `tests/seo-15-variant-heading.test.cjs`. No JSON fixture was created, copied or modified in this candidate.
AROMAgroup receives volume only: in particular, the MAGMA 150 ml source does not
explicitly name a cartridge, so this change makes no new type/compatibility claim.
The Vellutier source `гр` unit is normalized to `г` by the existing adapter.

## Current candidate verification (2026-10-29)

Reused code and all 35 reviewed rows from prior read-only candidate
`c16e61f8-9811-4588-a949-de9877aa9c73`; no worker allowlist or configuration edits.
Read-only comparison: 35/35 embedded rows deeply equal the prior fixture and
35/35 SKU/name pairs match the tracked snapshot, covering all 15 groups.
Current snapshot file SHA-256:
`78864784e8e4e26385576e1f48b59e0de5b58f09f63592b06a6afce117560375`.
The evidence section identifies the snapshot's recorded upstream source hash.

Actual checks in this candidate (app directory, Node v24.18.0):

- Focused five-file command recorded below: 74 passed, 0 failed, exit 0.
- In-memory baseline regression: all 35 expected headings absent before the fix.
  No temporary source file was written.
- `npm.cmd run typecheck`: exit 0. `npm.cmd run lint`: exit 0.
- `VOZDOOH_ISOLATED_BUILD=true`, `NEXT_TELEMETRY_DISABLED=1`,
  `CATALOG_PROVIDER=demo`, `npm.cmd run build`: exit 0, 21/21 static pages.
  The actual provider selector was used; no live-provider coverage is claimed.
  Generated next-env.d.ts was restored byte-for-byte and is absent from the diff.
- `npm.cmd test`: exit 1, 290 Node tests, 279 passed, 11 failed. Ten EPERM fsync
  failures arise in unchanged POSIX directory-sync persistence code. One customer
  import test expects POSIX 0600 but Windows reports 0666 (438 versus 384).
  No commercial persistence/security workaround was made. The chained exchange
  and Python stages were not reached. Linux Docker regression is separate QA.
- Initial focused invocation from repository root failed before testing because
  the relative preload was absent; the app-directory invocation passed.
- `git diff --check`: exit 0. Only the four requested source/test/report files
  are changed; no JSON, generated declarations, commercial flow or config edits.

Browser width checks and live identity checks remain unverified. Independent QA
and owner approval remain separate. No commit, push, publication or deployment.

## Prior verification record (retained for traceability)

- Baseline regression experiment loaded `git show HEAD:apps/vozdooh-commerce/src/catalog/presentation.ts`
  as a temporary sibling module: all 35 positive heading assertions failed as
  expected; temporary module removed afterward.
- Focused command: `node --require ./scripts/register-typescript.cjs --test tests/seo-15-variant-heading.test.cjs tests/product-variant-heading.test.cjs tests/aramara-variant-seo.test.cjs tests/structured-data.test.cjs`:
  **62 passed, 0 failed**.
- Each group covers positive headings/schema names, unique variant headings,
  source immutability, SKU/URL/ID, synthetic price, in-stock/out-of-stock behavior,
  missing names, changed names, different SKUs, missing sized volumes,
  conflicting values and conflicting units. Plausible slugs cannot authorize facts.
- The rendered ROSE OUD page assertion is updated to the new factual H1 while
  preserving its separate translation. Existing rendering tests exercise the
  actual product route with a fake repository.
- `npm` initially hit Windows PowerShell script execution policy; subsequent
  checks use `npm.cmd` without changing system policy.
- Final focused command additionally included `tests/presentation.test.cjs`:
  **74 passed, 0 failed**, including actual server-rendered product-page checks.
- `npm.cmd run typecheck`: exit 0. `npm.cmd run lint`: exit 0.
- `$env:VOZDOOH_ISOLATED_BUILD='true'; $env:NEXT_TELEMETRY_DISABLED='1'; $env:CATALOG_SOURCE='demo'; npm.cmd run build`:
  exit 0, Next.js 16.3.8, compiled successfully, 21/21 static pages generated.
  `CATALOG_SOURCE` is not the app's provider selector (that is `CATALOG_PROVIDER`);
  this command does not establish live-provider coverage. No live catalog was used.
  Build-generated `next-env.d.ts` route imports were restored to their baseline
  content after the check; this generated file is excluded from the review diff.
- Final `npm.cmd test`: Node suite **290 tests, 279 passed, 11 failed**, exit 1.
  Ten failures report `EPERM: operation not permitted, fsync` in
  `src/commerce/localRequestStore.ts:153` across synthetic order/mail/notification,
  payment-freshness, delivery and pickup tests. One customer-import test fails its
  POSIX file-permission assertion on Windows (`438 !== 384`, i.e. 0666 vs 0600).
  These modules were not modified. The subsequent exchange and Python commands
  were not reached because the npm script chains stages with `&&`.
  Full-suite success is therefore blocked by platform/persistence checks;
  no production or business-rule workaround was introduced.
- `git diff --check`: exit 0. All changed files are inside this app.

## Release limits

Owner-supplied provenance: authenticated production image
`sha256:0f1d06e9df6bab0b57629a44028d6fce475894bf6b6461970a4013bf88ea73fe`
carries OCI revision `b864c364b805b30a8410f44cba8bc95c1ba835f2`, and GitHub
confirms this candidate is its direct one-commit descendant. This supports
development source ancestry only; it does **not** establish byte-for-byte image
parity. These statements were supplied by the owner, not independently queried
during this offline task.

Live catalog identity/coverage, browser checks at mobile and desktop widths,
and deployment attestation remain unchecked. No CSS, motion or layout code was
changed. Independent QA must confirm current trade identities still match the
guards and inspect long headings at both widths. Review-only candidate diff;
independent QA and separate explicit owner permission are required before release.
No commit, push, merge, publish or deployment was performed.