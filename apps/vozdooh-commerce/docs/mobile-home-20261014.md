# Mobile homepage refinement — 14 October 2026

## Scope

- One verified, stocked popularity shelf instead of two overlapping merchandising shelves and duplicated editorial product cards.
- Removed back-office copy from the room, brand and selection sections.
- Compact mobile discovery: swipeable categories and room cards, shorter typography and spacing, balanced delivery / pickup benefits.
- Consistent image backgrounds for the primary merchandising shelf; product image source files remain unchanged.
- Product cards expose a visible "Смотреть аромат" cue; they remain links to existing product pages rather than unsafe nested buy controls.
- Show up to four available brand narratives on the homepage; `/brands` remains the full list.
- Existing payment, cart, fulfillment, stock selection, SEO URLs and metadata are unchanged.

## Verification

`npm run verify` from `apps/vozdooh-web`; new static homepage checks in `tests/mobile-home-layout.test.cjs` and updated evidence-shelf assertion in `tests/demand-merchandising.test.cjs`.

## Deployment safety

The current production Docker image is `vozdooh-web:seo-p1-copy-20261014` before release. Build a distinct web-only tag and change only the `web` service image in `/opt/vozdooh/runtime/compose.yml`; leave worker and volumes untouched. For rollback restore the previous image tag and recreate only `web`.
