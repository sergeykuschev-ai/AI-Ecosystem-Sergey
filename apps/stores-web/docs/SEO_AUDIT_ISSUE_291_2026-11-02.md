# Stores Web — SEO Audit, four Amursk stores (issue #291)

Date: 2026-11-02. Scope: `https://amurskmarket.ru` — the four stores at проспект Победы, 16, Амурск: «Ампер» (`/amper/`), «Вентиль» (`/ventil/`), «Метиз Маркет» (`/metiz-market/`), «Миска» (`/miska/`), plus their SEO category pages, city/store pages, and shared SEO infrastructure (`robots.txt`, `sitemap.xml`). Read-only audit candidate: no production changes, no deploy, no publishing, no IndexNow submissions, no tunnels.

## Evidence classes (read this first)

Facts below are explicitly separated by how they were obtained:

- **Class A — production crawl, not re-run here.** Recorded results of the anonymous read-only production crawl from `docs/AMURSK_SEO_AUDIT_2026-10-09.md` (root of the repo). This environment has no external network access, so production was not re-fetched on 2026-11-02.
- **Class B — verified locally on 2026-11-02.** The app's own code was built as a standalone production build (`CONTENT_SOURCE=mock`) and served with `next start` on `127.0.0.1:3000`; the repository's read-only audit script (`scripts/seo-audit/production.ts`, issue #85 tooling) was executed against it, plus direct page snapshots. This exercises the exact code that serves production; content values come from mock data and may differ from production values. 817/817 hard checks passed.
- **Class C — unavailable.** Yandex Webmaster and Google Search Console signals require dashboard access and are not verifiable from code or anonymous fetches. They are listed separately, not asserted.

## Verdict

No new code defects were found. Robots/sitemap discipline, HTTP statuses, canonical/noindex rules, SSR metadata, schema.org markup, internal linking, mobile rendering baseline, and product-card accessibility all pass the full audit (Class B) and match the production crawl record (Class A). The remaining gaps are data- and owner-side actions carried over from the October audit: verified geo coordinates, Yandex Business (Справ) listing, and Google Search Console validation.

## Verified facts (Class B, reproduced 2026-11-02)

Command path: `npm run build` (with `SITE_URL`/`NEXT_PUBLIC_SITE_URL`/`CONTENT_SOURCE=mock`), then `next start` on 127.0.0.1, then `AUDIT_BASE_URL=http://127.0.0.1:3000 npm run audit:seo` and page snapshots. Audit result: **817/817 hard checks passed** (1 informational note: IndexNow key route correctly returns 404 while unconfigured; nothing was submitted).

### robots.txt (`/robots.txt` → HTTP 200)

- `Allow: /` for `*` and `OAI-SearchBot`; `Disallow: /api/`, `/admin/`, `/preview/`, `/directus/`; no full-site `Disallow: /`; `*.txt` (IndexNow key file) not blocked.
- Declares `Sitemap:` on the same origin. Emits a `Host:` directive (deprecated by Yandex since 2018, ignored by Google) — harmless, optional cleanup only (see P3).
- Source: `app/robots.ts`.

### sitemap.xml (`/sitemap.xml` → HTTP 200, 49 URLs)

Breakdown by prefix: `/` 1; `/stores/` tree 6 (list + `/stores/amursk/` + 4 store pages); `/stati/` 5 (list + 4 articles); brand trees: `/amper/` 7, `/ventil/` 7, `/metiz-market/` 7, `/miska/` 9 (brand page + 6/6/6/8 SEO category pages); `/bonus/`, `/o-kompanii/`, `/kontakty/`, `/reklama/`, `/akcii/`, `/vakansii/`, `/faq/` 1 each. All URLs on the site origin, all in trailing-slash canonical form, no `/api/`, `/admin/`, `/preview/`, `/directus/`, `/_next/`, and no legal pages. This matches the production record: 49 URLs, 26 category pages, 4 articles (Class A).

### HTTP statuses and URL forms

- All sitemap URLs and all static/brand pages return 200; sampled store and category pages return 200.
- Extensionless URLs return exactly one `308` to the trailing-slash form (verified `/amper` → `308` → `/amper/`), target returns 200 with matching canonical.
- Unknown route returns 404. Legal pages (`/politika-konfidencialnosti/`, `/soglasie-na-obrabotku-dannyh/`) are `noindex` and absent from the sitemap; no accidental `noindex` on any public page.

### Store landing pages (the four audited stores)

| URL | HTTP | Title (chars) | Description (chars) | H1 | JSON-LD types |
|---|---|---|---|---|---|
| `/amper/` | 200 | «Ампер — магазин электротоваров в Амурске \| Проспект Победы, 16» (62) | 159 | «Ампер» — магазин электротоваров в Амурске | Organization, HardwareStore, BreadcrumbList |
| `/ventil/` | 200 | «Вентиль — магазин сантехники в Амурске \| Проспект Победы, 16» (60) | 151 | Сантехника, водоснабжение и отопление в Амурске | Organization, HomeGoodsStore, BreadcrumbList |
| `/metiz-market/` | 200 | «Метиз Маркет — крепёж, метизы и инструмент в Амурске» (52) | 148 | Крепёж, метизы и инструмент в Амурске | Organization, HardwareStore, BreadcrumbList |
| `/miska/` | 200 | «МИСКА ЗООМАГАЗИН — зоотовары в Амурске» (38) | 159 | Зоомагазин и зоотовары в Амурске | Organization, PetStore, BreadcrumbList |

- Every page: exactly one absolute canonical equal to its URL; `og:url` matches canonical; `og:title`/`og:description` non-empty; one `og:image` (`/opengraph-image.png`, 200, `image/png`) and a `twitter:card` — verified for all audited pages by the audit script.
- Titles/descriptions within common SERP limits (title ≤ 70, description 50–160) — no length notes emitted by the audit.
- No duplicate titles, descriptions, H1, or canonical targets across indexable pages (audit duplicate checks).
- Sampled category pages verified with the same discipline, e.g. `/amper/kabel-i-provod/` (200, title 43, description 122), `/ventil/truby-i-fitingi/` (200, 45/113), `/metiz-market/samorezy/` (200, 43/104), `/miska/korm-dlya-koshek-i-sobak/` (200, 54/93).

### schema.org details per store page (Class B values from mock data; structure is production code)

- Each store page emits a `Store` subtype node (`HardwareStore` for Ампер and Метиз Маркет, `HomeGoodsStore` for Вентиль, `PetStore` for Миска) with `PostalAddress` (locality Амурск, postal code 682643, street «проспект Победы, 16»), per-store `telephone`, `openingHoursSpecification`, `hasMap` (Yandex Maps link), and `parentOrganization` referencing the brand `Organization` `@id`.
- **No `geo` coordinates on any store node** — `latitude`/`longitude` are `null` in the data layer (`lib/data/mock-data.ts`; production record of 2026-10-09 shows the same absence). The builder emits `geo` automatically once verified coordinates exist (`lib/seo/json-ld.ts`, `createStoreNode`); per project policy it must not fabricate them.
- No unverified commerce fields anywhere: no `aggregateRating`, `review`, `offers`, or `price` (audit forbids them; JSON-LD blocks all parse).

### Internal links, local landing pages, mobile, cards

- **Internal linking:** store pages carry 45–53 internal anchors each (category grids, related categories, contacts, network cross-links via `LocalStoreNetworkLinks`, breadcrumbs); category pages 47–50. No orphaned audited pages; sitemap covers every static/brand route.
- **Local landing pages:** each brand page links its 6–8 SEO category pages and the `/stores/amursk/<store>/` page; `/kontakty/` aggregates all four stores (`ContactPage` + per-store LocalBusiness nodes) — the local-SEO hub is intact.
- **Mobile:** responsive single version (no m-dot duplicates); `<meta name="viewport" content="width=device-width, initial-scale=1">` present in SSR HTML of every audited page. Touch targets/navigation markup covered by `tests/accessibility.test.ts`; no mobile-specific SEO defect verified.
- **Product/category card accessibility:** cards render as `<article>` with `<h3><a href="…">label</a></h3>` — real crawlable anchors with readable anchor text in SSR HTML (verified in page snapshots); image alt text and heading-order rules enforced by `tests/accessibility.test.ts`, `tests/semantic-structure.test.ts`, and `tests/image-seo.test.ts`.

## Production facts not re-verified here (Class A, 2026-10-09)

- 49 sitemap URLs returned HTTP 200 on production; all had one H1, title, description, and matching canonical.
- Yandex Webmaster had verified the host and reported 29 searchable pages; status `NOT_IN_SPRAV` (Yandex Business listing not confirmed).
- Yandex Metrica counter 112116056 had 7 action goals; the advertising-lead event was not among them.
- Store JSON-LD on production included postal code 682643, opening hours, and map links, but no verified coordinates — consistent with Class B.
- To close the loop after any web deploy: run `npm run smoke:production`, then `npm run audit:seo` (live origin), per `docs/SEO_INDEXATION_AUDIT_V1_1_2026-09-10.md`.

## Unavailable data (Class C) — owner-side verification required

Not asserted as facts; requires dashboard access (see `docs/YANDEX_WEBMASTER_RUNBOOK.md`):

- Yandex Webmaster: current searchable/excluded page counts, canonical/duplicate diagnostics, region assignment (should be Амурск / Хабаровский край), sitemap fetch status, `NOT_IN_SPRAV` state.
- Google Search Console: property verification, indexing coverage, sitemap submission status — never validated (Class A follow-up item).
- Actual search performance (impressions/clicks/positions) for the four brand queries.

## Prioritized plan

1. **P1 — Add verified geo coordinates for all four stores (data, not code).**
   Evidence: no `geo` in JSON-LD on `/amper/`, `/ventil/`, `/metiz-market/`, `/miska/` (Class B snapshot; Class A 2026-10-09 record). Action: obtain verified lat/lng for the Победы, 16 storefronts, enter them in the Directus `stores` table; `createStoreNode` (`lib/seo/json-ld.ts`) emits `GeoCoordinates` automatically. Do not fabricate values.
2. **P1 — Resolve the Yandex Business (Справ) listing (`NOT_IN_SPRAV`).**
   Evidence: Class A (2026-10-09). Action (owner): claim/verify all four stores at пр. Победы, 16 in Yandex Business; align names/phones/hours with the site; re-check in Webmaster.
3. **P2 — Validate Google indexing (owner).**
   Evidence: Class A follow-up never confirmed. Action: add/verify the GSC property, submit `https://amurskmarket.ru/sitemap.xml`, review coverage for the 49 URLs, confirm no canonical/duplicate exclusions on brand and category pages.
4. **P2 — Add the advertising-lead goal to Yandex Metrica (owner).**
   Evidence: Class A — counter 112116056 lacks the lead event. Improves measurability of local landing pages; no code change required (`/api/advertising-leads` endpoint already exists and is covered by tests).
5. **P3 — Optional: drop the deprecated `Host:` directive from robots.txt (code, cosmetic).**
   Evidence: Class B robots.txt snapshot; Yandex ignores `Host` since 2018, Google never used it. Remove the `host` field in `app/robots.ts` if desired — no SEO impact either way.
6. **P3 — Standing: after the next web deploy, re-run `npm run smoke:production` and `npm run audit:seo` against the live origin** to upgrade this report's Class B/Class A split to fresh production evidence (per `docs/SEO_INDEXATION_AUDIT_V1_1_2026-09-10.md`, post-deploy actions).

No other fixes are recommended by this audit. Do not fabricate prices, inventory, reviews, ratings, or coordinates.

## Reproduce this audit

```bash
cd apps/stores-web
npm ci
SITE_URL=http://127.0.0.1:3000 NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000 CONTENT_SOURCE=mock npm run build
SITE_URL=http://127.0.0.1:3000 NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000 CONTENT_SOURCE=mock npx next start &   # 127.0.0.1:3000
AUDIT_BASE_URL=http://127.0.0.1:3000 npm run audit:seo        # expect: PASS, all hard checks
npm run audit:seo:local                                        # deterministic regression gate
npm test                                                       # full unit/integration suite
```

For a live-origin run (requires network and production access): `npm run audit:seo` with no `AUDIT_BASE_URL` override. The script is read-only: anonymous GETs, no submissions, no writes.

## Tooling results (2026-11-02, this worktree)

- `npm test`: 203/203 passed (54 suites).
- `npm run audit:seo:local`: PASS (6 deterministic SEO suites, no network).
- `npm run audit:seo` against the local standalone build: 817/817 hard checks passed, 1 informational note.
- `npm run lint`: clean (`--max-warnings=0`).
- `npm run typecheck`: clean.
- `npm run build`: succeeded (standalone, mock content).
