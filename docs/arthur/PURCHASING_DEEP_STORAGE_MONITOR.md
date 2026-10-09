# Miska purchasing: deep filesystem check after EIO recovery — 09.10.2026

## Why this exists

The purchasing container previously reported `healthy` while attempting
`fs.readdirSync('/app/data/purchasing')` raised `EIO`. An isolated test
identified a single legacy XLSX filename that Windows Docker bind mounts could
not enumerate. The original Excel payload was unchanged; the file was renamed
after validating a complete, hash-checked backup of 45 files.

The ordinary HTTP `/api/v1/health` check **cannot** detect this failure.

## Production-safe monitor change

The existing read-only `Arthur-Functional-Monitor` Windows Scheduled Task
still executes **every three hours**. Its existing
`purchasing-http-contract` check now additionally reads the actual
`/app/data/purchasing` directory **inside purchasing-web-backend**:

- Enforces a bounded directory count and regular files;
- Calls `lstat`, `open`, `read` and `close` on each file;
- Validates each JSON file parses;
- Validates XLSX ZIP magic bytes `PK`;
- Reports **only boolean success/failure**, no filenames, prices,
  SKUs, customer details or contents;
- On `EIO`, corrupt JSON/XLSX, missing directory or unexpected symlinks
  marks the existing purchasing check as `degraded`, even if HTTP 200.

The number of checks remains **13**, preserving the strict schema consumed
by Arthur's `/projects`. No Gateway code/image changed; no services restarted.

## Deployment and rollback

- Active module:
  `C:\AI-Ecosystem\candidates\arthur-functional-monitor-20261009\scripts\arthur\dev-worker\functional_checks.js`.
- Stored original:
  `C:\AI-Ecosystem\candidates\arthur-purchasing-eio-monitor-20261009\functional_checks.before-eio-monitor.js`.
- Replacement used .NET File.Replace with backup for atomic replacement.
- Deployed candidate passed read-only deep filesystem probe **healthy**.
- Windows Scheduled Task `Arthur-Functional-Monitor` was triggered and
  produced a new **13-check healthy** report:
  `purchasing-http-contract=healthy`, LastTaskResult **0**.
- Production Docker `purchasing-web-backend` remained `healthy`.

## Tests

- Functional monitor core + new EIO/corruption tests: **13/13 PASS** on
  Linux staging **and** on Windows Amursk. EIO, corrupted JSON, invalid XLSX
  signature, symlinks all fail closed.
- Purchasing XLSX + supplier-order unit tests in isolated production-image
  container: **27/27 PASS**.
- Full synthetic purchase order, manual review, XLSX formation and download
  in a second isolated image based on the actual current deployed
  `purchasing-web-backend:fe179b1-windows-fsync-20261009` with synthetic
  fixtures restored: **71/71 PASS**. The original attempt without fixture
  files failed due to missing image test assets; those were provided only in
  isolated image. Never mount/write working purchasing data into a test run.
- Demand engine, working order and assortment matrix tests in isolated image:
  **71 PASS, 1 SKIPPED**.

## Boundaries

These results cover the current deployed code with synthetic fixtures,
not live submission to Valta/Zoograd, not reconciliation with 1C, and not
an exhaustive audit of current supplier aliases. The existing supplier
scope/MinMax safety tests from newer development branches are not all
included in the deployed production image; they need a separate controlled
candidate/review before claims about every real supplier mapping. No real
order was created or sent. The `/projects` command still requires actual
Telegram client observation for the newest data.

Do not restart the entire Docker engine as a diagnostic step.
