# Ozon Bank Acquiring Compliance Audit — VOZDOOH (issue #190)

Date: 2026-09-28. Scope: `apps/stores-web` on the Kimi worktree. Auditor: Kimi worker agent.
Requirements source: owner-supplied Ozon Bank checklist dated 28.09.2026 (issue #190).

Verdicts: **PASS** — implemented and verified in this repository; **OWNER INPUT REQUIRED** — the site is honest about a gap that only the owner can close; **LAUNCH BLOCKER** — an operational change outside this repository's code that must happen before Ozon can inspect the site.

## 1. Company information on site (name, address, phone, country)

- **PASS (partial)** — `/rekvizity/` (`app/rekvizity/page.tsx`) publishes the seller name (Индивидуальный предприниматель Кущев Сергей Васильевич), trade name (VOZDOOH), country of registration (Россия), city (Хабаровск), email and phone from the single source of truth `lib/vozdooh/merchant.ts`. The same block is repeated on `/kontakty/`.
- **OWNER INPUT REQUIRED** — registration address, ИНН, ОГРНИП and bank account are deliberately not invented. The page names them as pending publication (`VOZDOOH_PENDING_REQUISITES` in `lib/vozdooh/merchant.ts`). Owner must supply: registration (legal) address, ИНН, ОГРНИП, bank requisites. Ozon will ask for these during compliance review.

## 2. No links/banners to illegal or prohibited resources

- **PASS** — the site has no third-party advertising banners. A full grep of `app/`, `components/` and `lib/data/` found no external `http(s)` content links beyond excluded schema/namespace URIs. The link-integrity suite (`tests/link-integrity.test.ts`, part of `npm run audit:seo:local`) passes: 95/95 checks, verdict PASS.

## 3. Payment-system logos must be official and non-misleading

- **PASS (not applicable)** — `public/` contains only brand logos (`brands/`), promo images (`actual/`), favicon and the Yandex verification file. No payment-system logos are displayed anywhere, so nothing can mislead buyers about who operates the business. Do not add payment logos until acquiring is approved and official assets are supplied by the bank.

## 4. Every product/service has description, price, characteristics

- **PASS (nothing offered yet)** — the site has no catalog and sells nothing: VOZDOOH is pre-launch and every store page says so. There are no product pages with missing prices/descriptions. When the catalog launches, each product card must carry description, characteristics and price (owner/CMS responsibility). No dead or placeholder product claims exist now.

## 5. Detailed description of the payment process

- **PASS** — `/oplata/` (`app/oplata/page.tsx`) gives a numbered payment flow: order → redirect to Ozon Bank's protected payment page → card entry on the bank's page only → 3-D Secure confirmation → result return → receipt → order fulfilment. It states only methods being connected (Ozon Bank internet acquiring; Ozon Bank Online Receipts planned) and explicitly says no money is collected today. Wording is marked as pending acquiring approval — the bank may request edits during review.

## 6. Delivery/fulfilment methods and timeframes

- **PASS (partial)** — `/dostavka/` (`app/dostavka/page.tsx`) lists both planned methods (Ozon Доставка across Russia — application under review; Yandex express for Khabarovsk — planned), the post-payment fulfilment sequence, and a contact route if a shipped order stalls.
- **OWNER INPUT REQUIRED** — delivery prices, timeframes and service geography are unknown until carrier contracts are signed; the page commits to publishing them before sales start. Owner must supply final delivery tariffs and timeframes once Ozon Delivery approves the application.

## 7. Information about cooperation with the Bank and anti-fraud protection

- **PASS** — `/oplata/` section «Защита покупателей и противодействие мошенничеству» states truthfully that payment processing will be performed by Ozon Bank under the acquiring agreement being concluded, describes bank-side anti-fraud monitoring, 3-D Secure issuer confirmation, HTTPS on all pages, receipt issuance, and that the store never sees or stores card data. It does not claim the service is approved or live.

## 8. HTTPS on all payment pages, certificate not below SSL123, auth protection

- **PASS (config) / LAUNCH BLOCKER (operation)** — the repository has no accounts, registration or authentication at all (V1 is informational only), so the password-guessing protection clause is not applicable today; if auth is ever added, rate limiting and anti-enumeration controls become mandatory.
- Production terminates TLS in Caddy (`Caddyfile`, `compose.production.yml`) with automatic ACME certificates for `amurskmarket.ru`; `www` 301-redirects to the apex. Caddy's automatic HTTPS issues a trusted domain-validated certificate, the modern equivalent of the "SSL123" class; Ozon requires a trusted certificate, not that specific brand.
- App-level hardening added in this change: `Strict-Transport-Security: max-age=31536000; includeSubDomains` on all responses (`next.config.ts`), security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`), `poweredByHeader` off.
- **Before Ozon inspection, the owner/operator must verify on the live host:** certificate is issued and valid, `https://` responds 200 on every page linked from the footer, and no HTTP downgrade path exists. If any Basic Auth/password protection was enabled outside the repository (e.g. at the hosting layer), it must be removed for the review — no such protection exists in this repository and none was added or removed by this change.

## 9. All content/pages/links correct and working

- **PASS** — `npm test` (191 tests, incl. `tests/vozdooh-compliance.test.ts` and `tests/link-integrity.test.ts`), `npm run lint`, `npm run typecheck`, `npm run build` (all 23 routes generated, including `/rekvizity/`, `/oplata/`, `/dostavka/`, `/vozvrat/`, `/oferta/`, `/polzovatelskoe-soglashenie/`, `/politika-konfidencialnosti/`) and the hermetic SEO regression gate `npm run audit:seo:local` (95/95, verdict PASS) are green.

## Ozon recommendations

- Second-level domain: **PASS** — production origin is `amurskmarket.ru` (apex; `www` redirects).
- Russian-language site: **PASS** — all VOZDOOH pages and the whole UI are Russian.
- Offer, user agreement, privacy policy, company requisites: **PARTIAL / OWNER INPUT REQUIRED** — all four exist and are linked from the site footer (`components/layout/Footer.tsx`) and cross-linked: `/oferta/`, `/polzovatelskoe-soglashenie/`, `/politika-konfidencialnosti/` are published as clearly marked **drafts** (`noindex`, excluded from `sitemap.xml`, status badge «Проект») pending owner legal approval; `/rekvizity/` is indexable but missing the registration details listed in item 1. The personal-data consent page `/soglasie-na-obrabotku-dannyh/` is an honest placeholder with no fabricated text. Owner must approve final legal texts; after approval, remove `noIndex` from the three draft pages and add them to `sitemap.ts`.

## robots / noindex / canonical state

- `/robots.txt` (`app/robots.ts`) allows crawling of all public pages, disallows only `/api/`, `/admin/`, `/preview/`, `/directus/`, and points to the sitemap.
- Canonical URLs are absolute and self-referencing on every page via `createPageMetadata`; the SEO suites assert canonical uniqueness and origin.
- Draft legal pages are intentionally `noindex` until approved (see above); nothing else carries `noindex`.

## Exact owner input still required (nothing below may be invented by the agent)

1. Registration (legal) address, ИНН, ОГРНИП, bank requisites → for `/rekvizity/`.
2. Final approved texts: public offer, user agreement, privacy policy (drafts are live now); approved personal-data consent text.
3. Delivery prices, timeframes, geography once carriers approve → for `/dostavka/`.
4. Confirmation of the final support phone (the published +7 924 419-99-90 is temporary per owner).
5. Confirmation that HTTPS on the live host is serving a valid trusted certificate and that no out-of-repo password protection blocks inspection.

## Reproducing the checks

```bash
cd apps/stores-web
npm run lint && npm run typecheck && npm test
npm run audit:seo:local
NEXT_PUBLIC_SITE_URL=https://amurskmarket.ru CONTENT_SOURCE=mock npm run build
```
