# Purchasing Web Backend v1

## Purpose

Purchasing Web Backend v1 is a local HTTP and application layer over the
existing Purchasing Agent. It accepts a SmartZapas Excel export, starts one
complete calculation under a shared `run_id`, stores compact browser DTOs and
full artifacts, and exposes them to a future frontend.

The backend does not duplicate purchasing formulas. Purchasing Agent, Demand
Engine, Matrix Builder, Financial Controller, Recommendation Explainer, and
Owner Review remain the authoritative domain components. The backend only
orchestrates them, stores results, maps DTOs, and transports files.

## Architecture

```text
node:http + router
        |
        v
upload handler -> purchasing run orchestrator -> existing domain entry points
        |                    |
        v                    v
temporary upload       in-memory run bundle
                             |
                             v
file run registry -> compact DTOs + whitelisted artifacts
        |
        v
query service / secure artifact stream
```

Runs are filesystem-backed. There is no database, asynchronous queue,
authentication layer, or frontend in local v1.

## Start

Install dependencies and start the backend:

```bash
npm install
npm run purchasing:web
```

The server binds only to `127.0.0.1`. The default URL is:

```text
http://127.0.0.1:3210
```

The bind address is intentionally not configurable in v1.

## Environment variables

| Variable | Default | Purpose |
|---|---:|---|
| `PURCHASING_WEB_PORT` | `3210` | Local HTTP port, from `0` through `65535` |
| `PURCHASING_WEB_RETENTION_TTL_MS` | `86400000` | Completed-run retention period in milliseconds |
| `PURCHASING_APPROVED_RULE_MODE` | `PREVIEW` | Approved Rules mode: `OFF`, `PREVIEW`, or explicitly enabled `APPLY_SAFE` |

Server-side financial, Matrix Builder, assortment-matrix, Owner Decisions, and
Recommendation Explainer paths come from backend configuration. An HTTP client
cannot provide or override local server paths.

Approved Rules are preview-only by default. `OFF` skips their processing.
`APPLY_SAFE` may only remove an existing positive quantity or move a zero
quantity between `SKIP` and `DEFER`; it never creates a positive quantity.
Registry, preview, rule-application, or financial-recalculation failures fall
back to the complete baseline order.

## API v1

Successful JSON responses use:

```json
{
  "api_version": "v1",
  "data": {}
}
```

JSON errors use:

```json
{
  "api_version": "v1",
  "error": {
    "code": "RUN_NOT_FOUND",
    "message": "Запрошенные данные run не найдены.",
    "request_id": "uuid",
    "run_id": "uuid",
    "details": []
  }
}
```

Errors never expose stack traces, error causes, absolute local paths, server
configuration, or raw Excel rows.

### Create a run

`POST /api/v1/runs`

- Content type: `multipart/form-data`
- Required file field: `file`
- Optional text field: `report_date` in `YYYY-MM-DD`
- Success: `201 Created`
- `Location`: `/api/v1/runs/<runId>`
- Processing is synchronous in v1.
- Only one purchasing pipeline may run in a backend process at a time.
  A concurrent request receives `409 RUN_ALREADY_IN_PROGRESS`.

```bash
curl --fail-with-body \
  -F 'file=@data/incoming/miska-minmax-current.xlsx' \
  -F 'report_date=2026-07-23' \
  http://127.0.0.1:3210/api/v1/runs
```

Upload limits and validation:

- `.xlsx` and `.xls` transport extensions;
- maximum file size: 20 MiB;
- maximum multipart request size: 21 MiB;
- one file only;
- extension, MIME type, and file signature must agree;
- the existing SmartZapas Adapter performs final workbook validation;
- the client filename is display metadata only;
- the server writes only `upload.tmp`, then atomically renames it to
  `source.xlsx` or `source.xls`;
- temporary upload data is removed after success, failure, abort, or timeout.

### Run status

`GET /api/v1/runs/:runId`

```bash
curl http://127.0.0.1:3210/api/v1/runs/REPLACE_WITH_RUN_ID
```

Returns `RunStatusDTO` with lifecycle timestamps, safe source metadata,
warning count, error, and API links.

### Run summary

`GET /api/v1/runs/:runId/summary`

```bash
curl http://127.0.0.1:3210/api/v1/runs/REPLACE_WITH_RUN_ID/summary
```

The summary deliberately separates five monetary meanings:

| Field | Meaning |
|---|---|
| `analyzer_order_sum` | Preliminary sum calculated by the analyzer |
| `auto_approved_sum` | Sum automatically approved by decision rules |
| `pending_review_sum` | Sum still awaiting manual review |
| `working_maximum_sum` | Maximum working-order exposure, including pending lines |
| `financially_assessed_sum` | Legacy Analyzer-order sum assessed by Financial Controller |

There is no ambiguous `total_order_sum` browser field.

When `APPLY_SAFE` changes at least one working-order line, the summary also
contains `applied_working_order_financial`. This separate object reports the
working-order amounts, SKU, units, reserve, and financial status before and
after the approved rule. It does not replace `financially_assessed_sum` or the
legacy `financial_assessment` in `result.json`. If no rule is applied, the
object is `null` and the complete baseline result remains unchanged.

### Purchasing items

`GET /api/v1/runs/:runId/items`

Supported query parameters:

- `page`, default `1`;
- `page_size`, default `50`, maximum `100`;
- `q`;
- `decision`;
- `workflow_status`;
- `matrix_role`;
- `confidence`;
- `owner_review=true|false`;
- `positive_order=true|false`;
- `sort`;
- `order=asc|desc`.

```bash
curl 'http://127.0.0.1:3210/api/v1/runs/REPLACE_WITH_RUN_ID/items?page=1&page_size=50&owner_review=true'
```

Filtering occurs before pagination. Default sorting is deterministic:
`source_row` ascending, then `row_id` ascending.

### Owner Review

`GET /api/v1/runs/:runId/owner-review`

Optional query parameters are `section`, `page`, and `page_size`.

```bash
curl 'http://127.0.0.1:3210/api/v1/runs/REPLACE_WITH_RUN_ID/owner-review?section=top_priority&page_size=30'
```

A red Owner Review status means that a commercial owner decision is required.
It is a business status, not an HTTP failure or technical backend error.

### Download an artifact

`GET /api/v1/runs/:runId/artifacts/:artifactName`

```bash
curl --fail-with-body \
  -OJ \
  http://127.0.0.1:3210/api/v1/runs/REPLACE_WITH_RUN_ID/artifacts/result.json
```

The response is the raw streamed file with `Content-Type`,
`Content-Disposition: attachment`, `Content-Length`,
`X-Content-Type-Options: nosniff`, and `Cache-Control: no-store`.
Artifact downloads do not use the JSON success wrapper.

Allowed artifact names are fixed:

- `result.json`
- `report.txt`
- `recommendation-explanations.json`
- `recommendation-explanations-report.md`
- `matrix-draft.json`
- `matrix-report.txt`
- `manual-review.json`
- `owner-review.json`
- `owner-review-report.md`
- `owner-learning-report.json`
- `owner-learning-report.md`
- `owner-learning-patterns.json`
- `owner-learning-patterns.md`
- `owner-rule-proposals.json`
- `owner-rule-proposals.md`
- `approved-rule-preview.json`
- `approved-rule-preview.md`
- `approved-rule-applications.json` (published only in `APPLY_SAFE`)
- `run-metadata.json`

The client name is never used directly as a filesystem path. Resolution
requires both the whitelist and the run manifest. Traversal, encoded
traversal, separators, NUL bytes, absolute paths, cross-run paths, directory
listing, and symbolic-link escapes are rejected.

## Output structure

```text
output/purchasing-web/
├── uploads/
└── runs/
    └── <runId>/
        ├── run.json
        ├── summary.json
        ├── items.json
        ├── owner-review-compact.json
        └── artifacts/
            ├── manifest.json
            └── <whitelisted artifacts>
```

`manifest.json` contains only browser-safe metadata:

- `name`
- `content_type`
- `size_bytes`
- `sha256`
- `download_url`

It contains no absolute paths, temporary filenames, or server configuration.

## Retention and startup cleanup

On server startup:

- completed runs older than the configured TTL are removed;
- `processing` runs are preserved;
- abandoned `upload.tmp`, `source.xlsx`, and `source.xls` files in valid
  upload staging directories are removed;
- absent storage directories are treated as an empty store;
- cleanup failures are logged with generic messages that do not expose local
  paths or sensitive data.

The default completed-run TTL is 24 hours.

## Graceful shutdown

The CLI server handles `SIGINT` and `SIGTERM`. On the first signal it stops
accepting new connections and waits up to 10 seconds for active HTTP
connections to finish. A second signal closes active connections and forces
termination. Shutdown does not delete a `processing` run.

## HTTP errors

| Status | Codes |
|---:|---|
| `400` | `INVALID_MULTIPART`, `FILE_REQUIRED`, `MULTIPLE_FILES`, `INVALID_REPORT_DATE`, `INVALID_QUERY`, `INVALID_RUN_ID`, `INVALID_ARTIFACT_NAME` |
| `403` | `ARTIFACT_NOT_ALLOWED` |
| `404` | `RUN_NOT_FOUND`, `ARTIFACT_NOT_FOUND` |
| `409` | `RUN_NOT_READY`, `RUN_FAILED`, `RUN_ALREADY_IN_PROGRESS` |
| `413` | `UPLOAD_TOO_LARGE` |
| `415` | `UNSUPPORTED_FILE_TYPE` |
| `422` | `INVALID_WORKBOOK`, `INPUT_CONTRACT_ERROR` |
| `500` | `RUN_FAILED`, `ARTIFACT_STREAM_ERROR` |
| `507` | `STORAGE_ERROR` |

## Local v1 limitations

- localhost only;
- no authentication or multi-user authorization;
- synchronous processing;
- no database or durable job queue;
- no frontend;
- no artifact range requests;
- no CORS;
- no remote deployment contract;
- no automated purchase-order creation or sending.

These constraints are deliberate. Local v1 provides a small, auditable
backend boundary while all purchasing decisions remain explainable and under
human control.
