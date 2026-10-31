# SEO phase 2: 11 metadata descriptions (29 October 2026)

Status: review-only candidate; no commit, push, merge or deployment.
Baseline: afb3ebcb8978caed8edf2f457cd33d0c9d8a61ab (verified HEAD; initially clean).
Task: #285 under #262. Only apps/vozdooh-commerce source, tests and this report changed.

## Scope and evidence

Short descriptions are valid metadata, not technical errors. This change makes their content more useful; no ranking improvement is claimed.
Separate targeted descriptions cover the three discovery hubs and eight named collections. Meta and existing Open Graph descriptions share the new copy. Editorial collection descriptions, titles, H1, robots, canonicals, links, sitemap logic and JSON-LD remain unchanged, verified against SHA-256 hashes of the pinned source (CRLF normalized to LF).

Facts come from src/catalog/collections.ts (family, room, mood and verified external-interest rules) and src/catalog/landings.ts (formats, comparison and card guidance). No notes, stock, shipping, discounts or sales-ranking claims were added. The popular collection refers to external interest, not VOZDOOH sales.

Read-only issue #285 baseline evidence was supplied in the task: 13 brand links, 10 category links, 11 collection links, 10–54 product links on themed pages and existing ContextualCatalogLinks. No generic or additional links are needed. No links were added, so no new 404 target is introduced. The issue itself and live HTTP status were not fetched: external services are prohibited. Production HTTP 200/404 validation remains unverified; synthetic route metadata and sitemap inclusion are checked.

| Page | Description length |
| --- | ---: |
| /brands | 126 |
| /categories | 139 |
| /collections | 142 |
| /collections/bedroom | 133 |
| /collections/floral | 137 |
| /collections/focused | 136 |
| /collections/fresh-air | 134 |
| /collections/living-room | 141 |
| /collections/popular | 138 |
| /collections/warm-interior | 144 |
| /collections/woods-and-spices | 142 |

## Regression repair and validation (1 November 2026)

This candidate reproduces the failed candidate da477b78-deba-4bdf-9cfc-797f7db287b7 from pinned baseline afb3ebcb8978caed8edf2f457cd33d0c9d8a61ab. The four route files and discoveryDescriptions.ts are byte-for-byte equal to that reference; all 11 descriptions are preserved. Only the new test implementation and this report differ from the reference.

The supplied independent Linux review reported 294 tests: 293 pass, 1 fail because the metadata invariance test spawned Git in a runner without Git. The repaired test uses node:crypto with eight embedded SHA-256 hashes calculated locally from git show at the pinned commit. It reverses only metadata wiring in the four routes, then hashes the reconstructed complete source. The other four complete source files are hashed unchanged. Hash inputs are UTF-8 with CRLF normalized to LF. The test contains no Git calls or child-process import. No regression gate or runner configuration changed.

Commands below ran from apps/vozdooh-commerce with installed dependencies and synthetic data:

- node --require ./scripts/register-typescript.cjs --test tests/seo-11-meta.test.cjs tests/seo-indexing.test.cjs tests/seo-targeted-20261020.test.cjs: exit 0; 10 tests, 10 pass, 0 fail, 0 skipped.
- With PATH temporarily empty in the test process, invoked the resolved absolute Node executable with --require ./scripts/register-typescript.cjs --test tests/seo-11-meta.test.cjs: exit 0; 4 tests, 4 pass, 0 fail, 0 skipped. PATH was restored afterward; no system configuration changed.
- npm.cmd run lint: exit 0, zero warnings.
- npm.cmd run typecheck: exit 0.

An initial focused invocation from the repository root returned 9 pass, 1 fail (synthetic /collections/bedroom metadata undefined); rerunning from the documented app directory passed all 10. No source change was made to bypass that result.

Independent full Linux regression remains pending with the worker; no full-suite pass is claimed. No browser or live HTTP checks were performed. No production deployment, commit, push, merge, external service access, credentials, 1C, payment or order actions occurred. This candidate has no approved release.

- VOZDOOH_ISOLATED_BUILD=true, NEXT_TELEMETRY_DISABLED=1, CATALOG_SOURCE=demo; npm.cmd run build: exit 0; compiled successfully, TypeScript passed, 21/21 static pages generated in .next-verify. Build-generated next-env.d.ts references were restored to the pinned baseline.
- git diff --check: exit 0. Final scope: exactly seven changed/new files under apps/vozdooh-commerce.