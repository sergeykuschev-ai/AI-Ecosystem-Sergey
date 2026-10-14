# Catalog search — 14 October 2026

The catalog has a visible GET search form using `/catalog?q=...`. It matches literal substrings in the 1C product name, brand and SKU, ignoring case and normalizing Unicode and whitespace. Empty search leaves the current selection unchanged. Search operates after source availability, image validation, storefront exclusions and selected filters; it never expands the public selection.

Search submission preserves validated filters. Filter submission and individual filter removal preserve search. “Сбросить поиск” removes only search; “Сбросить всё” clears both. The canonical remains `/catalog`. Every URL containing `q`, including an empty query, receives `noindex`; normal catalog indexing retains the production setting.

Run `npm run verify`. The opt-in `scripts/verify-catalog-search-browser.cjs` checks actual visible inventory, brand/name/SKU searches, empty results, filter preservation, reset, canonical, robots and layout at 390px and 1280px. Set `VOZDOOH_QA_URL`, `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH`; optional `VOZDOOH_QA_PROXY` uses the existing German proxy. It blocks external resources and all non-GET requests.

Release changes only the web image in the existing compose. Preserve the running pickup image and full compose in `/opt/vozdooh/backups/deploy/catalog-search-20261014`. Rollback restores this exact pickup web image, without restarting the worker or changing order data. Do not use the historical October 6 release or pre-pickup validator.

Pre-release verification passed: 151 Node tests, 2 CommerceML integration tests, 9 Python tests, TypeScript, ESLint and production build. Browser search scenarios passed at 390px and 1280px, and GET search also passed with JavaScript disabled. Pickup/courier/Ozon-point browser scenarios passed at both widths for the candidate and the exact pickup rollback image, intercepting all writes. Inspect screenshots and logs under `/tmp/vozdooh-search-*`. Execute `/opt/vozdooh/backups/deploy/catalog-search-20261014/rollback.sh` to restore the pre-search pickup web image.

## Homepage completion

The homepage now includes a cream search strip immediately below the site header, before the unchanged hero. Its accessible native GET form submits name, brand or SKU queries to the existing `/catalog?q=...` implementation. There is no second search algorithm or client-side catalog copy. Homepage metadata and normal production indexing are unchanged.

The browser regression script additionally submits actual visible product names, brands and the supplied sellable SKU from the homepage at 390px and 1280px, checks first-viewport visibility and horizontal overflow, and verifies homepage submission with JavaScript disabled. Before deployment, preserve the exact catalog-search image and compose under `/opt/vozdooh/backups/deploy/home-search-20261014`; its rollback restores that image while retaining the pickup-compatible worker and all persistent data.

Homepage release validation: `npm run verify` passed (151 Node tests, 2 integration tests and 9 Python tests, typecheck, lint and build). The production candidate passed homepage name/brand/SKU submission and catalog regression scenarios at 390px and 1280px, plus homepage GET submission without JavaScript. Pickup/courier/Ozon-point checkout and mocked Ozon Pay passed at both widths. Candidate robots and sitemap are byte-identical to the active catalog-search release. The rollback script was exercised successfully before switching images; the worker identity was preserved.

## Compact header revision

The owner-approved revision removes the homepage cream strip and adds a native search disclosure beside the cart. Enter/Space opens it, focus moves to the search input, and Escape or “Закрыть поиск” closes it and restores trigger focus. The panel starts below the header so it does not cover the cart. Opening the mobile menu closes search; navigation resets the disclosure. The native disclosure and GET form also work without JavaScript. Catalog search and filters are unchanged.

Run `npm run verify` and the read-only browser regression script for desktop/mobile disclosure, keyboard closure, cart clearance, name/brand/SKU navigation, no homepage strip and catalog SEO/filter behavior. Backup and rollback: `/opt/vozdooh/backups/deploy/header-search-20261014/rollback.sh`, restoring exactly `home-search-20261014` without restarting the pickup worker or modifying persistent data.

Headless search regression uses reduced motion and disables software WebGL to exercise the existing hero fallback on the verification host; navigation waits for DOM readiness. Hero rendering code is unchanged. The new homepage-strip assertion fails against the previous live release. Full `npm run verify` passes with `NO_PROXY=127.0.0.1,localhost` so local integration requests bypass the ambient HTTP proxy. Candidate pickup/courier/Ozon-point and mocked payment checks passed at 390px and 1280px with all writes intercepted.

## Visible search button

The header search trigger now uses a subtle outlined button with a magnifier and “Поиск” beside the cart. At widths up to 600px it shows a 24px magnifier in a 44px square touch target with accessible name “Поиск”. Hover, open and keyboard focus states remain visible. The panel placeholder is “Найти аромат или бренд”; its label and existing catalog implementation continue to support name, brand and SKU. Native disclosure behavior, Escape and focus restoration are preserved. No homepage strip is added.

This revision follows the completed paid-cart release `8ae799c9`. Run `npm run verify` and `scripts/verify-catalog-search-browser.cjs` for 390px/1280px presentation, keyboard and catalog regression checks. Backup and rollback restore the exact paid-cart web image through `/opt/vozdooh/backups/deploy/search-button-visible-20261014/rollback.sh`, preserving the worker and persistent order data.

Validation passed: `npm run verify` (165 Node tests, 2 integration tests, 9 Python tests, TypeScript, ESLint and build), production-settings build, and browser search regression at 390px/1280px including JavaScript-disabled GET search. Closed-header screenshots were visually reviewed; navigation stays on one line without overlap and the hero and cart remain intact.
