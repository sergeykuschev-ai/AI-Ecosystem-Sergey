# VOZDOOH — paid cart reconciliation after returning from Ozon (2026-10-15)

## Previously

The cart was cleared only by `PaymentSuccessTracker` rendered on `/checkout/success?requestId=...`. If the customer returned to catalog/cart directly, left the provider in another tab, or restored Safari, there was no payment check to consume the paid cart snapshot. The backend order store can already confirm `PAID` via the commerce worker.

## Fix

`CartPaymentSync` is mounted alongside the cart counter in the shared `SiteHeader`. It runs a no-cache status query on page entry, focus and visibility resume, plus every 30 seconds while the page is visible. It reads at most 12 local pending, order-ID-bound payment snapshots; it never scans all order IDs and it doesn't send PII. Only `verifiedPaidOrder(state=paid, matched requestId/amount/items)` calls `applyConfirmedPayment` and clears the exact originally purchased quantities. Previously added subsequent units remain, and the existing receipt prevents re-removal or duplicate purchase tracking. Failed/pending/unverified statuses and unknown legacy purchases never clear the cart.

Existing manual 'Очистить корзину' remains available for old purchases without a recoverable receipt, and is not triggered automatically.

## Verification

`tests/paid-cart.test.cjs` adds proof for page-return cleanup without the success route, cancellation, network failures, invalid response, unchanged items, newer SKU quantities, and idempotence. Run full `npm run verify`, build a distinct web-only Docker image, smoke-check main shop routes and web bundle hook, then deploy with rollback to `vozdooh-web:national-pdp-seo-20261014`. No payment worker or provider integration changes.
