# Private preview order requests, version 1

## Live behavior

`POST /api/order-requests` is a Node server boundary. The existing staged catalog
path/environment stays unchanged. Only staged-1c permits submission. Requests
require same-origin JSON; the streamed body is capped at 32 KiB. Responses are
no-store and noindex. There is no public list/read endpoint for customer records.
The preview must remain private; robots is not access control.

Request shape:

```json
{
  "retryKey": "00000000-0000-4000-8000-000000000001",
  "lines": [{"sku": "synthetic-example", "quantity": 1, "expectedPriceMinor": 1235}],
  "contact": {"name": "Synthetic Test", "phone": "+7 000 000 00 00"},
  "delivery": {"method": "pickup", "address": "", "comment": "Synthetic example only"},
  "consent": true
}
```

The example is synthetic, not merchandise or a real customer. 1–100 distinct
SKU lines are accepted. Quantities are whole source units, 1–999, and must not
exceed current staged stock. Fractional source stock is preserved but does not
permit fractional checkout quantities. Prices must be positive, representable in
integer kopecks and match the displayed expected price. Sub-kopeck prices and
unsafe totals reject; there is no silent rounding. RUB goods totals are the sum
of quantity × unit price; no taxes/discounts/shipping are added or inferred.
Name is required (100 characters maximum), phone has 10–15 digits with common
formatting allowed. Courier requires an address (500 characters maximum).
Comment is optional (1,000 characters maximum). Consent is recorded as
`request-contact-v1`; it authorizes storage and contact for this request only.

Success (201) returns `{id, createdAt, totalMinor, currency, status}` where status
is only `request_received`. Validation returns a safe code (422), stock/price
changes or a reused key with different content return 409, unavailable catalog
or storage returns 503. The API does not echo customer data or internal errors.

## Retry and storage guarantees

A UUID v4 retry key identifies one normalized request. Identical retries return
the original receipt even after stock changes. Different content with the same
key conflicts. The browser retains only a key and SHA-256 payload digest in
sessionStorage; it does not persist contact fields. Network failures keep the
key. The accepted receipt is shown without automatically clearing the cart.
A new key is a new request: there is no cross-device customer deduplication.

`OrderRequestStore` isolates persistence from validation and the catalog reader.
The default directory is `.local/order-requests/` under this app's working
directory (ignored by Git, never under public). Each mode-0600 JSON record has
an ID, UTC timestamp, normalized input, consent version, source label, line/name/
price/stock snapshot, fingerprint and goods total. The directory is mode 0700
when created. A flushed temporary file is published using an exclusive atomic
hard link, then the directory is fsynced before acknowledging success. Concurrent
writers cannot overwrite a retry key. A local POSIX filesystem is required.

This is single-host storage, not a distributed database. Keep the app working
directory and its `.local` data on persistent disk across preview restarts and
deployments. Back up records through the host's restricted operational backup
process. Do not run multiple hosts with independent storage behind one endpoint.
Disk/full/permission/corruption errors fail closed; check disk and ownership,
restore corrupt records from a trusted backup, then retry with the original key.
A crash can leave hidden `.tmp` files: remove only after confirming no writer
is active. Never delete accepted JSON records to resolve a retry conflict.

## Manual processing and future adapters

The owner/operator must review new local JSON records using restricted server
access, contact the customer, verify current availability in 1C, and agree on
pickup or courier terms. There is no automatic notification or operator dashboard.
Do not paste customer records into Git, chat, build logs or test output. Retention
and deletion are manual server operations; establish the production retention
policy and operator ownership before public launch.

Nothing reserves/decrements stock or creates a 1C order. Multiple requests can
reference the same remaining unit and each needs manual confirmation. Payment
is not connected and no payment status is fabricated. Delivery is a preference,
not a booking or price quote. Future order/payment/notification adapters must
consume this recorded request through a separately approved, auditable workflow;
accepting a request must not acquire hidden external side effects.

## Verification

`npm test` covers validation, integer totals, changed stock/price, malformed
contacts, retries/concurrency, permissions, corruption and HTTP guard failures.
`npm run verify` adds typecheck, lint and build. For private preview smoke tests,
use synthetic contacts only and retain the test request ID for isolated cleanup.
Do not modify or regenerate `/opt/vozdooh/data/catalog-staged.json` for testing.

With Playwright available, run `node scripts/verify-order-request.cjs` against
127.0.0.1:3411 (set `PLAYWRIGHT_MODULE` if installed outside this app). It creates
one clearly labeled synthetic request and checks its idempotent retry; prints
only its receipt ID/key and total. It does not alter the catalog snapshot.

## Reliability checks (2026-09-25)

Browser submissions abort their wait after 15 seconds, release the pending form,
and retain the same retry key. A timeout is an unknown outcome, not proof that
storage failed. Retry with unchanged data to recover the original receipt.
Successful HTTP responses must contain a valid request receipt before success is
shown. The form exposes its pending state with `aria-busy`.

Before replaying a stored receipt, the local store validates its normalized-input
fingerprint, source/status/currency/consent markers, ID/date, line snapshots and
integer totals. Invalid records fail closed without rewriting them. This is an
integrity check, not a signature against malicious filesystem modification.
