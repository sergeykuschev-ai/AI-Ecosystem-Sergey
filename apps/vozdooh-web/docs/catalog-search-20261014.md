# Catalog search — 14 October 2026

The catalog has a visible GET search form using `/catalog?q=...`. It matches literal substrings in the 1C product name, brand and SKU, ignoring case and normalizing Unicode and whitespace. Empty search leaves the current selection unchanged. Search operates after source availability, image validation, storefront exclusions and selected filters; it never expands the public selection.

Search submission preserves validated filters. Filter submission and individual filter removal preserve search. “Сбросить поиск” removes only search; “Сбросить всё” clears both. The canonical remains `/catalog`. Every URL containing `q`, including an empty query, receives `noindex`; normal catalog indexing retains the production setting.

Run `npm run verify`. The opt-in `scripts/verify-catalog-search-browser.cjs` checks actual visible inventory, brand/name/SKU searches, empty results, filter preservation, reset, canonical, robots and layout at 390px and 1280px. Set `VOZDOOH_QA_URL`, `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH`; optional `VOZDOOH_QA_PROXY` uses the existing German proxy. It blocks external resources and all non-GET requests.

Release changes only the web image in the existing compose. Preserve the running pickup image and full compose in `/opt/vozdooh/backups/deploy/catalog-search-20261014`. Rollback restores this exact pickup web image, without restarting the worker or changing order data. Do not use the historical October 6 release or pre-pickup validator.

Pre-release verification passed: 151 Node tests, 2 CommerceML integration tests, 9 Python tests, TypeScript, ESLint and production build. Browser search scenarios passed at 390px and 1280px, and GET search also passed with JavaScript disabled. Pickup/courier/Ozon-point browser scenarios passed at both widths for the candidate and the exact pickup rollback image, intercepting all writes. Inspect screenshots and logs under `/tmp/vozdooh-search-*`. Execute `/opt/vozdooh/backups/deploy/catalog-search-20261014/rollback.sh` to restore the pre-search pickup web image.
