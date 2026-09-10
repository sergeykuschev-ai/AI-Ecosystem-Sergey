# Analytics: Yandex Metrica goals

The site measures which on-site actions lead to store contact. Tracking goes through the provider-neutral boundary in `lib/analytics/`: components call `trackEvent` (or render `TrackedLink`), and the active adapter forwards events. `components/analytics/AnalyticsProvider.tsx` installs the `YandexMetrikaAdapter` on the client; the counter itself is loaded once by `components/analytics/YandexMetrika.tsx` using the same counter ID from `lib/analytics/yandex-metrika.ts` (`YANDEX_METRIKA_COUNTER_ID`).

If `window.ym` is missing (ad blocker, slow script, server rendering), events are silently skipped — no errors are thrown and the UI keeps working.

## Goal names

Create goals of type «JavaScript event» in Yandex Metrica with exactly these identifiers:

| Goal name       | Fired when                                                        | Params (no personal data)                     |
| --------------- | ----------------------------------------------------------------- | --------------------------------------------- |
| `click_phone`   | Any `tel:` link is clicked (cards, contacts, buttons)             | `brand`, `store`, `city` when known           |
| `click_route`   | A map/route link opens («Показать на карте», «Построить маршрут») | `brand`, `store`, `city`, `source` when known |
| `store_open`    | A user follows a link to a store page (`/stores/{city}/{store}/`) | `city`, `store`, `brand`                      |
| `brand_open`    | A user follows a link to a brand landing page (`/{brand}/`)       | `brand`                                       |
| `promotion_open`| A user opens a promotion (nav «Акции», promotion cards/slides)    | `item` (actual item id) or `source: "nav"`    |
| `bonus_open`    | A user opens the bonus program (nav «Бонусы», bonus cards/slides) | `item` or `source: "nav"`                     |
| `vacancy_open`  | A user opens vacancies (nav «Вакансии», vacancy cards/slides)     | `item` or `source: "nav"`                     |
| `click_messenger` | Reserved: fires on messenger link clicks once messenger links are rendered | `brand`, `store` when known         |
| `check_stock`   | Reserved for a future stock-check interaction                     | —                                             |

Reserved goals are declared in `lib/analytics/index.ts` but are not wired to any UI yet. Wire them through the same boundary when the interaction appears.

## Privacy rules

- Payloads contain only stable identifiers: entity slugs, entity ids, and the click source. No names, no phone numbers, no form contents, no free-text values.
- Nothing is tracked on the server; all events are client-side click goals.

## Adding a new goal

1. Add the event name to `analyticsEvents` in `lib/analytics/index.ts`.
2. Use `TrackedLink` (for links rendered by Server Components) or `trackEvent` (inside Client Components).
3. Document the goal name and params in the table above and create the matching goal in Yandex Metrica.
