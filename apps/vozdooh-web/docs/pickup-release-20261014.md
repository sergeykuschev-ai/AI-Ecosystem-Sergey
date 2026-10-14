# Free store pickup — 14 October 2026

Pickup uses `delivery.method = "pickup"`, address `Хабаровск, ул. Павла Морозова, 97`, and costs 0 RUB. No Ozon destination fields, quote or delivery creation are used. Ozon Pay continues to charge only products. Customers collect only after readiness confirmation and agreement of the collection time.

Empty pickup addresses remain accepted for legacy version 1 receipts and retries, preserving their fingerprints. New checkout uses the fixed address; other pickup addresses are rejected. Email and operational notifications include the address and collection terms.

Payment reconciliation queues only `payment_confirmed`. `delivery_ready` has pickup-specific copy, but no readiness event producer exists in the current application. This release does not add one. Readiness is confirmed operationally; automatic readiness email requires a real status integration.

Source was recovered from `/tmp/vozdooh-seo-merch`, parent `5eaeea09`. All 622 saved `.next` files matched the active image build context before editing. October 6 release changes were reviewed but are not the build base. The worker is built from its running filesystem, changing only validation, mail, notification presentation and an early delivery method guard.

Run `npm run verify` using current production indexing/public analytics settings. Tests use synthetic orders, temporary stores and fake payment, delivery and mail providers. Browser scenarios intercept write endpoints, so no real paid orders or client emails are created.

Original compose and image IDs are saved in `/opt/vozdooh/backups/deploy/pickup-20261014`. Original images have `rollback-pickup-20261014` tags. After pickup receipts exist, use the compatibility rollback web image and updated worker: reverting to the old validator would invalidate nonempty pickup address fingerprints. Do not delete or rewrite orders during rollback. Restart only web and commerce-worker, then check health, checkout, robots and sitemap.

Verification passed: 149 Node tests, 2 CommerceML integration tests, 9 Python tests, TypeScript, ESLint and Next production build through `npm run verify`. Set `NO_PROXY=127.0.0.1,localhost` and `no_proxy=127.0.0.1,localhost` in this environment for local integration servers. Run the final production build separately with `SEARCH_INDEXING_ENABLED=true`, `NEXT_PUBLIC_SITE_URL=https://vozdooh27.ru` and the current public Metrica ID; preview tests intentionally expect indexing disabled.

Opt-in browser verification: run `scripts/verify-pickup-browser.cjs` with `VOZDOOH_QA_URL`, a sellable `VOZDOOH_QA_SKU`, `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH`. It checks pickup, courier and Ozon point checkout at 390px and 1280px and mocks every write. No live order, payment, delivery or email is created.

Compatible rollback command: `/opt/vozdooh/backups/deploy/pickup-20261014/rollback.sh`. It restores the previous checkout UI while retaining receipt-compatible validation and the updated worker. The original image archive is `original-images.tar`; use the original compose only before any new pickup receipt exists.
