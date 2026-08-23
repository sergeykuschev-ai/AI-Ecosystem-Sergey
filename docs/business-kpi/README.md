# Business KPI Web v1

Business KPI Web is the local daily-entry application for store shifts and
seller KPI analytics. Manual web entry is the primary workflow. Excel is a
secondary historical import, reconciliation, and backup-export channel. 1C is
not connected in this stage.

## Local quick start

```bash
npm run business-kpi:web
```

Open `http://127.0.0.1:3220`. When no database URL is configured, the process
runs in explicit `LOCAL_DEV` mode with an in-memory Miska store, synthetic
sellers plus the four deterministically mapped historical seller names, the
confirmed August settings, and the four control monthly plans.
Data in this mode lasts only for the process lifetime.

Use PostgreSQL by setting `BUSINESS_KPI_STORAGE_MODE=postgresql` together with
`BUSINESS_KPI_DATABASE_URL`, running `npm run business-kpi:migrate`, and
starting the server. PostgreSQL mode fails startup when the connection
preflight fails, and `/health` performs a live check.

Server integration must use the independent stack documented in
`docker/business-kpi/README.md`. It owns database `business_kpi_test`, volume
`business_kpi_test_postgres_data`, and network `business_kpi_test_internal`.
It never connects to the production `arthur` database or volume. The older
opt-in profile in `docker/arthur/compose.yml` is not an integration-test
target.

Production authentication is intentionally not simulated. If
`BUSINESS_KPI_DEV_MODE=false`, write requests return `AUTH_NOT_CONFIGURED`.
In local mode the default actor is `local-owner` with role `OWNER`; tests may
set `X-Business-KPI-Actor-Id` and `X-Business-KPI-Role`.

## Manual shift contract

The form and API accept only primary facts:

| Field | Meaning |
|---|---|
| `shiftDate` | Calendar date in `YYYY-MM-DD` |
| `storeId` | Store identity |
| `employeeId` | Seller identity belonging to the store |
| `shiftKey` | `main`, `morning`, or `evening` |
| `cash` | Cash revenue, RUB |
| `acquiring` | Acquiring revenue including QR, RUB |
| `qr` | QR part already contained in acquiring, RUB |
| `receipts` | Receipt count |
| `itemsSold` | Total sold item units, not a ready ratio |
| `upsellReceipts` | Receipts with upsell |
| `treatsRevenue` | Treats revenue, RUB |
| `treatsReceipts` | Receipts with treats |
| `comment` | Optional shift comment, up to 1,000 characters |

All money facts must be non-negative. Counts must be non-negative integers.
`qr <= acquiring`, `upsellReceipts <= receipts`, and
`treatsReceipts <= receipts` are enforced both at the application boundary
and in PostgreSQL. Derived fields sent by a client are rejected rather than
trusted.

The following are server-derived and are never manual inputs: revenue,
average check, items per receipt, QR share, KPI component scores, total score,
level, bonus, month totals, and forecast.

## Shift CRUD API

All responses use `{ "api_version": "v1", "data": ... }` or a versioned
error object.

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/business-kpi/shifts` | Create and calculate a manual shift |
| `GET` | `/api/business-kpi/shifts` | List active shifts |
| `GET` | `/api/business-kpi/shifts/:id` | Shift details, derived KPI, and audit history |
| `PATCH` | `/api/business-kpi/shifts/:id` | Patch primary facts and recalculate KPI |
| `DELETE` | `/api/business-kpi/shifts/:id` | Archive, never physically delete |

List filters are `store`, `employee`, `year`, `month`, `date_from`, and
`date_to`. `OWNER` and `MANAGER` may create or edit. Only `OWNER` may archive.
`SELLER` is read-only in the current permission contract; own-data scoping
must be implemented together with production identity.

An active shift identity is
`storeId + employeeId + shiftDate + shiftKey`. This prevents accidental
duplicates while preserving legitimate morning/evening exceptions. The
partial PostgreSQL unique index excludes archived rows, so an archived shift
does not permanently block a corrected replacement. Duplicate writes return
HTTP 409 `DUPLICATE_SHIFT`.

## KPI calculations

Money is normalized to two decimal currency units before addition. Ratios are
not rounded inside the domain layer.

```text
revenue             = cash + acquiring
averageCheck        = revenue / receipts
itemsPerReceipt     = itemsSold / receipts
upsellReceiptShare  = upsellReceipts / receipts
treatsReceiptShare  = treatsReceipts / receipts
qrShare             = qr / revenue
```

Because acquiring already includes QR, QR is not added a second time. A zero
divisor produces JSON `null`; the browser renders it as `—`.

The confirmed Excel KPI model uses five capped component scores:

```text
shift plan       target 24,000 RUB, weight 30
average check    target 1,200 RUB,  weight 20
items/receipt    target 2.5,        weight 15
upsell share     target 30%,        weight 20
treats           mean of revenue/1,200 and receipt-share/20%, weight 15
```

Each component is capped at its weight. Total level thresholds and base bonus
are: 95 `Отлично` / 7,000; 90 `Хорошо+` / 5,000; 85 `Хорошо` / 4,000; 75
`Минимум` / 2,500; otherwise zero.

The confirmed seller bonus formula is:

```text
base(level)
* min(1, seller shifts / 15)
* applied QR coefficient
```

QR coefficient tiers are `<10%: 0.95`, `<15%: 1.0`, `<20%: 1.025`,
`<25%: 1.05`, and otherwise `1.075`. A coefficient above 1 applies only when
seller average KPI is at least 75 and store plan completion is at least 100%;
otherwise it is capped at 1.

All targets, weights, levels, base bonuses, coefficient tiers, payment
semantics, and fees live in effective-dated `kpi_settings`. The browser only
displays them. The current confirmed record is version 1, effective
2026-08-01, with acquiring fee 2.2% and QR fee 0.7%.

The Excel Settings sheet has no standalone target QR share. That field is
therefore `null` and explicitly marked unresolved; QR coefficient tiers remain
available and confirmed.

## Dashboard, sellers, and month calculations

`GET /api/business-kpi/dashboard?store=...&year=2026&month=8` returns plan,
revenue, completion, receipts, average check, sold units, items per receipt,
cash, acquiring, QR, QR share, shift count, data-day count, forecast, and
seller aggregates. `GET /api/business-kpi/sellers` returns the seller list for
the same period. The dashboard contract also includes exact daily aggregates
under `days`; they are recalculated from active shifts after every write.

Month and seller ratios are calculated from summed facts. The implementation
never averages pre-calculated averages.

Month status is `NO_DATA`, `IN_PROGRESS`, or `CLOSED`. There is no automatic
closing action yet, so populated months remain `IN_PROGRESS` until a future
owner close workflow supplies the explicit closed state.

For an open month:

```text
averageRevenuePerDataDay = revenue / distinct dates containing active shifts
projectedRevenue         = averageRevenuePerDataDay * calendar days in month
remainingToPlan          = plan - revenue
requiredAveragePerRemainingDay
                         = max(0, remainingToPlan) / remaining calendar days
```

Insufficient data or a zero divisor produces `null`.

## Monthly plans and settings APIs

`PUT /api/business-kpi/plans/:year/:month` is owner-only. Its body contains
`storeId`, `revenuePlan`, and optional `reason`. The update immediately affects
the dashboard and appends an audit event. Local seed control values are:

| Month | Plan, RUB |
|---|---:|
| May 2026 | 750,200 |
| June 2026 | 750,000 |
| July 2026 | 745,000 |
| August 2026 | 745,000 |

`GET /api/business-kpi/settings?store=...&date=YYYY-MM-DD` returns the
effective settings version. May–July KPI settings have not been supplied or
confirmed and are not inferred from the August workbook.

## Audit and provenance

Every create, update, archive, and monthly plan change is performed in a
storage transaction and appends actor, action, entity, timestamp, old value,
new value, source, optional reason, and correlation ID. PostgreSQL prevents
updates or deletes of audit rows with triggers.

Shift provenance is `web_manual` or `excel_import`; the schema reserves `1c`
for a later integration without coupling current calculations to that source.
Editing an imported historical row keeps `source = excel_import`, preserves
`originalImportedInput`, adds explicit `override` metadata, and appends the
old/new values to audit. Missing historical payment facts remain read-only and
cannot be replaced with guessed cash/acquiring/QR values. 1C is not implemented.

## Excel bulk import

The XLSX path is deliberately secondary to manual entry:

```text
XLSX -> OOXML workbook adapter -> exact header mapping -> normalized rows
     -> canonical shift model -> atomic bulk storage -> aggregation
     -> reconciliation
```

The adapter reads real `.xlsx` ZIP/XML parts and never relies on fixed column
positions. Headers are normalized for Unicode, case, and whitespace, then
matched only against a reviewed alias list. There is no fuzzy matching.
Unknown mandatory headers fail the run.

The HTTP workflow is:

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/business-kpi/imports/dry-run` | Multipart `file` + `storeId`; parse and persist validation preview without shifts |
| `POST` | `/api/business-kpi/imports/:id/commit` | Atomically import a successful dry-run |
| `GET` | `/api/business-kpi/imports?store=...` | Import-run history |
| `GET` | `/api/business-kpi/export?store=...&year=...&month=...` | Simple monthly XLSX backup export |

Run states are `PENDING`, `VALIDATING`, `IMPORTING`, `RECONCILING`,
`COMPLETED`, and `FAILED`. A completed SHA-256 is idempotent. A different file
that collides with an existing canonical identity
`store + employee + date + shiftKey` is reported before commit and never
overwrites history. A critical commit error rolls every shift back while the
run and validation report remain `FAILED`.

### Authoritative and derived fields

For August payment workbooks, authoritative inputs are cash, acquiring
(already including QR), QR, receipts, sold item units, upsell receipts, treats
revenue, treats receipts, date, and seller. Revenue is derived as
`cash + acquiring`; QR is not added again and must satisfy `0 <= QR <= acquiring`.

For May–July, the source has no reliable cash/acquiring/QR breakdown.
`historicalRevenue` is therefore authoritative, `revenueSource` is
`historical_total`, all three payment fields remain `null`, and
`paymentBreakdownAvailable` is false. Average check and plan completion are
still derived by the backend. QR share is `null`, never zero.

Excel average check, items per receipt, completion, component scores, total
KPI, level, and bonus are reference values only. They are not imported as new
facts. Where older books provide only an items-per-receipt ratio rather than
sold units, `itemsSold` and the backend ratio remain `null`; the Excel ratio is
kept in source-reference metadata for discrepancy reporting.

### Historical workbook selection

The reviewed source set is:

| Month | Selected workbook | Rows | Reason |
|---|---|---:|---|
| May | `KPI_магазин05.26.xlsx` | 31 | Full month and exact controls; the 11 May and 29-row copies are incomplete |
| June | `KPI_Миска_06.26_премия_смены_исправлены (2).xlsx` | 30 | Full corrected shift set and exact controls; 8-row and 20-row versions are incomplete |
| July | `KPI_Миска_07.2026_понятный_дашборд (7).xlsx` | 31 | Full July range and exact controls; protected/earlier presentation variants are not selected silently |
| August | `KPI_Миска_08.2026_ИТОГ_FIXED_v2 (3)_BACKUP_before_final_items_fix_2026-08-13 (4).xlsx` | 22 | Full populated period, complete payment facts, exact controls; known `...эквайринг_включает_QR_BACKUP.xlsx` is only 7 populated rows |

The annual `KPI_Миска_2026_ГОДОВОЙ_май-август.xlsx` is a cross-check, not the
row source. It confirms the four monthly controls and explicitly states that
May–July lack payment-method data.

### Settings and employees

May contains partial norms and a 24,200 RUB daily plan but no complete
weights/bonus/payment model. June and July contain progressively richer KPI
and bonus rules but still lack the full payment/fee/QR configuration. They do
not become effective settings versions: their KPI and bonus remain
`UNRESOLVED`. Only August supplies the complete confirmed Settings model. A
matching existing version effective 2026-08-01 is retained; if it is absent,
the importer creates version `202608` inside the same atomic transaction as
the shifts. August settings are not backfilled into May–July.

Employee matching uses NFKC normalization, trimmed/collapsed whitespace, and
case-insensitive exact names/explicit aliases. The reviewed names are
`Горбунова`, `Капитанова`, `Кущев`, and `Чередниченко`. Abbreviations are not
guessed; an unknown name blocks commit with `UNKNOWN_EMPLOYEE`.

### Reconciliation result

The optional real-workbook integration test imports all four selected files
through dry-run and commit into one isolated store:

| Month | Expected revenue | Actual revenue | Revenue delta | Expected receipts | Actual receipts | Delta | Status |
|---|---:|---:|---:|---:|---:|---:|---|
| May 2026 | 739,091.20 | 739,091.20 | 0.00 | 727 | 727 | 0 | PASS |
| June 2026 | 736,517.85 | 736,517.85 | 0.00 | 715 | 715 | 0 | PASS |
| July 2026 | 794,937.10 | 794,937.10 | 0.00 | 735 | 735 | 0 | PASS |
| August 2026 | 593,037.60 | 593,037.60 | 0.00 | 437 | 437 | 0 | PASS |

No values are adjusted to reach these controls. Data-quality reports separate
warnings from errors and cover missing facts/settings, zero receipts,
negative values, QR above acquiring, unknown employees, duplicate shifts,
invalid dates, formula/error cells used as facts, and unsupported headers.
The selected August rows sum to 166,519.80 RUB QR (28.0791%), while that
workbook's Dashboard reference shows 144,630.20 RUB (24.3880%). The importer
reports this discrepancy and retains the row-level authoritative QR values;
it does not rewrite them to match a derived Dashboard cell. Sold-item totals
are also partial because eight August rows have no independently authoritative
unit count after the known shifted-column values are validated.

## Storage and architecture

```text
browser -> HTTP router -> BusinessKpiService -> storage adapter
                              |
                              v
                    deterministic domain services
```

The in-memory and PostgreSQL adapters expose the same application contract.
PostgreSQL owns stores, users, employees, import runs, shifts, monthly plans,
effective settings, calculation snapshots, bonuses, and append-only audit in
schema `business_kpi`. Derived aggregates are calculated on request, not
accepted as manual values.

Business KPI imports no Purchasing modules and changes no Purchasing runtime
contract.

## Verification

```bash
npm run test:business-kpi
npm run test:business-kpi:postgres
npm test
git diff --check
git status --short
git diff --stat
```

The Business KPI suite covers calculations, zero-divisor behavior, QR
validation, aggregation, forecasts, seller bonus, create/update/archive,
duplicate rollback, plan audit, OOXML parsing, header/date/number mapping,
historical revenue, employee mapping, dry-run/commit/idempotency/rollback,
monthly export, migrations, frontend delivery, and the full manual HTTP flow.
Run the real historical reconciliation when the reviewed files are available:

```bash
BUSINESS_KPI_REAL_XLSX_ROOT=/path/to/reviewed/workbooks \
  npm run test:business-kpi
```

`test:business-kpi:postgres` is fail-closed: it requires an explicitly named
test PostgreSQL database and never falls back to memory storage. Run it through
the isolated Compose service so the real XLSX directory is mounted read-only.
The full server procedure, including the second phase after container restart,
is in `docker/business-kpi/README.md`.
