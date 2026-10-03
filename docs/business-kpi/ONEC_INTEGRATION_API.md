# 1C UT 11 → Business KPI integration API

Status: server-side preparation, contract v1.0. 1C is not connected yet.

## Goal

Remove manual entry of daily sales facts while keeping 1C UT 11 as the source of truth.
The first integration scope is intentionally narrow:

- daily sales;
- cash;
- acquiring;
- QR;
- B2B sales to legal entities;
- receipt count;
- sold item units;
- return diagnostics.

Catalog, stock, prices, purchasing, customers and bonuses are later contracts.

## Network and authentication

The API must not require a new public port. The preferred transport is HTTPS over Tailscale.
Current tailnet route already proxies the KPI service on HTTPS.

Authentication is a dedicated Bearer service key with explicit scopes:

- `onec:read`;
- `onec:write`.

Existing analytics service keys receive no 1C write permission by default.
## Endpoints

### GET /api/integration/1c/v1/ping

Requires `onec:read`. Returns service status and supported contract version.

### GET /api/integration/1c/v1/status?limit=20

Requires `onec:read`. Returns recent accepted batches and recent failures.

### POST /api/integration/1c/v1/daily-sales

Requires `onec:write`.

Headers:

```text
Authorization: Bearer <secret>
Content-Type: application/json
X-Idempotency-Key: <same value as batchId>
```

Maximum request body: 512 KiB.
Maximum records per batch: 500.
## Contract v1.0

Example:

```json
{
  "contractVersion": "1.0",
  "sourceInstance": "amursk-ut11",
  "batchId": "2026-10-03T19:00:00+10:00-amper-001",
  "records": [
    {
      "recordId": "amper:2026-10-03",
      "storeCode": "amper",
      "businessDate": "2026-10-03",
      "sourceUpdatedAt": "2026-10-03T19:00:00+10:00",
      "cash": 10000,
      "acquiring": 20000,
      "qr": 5000,
      "b2b": 3000,
      "b2bOrders": 1,
      "receipts": 20,
      "itemsSold": 50,
      "returnsAmount": 500,
      "returnReceipts": 1
    }
  ]
}
```
## Money semantics

These rules are mandatory because KPI already uses them:

- `acquiring` **includes QR**;
- `qr <= acquiring`;
- retail revenue = `cash + acquiring`;
- total store revenue = `cash + acquiring + b2b`;
- QR is never added to revenue a second time;
- QR share = `qr / acquiring`;
- B2B is excluded from retail average-check and QR-share calculations.

`cash`, `acquiring` and `b2b` must be the **net accepted sales amounts after returns**.
`returnsAmount` is positive diagnostic information and is not subtracted again by KPI.

`receipts` is the sales receipt count, excluding return receipts.
`returnReceipts` is sent separately.

This prevents both double-counting QR and double-subtracting returns.
## Store and employee mapping

Canonical store codes:

| Store | storeCode | Default employeeCode |
|---|---|---|
| Ампер | `amper` | `amper-store-input` |
| Вентиль | `ventil` | `ventil-store-input` |
| Метиз Маркет | `metiz-market` | `metiz-market-store-input` |
| Миска | `miska` | actual seller mapping required |

For Amper, Ventil and Metiz Market, `employeeCode` may be omitted and the store-level identity is used.

Miska is different because seller KPI is individual. Until 1C seller mapping is confirmed,
Miska records must include a reviewed `employeeCode`; the integration must not guess a seller.

All business dates use the store timezone `Asia/Vladivostok`.
## Idempotency and corrections

`batchId` identifies one HTTP delivery.

Rules:

1. On a transport retry, resend the **same payload with the same batchId**.
2. Same batchId + same payload is a safe no-op.
3. Same batchId + different payload is rejected.
4. If data changes in 1C, create a **new batchId**.
5. `recordId` stays stable for the same logical daily record.
6. A changed record must have a newer `sourceUpdatedAt`.
7. An older changed version is rejected as stale.

Example stable record IDs:

- `amper:2026-10-03`;
- `ventil:2026-10-03`;
- `metiz-market:2026-10-03`;
- `miska:2026-10-03:<employee-code>`.

A newer version updates the existing 1C-derived KPI row instead of creating a duplicate.
## Atomicity and conflicts

A batch is atomic: if one record fails validation or mapping, no record from that batch is applied.

Failures are stored separately with:

- batch/idempotency key when available;
- source instance;
- contract version;
- payload SHA-256;
- error code and message;
- original JSON;
- failure timestamp.

The failed batch itself is not marked completed, so the corrected payload can be retried with a new batchId.

If a manual portal record already occupies the same store/employee/date identity,
1C receives `ONEC_SHIFT_SOURCE_CONFLICT`; the API never overwrites the manual record silently.

Once a shift is sourced from 1C, portal users cannot edit or archive it.
The correction must be made in 1C and resent.
## Database provenance

Accepted data is stored in three layers:

1. `business_kpi.onec_sync_batches` — immutable delivery-level payload/result metadata.
2. `business_kpi.onec_daily_sales` — normalized 1C daily record plus original JSON/hash.
3. `business_kpi.shifts` — canonical KPI fact with `source='1c'` and a unique `source_ref`.

Rejected requests are recorded in `business_kpi.onec_sync_failures`.

Audit entries for 1C-created/updated KPI facts use actor type `future_1c`
and actions `SHIFT_ONEC_CREATED` / `SHIFT_ONEC_UPDATED`.

## What the future 1C extension must do

The extension must not open inbound access to 1C.
It should run a background job every 30–60 seconds and push changed facts outward over HTTPS.

The extension needs to:

- determine changed sales/return/payment documents;
- recalculate the affected daily aggregate;
- map store and, for Miska, seller;
- generate stable `recordId`;
- generate a new `batchId` for changed content;
- keep `sourceUpdatedAt` monotonic;
- retry network failures with the same batchId/payload;
- only mark its local queue item delivered after a successful API response.

Direct SQL access to 1C is not used.
## Server-side readiness checklist

Implemented before touching 1C:

- [x] versioned JSON contract;
- [x] scoped Bearer authentication;
- [x] request-size and batch-size limits;
- [x] idempotent batch retries;
- [x] stale-update protection;
- [x] atomic batch transaction;
- [x] raw payload/hash storage;
- [x] failure diagnostics;
- [x] KPI projection;
- [x] QR/B2B accounting semantics;
- [x] audit trail;
- [x] manual-record conflict protection;
- [x] read-only policy for 1C-derived KPI facts;
- [x] Amper/Ventil/Metiz store-level mappings;
- [x] in-memory HTTP tests;
- [x] PostgreSQL end-to-end tests;
- [x] tailnet-only HTTPS transport already available.

Remaining for the 1C stage:

- [ ] confirm the actual 1C host and install/verify Tailscale there;
- [ ] map UT 11 organizations/stores/payment types to the contract;
- [ ] confirm Miska seller identity mapping;
- [ ] install the extension;
- [ ] configure the production service key;
- [ ] run shadow reconciliation against manual KPI for several days;
- [ ] only then disable manual sales entry.
