# Stores Web — Final Pre-Release Audit V1 (issue #81)

Date: 2026-09-10. Scope: `apps/stores-web/**` after issue #76. Read-only audit: no business content changes, no Directus/DB changes, no deploy.

## Verdict

No verified P0/P1 defects. No code changes were required. All checks below were run in this environment and passed.

## Checks performed

### Routes, canonical URLs, sitemap, robots, metadata, JSON-LD

- Public routes: `/`, `/stores/`, `/akcii/`, `/bonus/`, `/vakansii/`, `/o-kompanii/`, `/kontakty/`, `/faq/` plus canonical brand routes `/amper/`, `/ventil/`, `/metiz-market/`, `/miska/` and dynamic `/stores/[city]/`, `/stores/[city]/[store]/`. The link-integrity test derives the route set from `app/` and fails on drift (`tests/link-integrity.test.ts`).
- Trailing-slash canonicalization: `next.config.ts` has `trailingSlash: true` + `skipTrailingSlashRedirect: true`; `proxy.ts` 308-redirects extensionless non-slash URLs. Verified live: `/amper` → 308 `/amper/`; unknown route → 404.
- Every page uses `createPageMetadata` with `alternates.canonical` and matching `openGraph.url`; legal pages (`/politika-konfidencialnosti/`, `/soglasie-na-obrabotku-dannyh/`) are `noindex, nofollow` (verified in rendered HTML).
- `sitemap.xml` covers all static routes, active brand/city/store routes, and stays on the configured site origin; `robots.txt` disallows `/api/`, `/admin/`, `/preview/`, `/directus/`, `/_next/` and declares the sitemap on the same origin. Covered by `tests/seo-routes.test.ts`.
- JSON-LD: `WebSite` + `Organization` graph on the home page, per-brand `Organization` on brand pages, `LocalBusiness`/`PetStore`/`HardwareStore`/`HomeGoodsStore` with address/geo/opening hours on store pages, `BreadcrumbList`, `ContactPage`, `AboutPage`, `FAQPage`. Verified via `tests/json-ld.test.ts`; `<` is escaped in serialized JSON-LD.

### Accessibility

- Regression coverage in `tests/accessibility.test.ts`: labelled nav landmarks, single `h1` in `main`, native `details/summary` accordions, named carousel controls with arrow-key support and `aria-current` dots, non-empty image `alt`, decorative arrows hidden, WCAG AA contrast computation for brand accent colors (including the light-yellow Amper palette), skip link with focusable `#main-content` target, `aria-hidden` breadcrumb separators.
- Manual review found no obvious keyboard/focus/ARIA defects: mobile menu uses native `details`, error/not-found pages expose real buttons/links, the slider pauses on hover/focus/reduced-motion.

### Links, tel/map links, analytics

- Internal links: automated checks confirm every literal and templated internal `href` resolves to a known route with exactly one trailing slash; in-page anchors reference existing ids.
- `tel:` links are built only from normalized phone values (`tests/link-integrity.test.ts` enforces the pattern).
- Map links are `https://yandex.ru/maps/...` with a non-empty `text` query and open with `rel="noopener noreferrer"`.
- Analytics: `lib/analytics/index.ts` declares 9 stable event identifiers: 7 are currently wired to real UI interactions and 2 (`click_messenger`, `check_stock`) are reserved for future UI. `store_open` is limited to specific store links, `brand_open` is wired on brand cards/navigation, and identical event+payload repeats are deduplicated within the configured window. Metrika counter init skips the first pathname effect to avoid double-counting the initial pageview; SPA navigations fire a single `hit`. Counter ID is a public metrica ID, not a secret.

### Directus/API failure behavior

- `lib/directus/client.ts` requires `CONTENT_SOURCE` in production and throws on upstream HTTP/network errors; mock fallback exists only for `CONTENT_SOURCE=mock` or non-production default. Enforced by `tests/error-resilience.test.ts` (rejects on 5xx, network failure, unsupported source; asserts tokens never leak from error messages or API bodies).
- Public API routes are read-only GET; `/api/[resource]` maps upstream failures to 503 `UPSTREAM_UNAVAILABLE`; `/api/assets/[id]` validates UUIDs and proxies read-only with immutable caching. `tests/directus-readonly.test.ts` scans runtime sources for non-GET methods and Directus mutation helpers.

### Secrets, writes, schema/seed

- Secret scan (key/token/JWT/PEM patterns) over app sources: clean. Only `.env.example` with placeholders; no `.env` in the app directory; compose files reference env variables only.
- No runtime writes to Directus/DB; schema/seed scripts are separate opt-in npm scripts not invoked by the app, CI, or the deploy path.

### Deploy workflow and smoke coverage

- `.github/workflows/stores-web-ci.yml` remains web-only: checkout, setup-node, `npm ci`, `npm test`, lint, typecheck, hermetic build (`CONTENT_SOURCE=mock`). No deploy job, no Directus/DB steps.
- `scripts/deploy/deploy-web.sh` rebuilds and recreates only the `web` compose service, asserts config/data dirs are untouched, makes a rollback backup, and never runs seed/schema steps.
- `scripts/smoke/production.ts` covers all required endpoints: home, 4 brand pages, kontakty, bonus, akcii, vakansii, faq, o-kompanii, city stores, sitemap, robots, opengraph image, `/api/health`. Verified end-to-end in this environment against a locally built standalone server with mock content: 15/16 passed; the single "failure" was the origin-specific sitemap marker (`https://amurskmarket.ru/`) because the local build was baked with `NEXT_PUBLIC_SITE_URL=https://stores-ci.example` — the sitemap correctly emits the configured origin. Canonical link, og:url, noindex robots meta, 308 trailing-slash redirect, 404 handling, and the `/api/brands` read endpoint were all verified live.

### Tooling results

- `npm test`: 89/89 passed (29 suites).
- `npm run lint`: clean (`--max-warnings=0`).
- `npm run typecheck`: clean.
- Hermetic `npm run build` (`CONTENT_SOURCE=mock NEXT_PUBLIC_SITE_URL=https://stores-ci.example`): succeeded; 13 static pages generated.
- `npm audit`: 0 vulnerabilities.
- `git diff --check`: not run here (git operations are handled outside this audit); the audit report itself contains no trailing whitespace.

## Residual notes (non-blocking)

- During a Directus outage, dynamic pages fail visibly through the error boundary instead of serving stale or mock content; this is the intended fail-visible behavior.
- `npm ci` prints an npm upgrade notice (11.16.0 → 12.0.2); informational only.
