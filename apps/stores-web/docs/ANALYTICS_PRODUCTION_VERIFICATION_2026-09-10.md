# Analytics production verification — 2026-09-10

Verification of Yandex Metrika tracking for `apps/stores-web` after the V1 release
(https://amurskmarket.ru). Code-side and read-only: no dashboard settings were
changed, no production writes were made. See `docs/ANALYTICS.md` for the general
tracking design.

Method: code review of the analytics boundary plus an anonymous read-only fetch of
the production HTML (the same approach as `scripts/smoke/production.ts`).

## Verified findings

| Check | Result | Evidence |
| --- | --- | --- |
| Counter 112116056 loads once | PASS | Production HTML contains exactly one `mc.yandex.ru/metrika/tag.js` loader; the inline snippet keeps the built-in duplicate guard (`document.scripts` scan); the component is mounted once in `app/layout.tsx` |
| Initial pageview / SPA navigation | PASS | The counter initializes without `defer: true`, so the regular tag records the initial pageview automatically; `components/analytics/YandexMetrika.tsx` skips its first pathname effect and sends `hit` only on later SPA pathname changes, avoiding a duplicate initial pageview |
| `reachGoal` wiring for all 7 goals | PASS | `click_phone`, `click_route`, `brand_open`, `store_open`, `promotion_open`, `bonus_open`, `vacancy_open` are all fired through `TrackedLink`/`trackEvent` (see `docs/ANALYTICS.md` table for firing locations); `tests/analytics.test.ts` asserts each goal name reaches `ym(112116056, "reachGoal", …)` |
| Duplicate suppression | PASS | Only an identical event+payload within `ANALYTICS_DEDUPE_WINDOW_MS` (1 s) is suppressed; a later click or a different payload fires again. Regression test: "fires an identical event+payload again after the dedupe window" |
| No PII in payloads | PASS | Payloads carry only entity slugs, entity ids, and a click `source` label. No names, phone numbers, form contents, or free text |
| Failures cannot block navigation/UI | PASS | `trackEvent` and `YandexMetrikaAdapter.track` both isolate the counter call in `try/catch`; a missing or blocked `window.ym` is a silent no-op. Covered by "never throws" adapter tests |

## Owner checklist — Yandex Metrika UI (cannot be verified from code)

Do these in the Yandex Metrika web interface for counter 112116056:

- [ ] Create one «JavaScript event» goal per active identifier, names exactly:
  `click_phone`, `click_route`, `brand_open`, `store_open`, `promotion_open`,
  `bonus_open`, `vacancy_open` (7 goals). Reserved `click_messenger` and
  `check_stock` need no goal until wired to UI.
- [ ] Open the counter's real-time report, load the site, and confirm a single
  pageview per load and one additional pageview per SPA transition (no doubles).
- [ ] Click each tracked element once (phone, route, store card, brand card,
  «Акции», «Бонусы», «Вакансии» nav) and confirm the matching goal fires once in
  the real-time conversions report.
- [ ] Click the same element twice more than 1 second apart and confirm both
  clicks convert (dedupe window is intentionally 1 s).
- [ ] Confirm Webvisor and clickmap recordings work with the current init options.
- [ ] After ~1 week, compare goal conversions against plausible real traffic;
      investigate any goal at exactly 0 or suspiciously inflated.

## UTM convention recommendation (future ads / QR links)

Yandex Metrika captures UTM parameters automatically on the first hit of a visit.
Recommended convention for any future paid or printed links — business content of
pages stays unchanged:

- `utm_source` — the platform: `yandex`, `vk`, `telegram`, `qr`, `2gis`, `offline`.
- `utm_medium` — the channel type: `cpc` (paid click), `organic_social`, `qr`,
  `referral`, `print`.
- `utm_campaign` — a lowercase slug with dates, e.g. `bonus_launch_2026_09`,
  `akcii_autumn_2026`.
- `utm_content` — creative/variant discriminator when several links share the rest.
- `utm_term` — reserved for paid keyword reporting; omit otherwise.

Examples:

- Printed QR on a receipt: `https://amurskmarket.ru/?utm_source=qr&utm_medium=print&utm_campaign=bonus_leaflet_2026_09`
- Paid search banner: `https://amurskmarket.ru/bonus/?utm_source=yandex&utm_medium=cpc&utm_campaign=bonus_launch_2026_09&utm_content=banner_a`

Never put personal data (names, phone numbers, bonus card numbers) in UTM values
or any analytics payload.

## How to re-verify

```bash
cd apps/stores-web
npm test            # analytics boundary, dedupe, failure isolation, counter id
npm run lint && npm run typecheck
CONTENT_SOURCE=mock NEXT_PUBLIC_SITE_URL=https://stores-ci.example npm run build
npm run smoke:production   # read-only production page/markers check
```
