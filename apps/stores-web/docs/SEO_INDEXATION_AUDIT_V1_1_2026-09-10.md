# Stores Web — External SEO/Indexation Audit V1.1 (issue #85)

Date: 2026-09-10. Scope: production https://amurskmarket.ru after the V1 release, limited to `apps/stores-web/**`. Read-only audit: anonymous GET requests only, no Directus/DB changes, no deploy, no IndexNow submissions. Repeatable via `npm run audit:seo` (`scripts/seo-audit/production.ts`).

## Verdict

Three verified code defects were found on production and fixed in code (see below). All other audited areas pass. A re-run of `npm run audit:seo` against production is required after the next web deploy to confirm the fixes live; the audit was re-run here against a local standalone production build (`332/332` hard checks passed).

## Defects found and fixed

### 1. Infinite 308 redirect loop on extensionless URLs (P1)

- Verified live: `GET /amper` (also `/kontakty`, `/bonus`, any extensionless public path) returned `308` with `Location: /amper` — no trailing slash — looping forever (`/amper` → `/amper` → …). Search bots hit this on every non-canonical URL form.
- Cause: `proxy.ts` built the redirect target by mutating `request.nextUrl` (a `NextURL`). In Next 16 the `NextURL` pathname setter silently drops the assigned trailing slash, so the proxy redirected every request to the same extensionless path. Verified locally on both `next dev` and the standalone production build before the fix.
- Fix: `proxy.ts` now builds the target with the standard `URL` constructor (`new URL(\`${pathname}/\`, request.url)`), which preserves the trailing slash. After the fix: `/amper` → `308` → `/amper/` → `200`; `/api/*` and asset paths pass through untouched.
- Regression tests: `tests/seo-routes.test.ts` ("trailing-slash proxy") executes the real proxy and asserts single-redirect targets and pass-through behavior.

### 2. `og:image` missing on every page except home (P2)

- Verified live: `/` emitted `og:image` (from the root `opengraph-image.png` file convention), but all brand pages, `/stores/`, `/akcii/`, `/bonus/`, `/vakansii/`, `/o-kompanii/`, `/kontakty/`, `/faq/` and city/store pages emitted no `og:image` at all (only `twitter:card=summary` without an image).
- Cause: Next does not inherit a file-based Open Graph image into child segments that define their own `openGraph` metadata — every page defines `openGraph` through `createPageMetadata`, so only the root segment kept the file-based image.
- Fix: `createPageMetadata` (`lib/seo/metadata.ts`) now attaches the shared image explicitly (`DEFAULT_OG_IMAGE_PATH`, `DEFAULT_OG_IMAGE_ALT`) to every page. Verified: exactly one `og:image` (with Russian `alt`) on every public page, including legal pages; the explicit metadata cleanly replaces the file-based tag on home (no duplicates). Next also derives `twitter:image` from it.
- Regression test: `tests/seo-routes.test.ts` ("default Open Graph image").

### 3. City page `/stores/amursk/` rendered no JSON-LD (P2)

- Verified live and locally: the city page had no `ld+json` blocks at all, while the same stores were described as a `LocalBusiness` graph on `/kontakty/` and per-store pages. The city page is a primary local-SEO landing page listed in the sitemap.
- Fix: `app/stores/[city]/page.tsx` now renders `createStoresJsonLd(stores, brands, city)` through the existing `JsonLd` component — the same verified builder the contacts page uses; no new structured-data shapes were introduced.
- Regression test: `tests/seo-routes.test.ts` ("city page structured data").

No other code defects were verified. Business content (promotions, vacancies, store facts) was not touched.

## Areas audited that pass (production, 2026-09-10)

- **Status codes**: all canonical public pages (home, four brand pages, `/stores/`, city and store pages from the sitemap, `/akcii/`, `/bonus/`, `/vakansii/`, `/o-kompanii/`, `/kontakty/`, `/faq/`) return 200; unknown routes return 404.
- **Sitemap/robots consistency**: `/sitemap.xml` is on the site origin, covers every static and brand route plus active city/store routes, excludes legal and private paths, and all entries use the trailing-slash canonical form. `/robots.txt` allows `/`, disallows `/api/`, `/admin/`, `/preview/`, `/directus/`, `/_next/`, keeps `OAI-SearchBot` unblocked, does not block `*.txt` (IndexNow key reachable), and declares `Sitemap: https://amurskmarket.ru/sitemap.xml` on the same origin.
- **Canonical URLs**: every audited page has exactly one absolute canonical link matching its trailing-slash URL; `og:url` matches the canonical.
- **Metadata**: every public page has a non-empty title, description, `og:title`, `og:description` (length notes below); Open Graph locale `ru_RU`, `siteName` present.
- **JSON-LD**: `WebSite` + per-brand `Organization` graph on home; `Organization` on brand pages; `ContactPage` + `LocalBusiness` graph on contacts; `AboutPage` on `/o-kompanii/`; `FAQPage` on `/faq/`; store `LocalBusiness` subtypes (`HardwareStore`, `PetStore`, `HomeGoodsStore`) with address/geo/opening hours and `BreadcrumbList` on store pages; all blocks parse as valid JSON (no fabricated ratings/reviews/offers).
- **noindex discipline**: no accidental `noindex` on any public page; both legal placeholders (`/politika-konfidencialnosti/`, `/soglasie-na-obrabotku-dannyh/`) are `noindex, nofollow` and absent from the sitemap.
- **Duplicates**: no duplicate titles or descriptions across indexable pages (after fix 2; the pre-fix duplicate report was an audit-script artifact).
- **IndexNow readiness**: no code path auto-submits; the key route returns 404 while unconfigured (verified with a random key probe — nothing guessable is exposed); `INDEXNOW_KEY`/`INDEXNOW_ENDPOINT` remain server-only env; no fake URLs were submitted during this audit.

## Informational notes (non-blocking, owner decisions)

- `/kontakty/` description is 168 chars; `/amper/` 163; `/ventil/` 161; `/miska/` 200; `/metiz-market/` title is 74 chars — slightly beyond common SERP display limits. These are approved business texts; shortening is a content-owner decision, not changed here.

## Post-deploy actions (required to close the loop)

1. Deploy web-only per `docs/WEB_ONLY_DEPLOY.md` (no Directus/DB steps).
2. Run `npm run smoke:production` — all checks must pass.
3. Run `npm run audit:seo` — all hard checks must pass (defects 1–3 above must be gone on the live origin).

## Yandex Webmaster owner checklist (requires dashboard access)

Indexing state and search-console signals cannot be verified from code; the site owner should check in [Yandex Webmaster](https://webmaster.yandex.ru):

1. Add/verify `https://amurskmarket.ru` (and the `www` host if DNS answers) — check that the https non-www version is the main mirror; if `www` responds, set the preferred host and ensure it 301-redirects to the non-www origin.
2. Submit `https://amurskmarket.ru/sitemap.xml` in "Indexing → Sitemap files" and confirm "OK" status without errors after the next deploy.
3. "Diagnostics" → confirm no critical errors, no "page is a duplicate/canonical differs" mass warnings for brand/city/store pages, and that `robots.txt` is fetched successfully.
4. Check "Excluded pages" for accidental noindex/redirect-loop exclusions — after this audit's fix, extensionless URLs must appear as "Redirected page" (single hop), not errors. If the redirect loop was live long enough for Yandex to record errors, use "Re-crawl" on the affected canonical pages.
5. "Search queries / Statistics" — attach the Yandex Metrica counter (already on pages) to Webmaster for query data.
6. Region: assign the site region to Amursk/Khabarovsk Krai in "Settings → Region" (helps local queries for the four store brands).
7. If/when IndexNow is enabled (set `INDEXNOW_KEY`, key file served at `/{key}.txt`), submit a few real changed URLs once to verify acceptance, then rely on the future Directus webhook path — never bulk-submit unchanged URLs.
8. Monitor Core Web Vitals ("Diagnostics → Quality indicators") after deploy; the local standalone build renders full metadata for all routes.

## Tooling results

- `npm test`: 94/94 passed (31 suites).
- `npm run lint`: clean (`--max-warnings=0`).
- `npm run typecheck`: clean.
- Hermetic `npm run build` (`CONTENT_SOURCE=mock NEXT_PUBLIC_SITE_URL=...`): succeeded; 13 static pages.
- `npm run audit:seo` against a local standalone production build: 332/332 hard checks passed, 6 informational notes.
- Secret scan over the changed files: clean (no keys/tokens/PEM patterns; audit script sends anonymous GETs only).
- `git diff --check`: not run here (git operations are handled outside this audit); the changed files contain no trailing whitespace.
