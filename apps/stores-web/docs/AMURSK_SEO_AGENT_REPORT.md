# AmurskMarket — Autonomous Local SEO Hardening (issue #195)

Date: 2026-09-29
Scope: `apps/stores-web` only. No deploy, no merge, no IndexNow submissions, no Yandex Webmaster/Business mutations. Single-worker run; no lock files were needed or created.

## Verified facts used

- City: Амурск, Хабаровский край, Россия.
- Business address (correct form): пр. Победы, 16, Амурск — rendered in copy as «проспект Победы, 16» and stored in content data as «г. Амурск, проспект Победы, 16». Both forms denote the same address; no conflicting or wrong address was found anywhere in the app.
- Four published brand directions: «Ампер», «Вентиль», «Метиз Маркет», «Миска», all trading at the shared address.
- Store records (address, telephones, opening hours) come from the existing content layer (mock/Directus); nothing was invented.

## Audit summary

The codebase already carried strong technical/local SEO (metadata helper with canonical URLs and shared `og:image`, sitemap covering all routes, robots rules, trailing-slash proxy, LocalBusiness JSON-LD on contacts/city/store pages, 25 registry-driven commercial category landings, internal-linking and semantic-structure regression suites). The audit confirmed all of that still holds and found four safe hardening gaps, fixed below. No prices, stock, assortment, reviews, rankings, demand numbers, business history, or claims were added, changed, or removed. KPI/business logic was not touched.

## Changes made

### 1. Structured local business data — verified NAP on brand Organization nodes

- `lib/seo/json-ld.ts`: `createOrganizationsJsonLd(brands, context?)` now accepts an optional `{ stores, cities }` context. When a brand's active stores unambiguously agree on one address and one telephone, the `Organization` node gets a schema.org `PostalAddress` (locality/region/country from the city record, street address from the store record) and `telephone`. Conflicting or missing data omits the field instead of guessing. The address construction is shared with the existing store-node builder (`buildPostalAddress`), so one canonical address shape is emitted everywhere.
- Wired with real data on: home (`app/page.tsx`), brand landing pages (`components/brand/BrandLandingPage.tsx`), all four SEO category page components (`components/{amper,ventil,miska,metiz-market}/*SeoCategoryPage.tsx`), and store detail pages (`app/stores/[city]/[store]/page.tsx`).
- Store detail pages additionally now render their brand `Organization` node, so the store's `parentOrganization.@id` reference resolves on the same page instead of dangling.

### 2. Metadata — explicit Twitter Card on every page

- `lib/seo/metadata.ts`: `createPageMetadata` now emits `twitter:card=summary_large_image` with the same title/description and the shared Open Graph image (`/opengraph-image.png` with Russian alt, 1200×630). Next previously derived Twitter tags only incidentally; they are now declared explicitly and version-independent.

### 3. Internal linking / breadcrumbs alignment

- `app/o-kompanii/page.tsx` and `app/stores/page.tsx`: added the shared `Breadcrumbs` component (visible trail + `BreadcrumbList` JSON-LD), matching every other content page.
- `app/kontakty/page.tsx`: replaced the invisible raw `BreadcrumbList` script with the shared visible `Breadcrumbs` component — the structured data is identical, now with a crawlable visible trail back to the home page.

### 4. Regression tests

- `tests/json-ld.test.ts`: new tests assert the Organization graph carries the verified address/telephone per brand when context is provided, omits NAP without context or on conflicting addresses, and still contains no fabricated ratings/reviews/offers.
- `tests/seo-routes.test.ts`: new tests assert the large-image Twitter Card on the metadata helper and on all indexable static pages.
- `tests/local-seo.test.ts`: updated the contacts breadcrumb assertion for the visible component and added breadcrumb assertions for `/o-kompanii/` and `/stores/`.

## Validation (all run in this environment)

- `npm test`: 186/186 passed, 51 suites (was 181/181 before; +5 new tests).
- `npm run audit:seo:local` (hermetic SEO regression gate, no network): PASS, 90/90 across the six SEO suites.
- `npm run lint`: clean (`--max-warnings=0`).
- `npm run typecheck`: clean.
- Hermetic `npm run build` (`CONTENT_SOURCE=mock`): succeeded, 13 static routes.
- Standalone-build render check (local server, `SITE_URL=https://stores-test.local`):
  - `/amper/`, category page, `/o-kompanii/`, `/kontakty/`, `/stores/amursk/amper-amursk/`, `/` all return 200.
  - All four brand `Organization` nodes on home carry «г. Амурск, проспект Победы, 16» and the brand telephone.
  - Store page emits `HardwareStore`/`PetStore`/etc. node, the resolvable parent `Organization`, and `BreadcrumbList`.
  - `twitter:card=summary_large_image` with image/alt renders on brand and category pages.
  - Extensionless `/amper` still returns a single 308 to `/amper/`.
- `git diff --check`: not run here by design (git operations are handled outside this worker); an equivalent scan of every changed file found no trailing whitespace and no conflict markers.

## Deliberately excluded

- No new SEO category/landing pages: the existing 25 registry pages already cover the verified purchase intents, and the project guide warns against doorway pages that cannot be backed by verified commercial facts.
- No sitemap `lastModified` for static routes: real modification times are not knowable at build time and must not be fabricated.
- No changes to robots rules, canonical policy, sitemap membership, promotions/vacancy/bonus content, prices, stock, or assortment.
- No Directus schema/seed/production-data changes; production reads Directus, and all changes above are code-level and data-driven.
- No IndexNow submissions and no Yandex Webmaster/Business mutations.

## Remaining blockers (require actions outside this task)

1. Deploy web-only per `docs/WEB_ONLY_DEPLOY.md`, then re-run `npm run smoke:production` and `npm run audit:seo` against production to confirm the new structured data and Twitter Card tags live.
2. Yandex Webmaster owner checklist from `docs/SEO_INDEXATION_AUDIT_V1_1_2026-09-10.md` still applies (sitemap resubmission, region assignment, diagnostics review).
3. SERP-facing texts that were already long before this change (`/metiz-market/` title 74 chars, `/miska/` description 200 chars) remain content-owner decisions.
