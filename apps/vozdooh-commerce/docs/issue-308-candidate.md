# Issue #308 candidate handoff

Base: d321cfd97301270b6e374621e76d8df6e93404f5.
Original app tree: a0d3307d6e8e0903e19600654f8d039e36f600e0. Both matched before edits.
All writes stayed inside apps/vozdooh-commerce. No network, dependency installation,
secret access, security changes, commit, push, deployment or production operations.

## Implementation and acceptance

- src/catalog/tileNotes.ts: reuse verifiedNotesFor and isPubliclyPurchasable. Only
  the existing six exact evidence bindings qualify (SKU, slug, brand, category,
  accepted name and volume). No inferred notes or new claims. Display the first
  three already-reviewed displayNotes in their existing order, separated by dots.
- components/ProductCard.tsx: optional plain-text summary with a visible Russian
  notes label. Missing evidence produces no placeholder. Demo/debug suppress it.
- app/catalog/page.tsx, components/CatalogLanding.tsx and
  app/collections/[slug]/page.tsx: derive summaries on the server for main catalog,
  curated catalog, brand/category and collection tiles. Main catalog passes both
  demo and debug state to the derivation. Other card contexts retain their current
  optional-prop fallback; homepage merchandising and guide tiles are unchanged.
- app/globals.css: 14px text, 1.5 line height, ink color, natural wrapping and no
  clipping/clamping for notes. No grid, breakpoint, image, title, price, ordering,
  link, filter-query or event-handler changes. No extra focus target or tooltip.
- tests/tile-notes.test.cjs: six identity bindings, mismatches, unavailable/unpriced,
  inactive/unpictured, demo/debug, input immutability, missing-summary fallback,
  and source checks for existing links, events, title, image and price.

No trade data, evidence tables, routes, canonical metadata, sitemap, feed,
checkout, orders, payments or 1C changes. Eligibility reuses the public purchasing
predicate; image-file validation remains upstream as in the existing catalog.

## Client import investigation

ProductCard is already a client component and MerchSection also imports it from a
client boundary. Moving verifiedNotesFor directly into the card would introduce
verifiedNotes.ts and the broader fragranceFacts.ts table (17,479 source bytes
combined, not a compiled/gzip size). The chosen approach adds only an optional
summary string per qualifying tile. A recursive static trace of nine local runtime
modules from ProductCard found no verifiedNotes, fragranceFacts, tileNotes or
research imports. Existing imports were preserved. Compiled bundle size and RSC
payload size have not been measured because dependencies are absent.

## Actual local verification (Node 24.18.0)

Passed: 10 tests across tile-notes, mobile-home-layout, mobile-home-polish and
fragrance-facts; node --check tests/tile-notes.test.cjs; git diff --check.
The mobile tests inspect source; they are not browser or visual tests.

Run the dependency-free targeted set from this app using Node built-in type
stripping and a process-local extension-resolution hook (no files installed):

~~~powershell
node -e "const {registerHooks}=require('node:module');registerHooks({resolve(s,c,n){try{return n(s,c)}catch(e){if(s.startsWith('.')&&!s.match(/\.[a-z]+$/i))return n(s+'.ts',c);throw e}}});for(const f of ['tile-notes','mobile-home-layout','mobile-home-polish','fragrance-facts'])require('./tests/'+f+'.test.cjs')"
~~~

Node emitted its existing MODULE_TYPELESS_PACKAGE_JSON warning; no module settings
were changed. Initial test authoring failures were corrected and the final set
above passed. Attempts to load presentation and analytics suites failed because
TypeScript is absent. The registered npm test runner also requires TypeScript.
Full npm run verify (typecheck, lint, build and full tests), React/Next SSR tests,
and browser tests cannot run with the unavailable Windows node_modules. The
required installed Next.js guides are also absent; no framework APIs were changed.
Orchestrator must run full CI. No dependency installation or network fallback used.

Pending acceptance after CI: render eligible and ineligible catalog tiles in SSR;
verify no evidence/source documents in emitted client chunks; desktop and 320/375px
mobile checks for wrapping, zoom, focus/link activation, grid readability and no
horizontal overflow. Check screen-reader reading order (title, format, notes,
price). No animation added; reduced-motion browser testing remains unperformed.
Click/link regression checks here are source assertions, not browser execution.

## Measurement after an independently approved release

Commercial hypothesis: concise verified notes may help selection. Candlesbox DECOR
listing exposure of notes is supplied issue context only; no competitor copy or
additional research was used. There is no conversion-uplift claim.

Use existing aggregate select_item, view_item, add_to_cart, begin_checkout and paid
purchase events. No new events, identifiers or tracking. Compare the six eligible
SKU against their own preceding matched weekday periods and available unaffected
SKU, accounting for stock, prices, traffic mix and promotions. Existing events do
not provide tile impressions, so do not report tile CTR or claim causal impact.

- Day 7: check aggregate selection/detail and add-to-cart counts, missing events,
  availability changes and any readability feedback. Flag instrumentation issues.
- Day 14: compare matched periods for eligible-SKU selection and cart activity;
  use ratios only where the existing aggregate denominator is available and label
  them as event-count ratios, not unique-user conversion rates.
- Day 28: review sustained selection/cart trends plus aggregate checkout and paid
  purchase context. Shared checkout events may not attribute to a specific tile;
  report sample limitations and confounders, and retain/revise based on evidence.

Status: DONE_CANDIDATE. Local feasible checks passed; CI, SSR, compiled-bundle and
browser acceptance remain pending with the exact dependency limits above.
