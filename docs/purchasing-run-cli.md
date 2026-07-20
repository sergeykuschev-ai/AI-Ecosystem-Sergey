# Full Purchasing Agent run CLI

The full-run CLI turns one local SmartZapas Excel export into an auditable
Purchasing Agent result folder. It reuses the existing XLSX adapter, Phase 1
and Phase 2 services, Miska demand profile, financial file input, and agent
text report. It does not duplicate purchasing formulas or connect to 1C, a
bank, an API, or n8n.

The command never writes to the input Excel, financial JSON, or assortment
matrix JSON.

## Prepare the input

Use a readable SmartZapas workbook with an `.xlsx` or `.xls` extension. The
same three-row SmartZapas adapter used by the public agent entry points reads
the workbook. A renamed CSV, damaged archive, unsupported workbook, or missing
required SmartZapas columns fails before result files are created.

Raw commercial workbooks remain ignored by Git. The repository contains only
the approved synthetic XLSX fixture for automated tests.

The default financial source is:

```text
data/purchasing/miska-financial-current.json
```

The required Miska assortment source is:

```text
data/purchasing/miska-assortment-matrix.json
```

An invalid or missing assortment matrix is fatal for the full Miska run. No
result files are created. See
[`purchasing-assortment-matrix.md`](purchasing-assortment-matrix.md) for its
validation, matching, and control rules.

Missing or invalid financial JSON does not stop product analysis. The run
succeeds with warnings, the financial assessment becomes `PRELIMINARY`, and
the report records the loader error.

## Normal run

From the repository root on macOS:

```bash
npm run purchasing:run -- \
  --input "data/incoming/valta-order.xlsx"
```

Defaults:

- financial data: `data/purchasing/miska-financial-current.json`;
- assortment matrix: `data/purchasing/miska-assortment-matrix.json`;
- output root: `output/purchasing`;
- store: `Миска`;
- run date: current local date;
- format: `all`.

Relative paths are resolved from the current working directory. Absolute
macOS paths are also supported:

```bash
npm run purchasing:run -- \
  --input "/Users/example/Downloads/valta-order.xlsx"
```

## Financial source and store label

Select another local financial JSON:

```bash
npm run purchasing:run -- \
  --input "data/incoming/valta-order.xlsx" \
  --financial-data "data/purchasing/miska-financial-current.json"
```

Change the owner-facing store label and run date when preparing a reviewed
historical run:

```bash
npm run purchasing:run -- \
  --input "data/incoming/valta-order.xlsx" \
  --store "Миска" \
  --run-date 2026-07-19
```

`--store` changes report and metadata labeling only. It does not change
product rules or financial formulas.

The adapter determines the SmartZapas report date in this order: an exact
timestamp in the filename, XLSX workbook core properties or an explicit
period inside the workbook, and finally `--report-date`. It never substitutes
the current system date as the report date. When none of these sources is
available, weekly periods remain unclassified and the result contains a clear
warning.

For a workbook without usable date metadata, provide the report date:

```bash
npm run purchasing:run -- \
  --input "data/incoming/miska-minmax-current.xlsx" \
  --report-date 2026-07-19
```

`--report-date` is distinct from `--run-date`: the former describes the input
report, while the latter controls the output folder and run identifier. A
date-only report value uses calendar-day completion semantics. An exact
workbook or filename timestamp can additionally exclude a week whose final
day had not fully elapsed.

Select an explicit assortment matrix file with:

```bash
npm run purchasing:run -- \
  --input "data/incoming/valta-order.xlsx" \
  --assortment-matrix "data/purchasing/miska-assortment-matrix.json"
```

## Output location and structure

Choose another output root with `--output-dir`:

```bash
npm run purchasing:run -- \
  --input "data/incoming/valta-order.xlsx" \
  --output-dir "tmp/purchasing-runs"
```

Each run uses a timestamp folder:

```text
output/purchasing/
└── 2026-07-19_14-35-12/
    ├── result.json
    ├── recommendation-explanations.json
    ├── report.txt
    ├── recommendation-explanations-report.md
    └── run-metadata.json
```

The default `output/` tree is ignored by Git. JSON uses UTF-8, two-space
indentation, and a final newline.

`result.json` contains the complete serialized return value from the existing
Purchasing Agent entry point. `report.txt` contains a compact owner header,
Phase 1/2 decision distributions, warnings and critical problems, followed by
the existing Russian agent report and financial assessment.
`recommendation-explanations.json` and
`recommendation-explanations-report.md` are deterministic presentation/audit
artifacts. They explain the already-computed purchasing, matrix, owner, and
financial signals without changing `result.json`.

## Output formats

Create JSON and text:

```bash
--format all
```

Create JSON result and JSON explanations:

```bash
--format json
```

Create the text report and Markdown explanations:

```bash
--format text
```

`run-metadata.json` is always created for a non-dry-run execution.

## Dry-run

Dry-run validates and hashes the input, runs the complete agent, loads the
financial source and assortment matrix, and prints the terminal summary
without creating an output folder:

```bash
npm run purchasing:run -- \
  --input "tests/fixtures/SmartZapas_synthetic.xlsx" \
  --dry-run
```

Example terminal summary:

```text
Статус запуска: success_with_warnings (dry-run)
Папка результатов: не создавалась
Сумма заказа: 90,50 RUB
Товарных строк: 6
Финансовый статус: APPROVED
Запас сверх резерва: 126 012,02 RUB
Созданные файлы: нет
```

## Metadata contract

`run-metadata.json` records operational provenance:

```json
{
  "run_id": "purchasing-20260719-143512-a1b2c3",
  "started_at": "2026-07-19T04:35:12.000Z",
  "completed_at": "2026-07-19T04:35:13.000Z",
  "duration_ms": 1000,
  "store": "Миска",
  "input_file": "/absolute/path/to/valta-order.xlsx",
  "input_file_size": 5268,
  "input_file_sha256": "...",
  "report_date_override": null,
  "resolved_report_date": "2026-07-19",
  "resolved_report_date_source": "workbook_core_properties",
  "resolved_report_timestamp": "2026-07-19T06:00:53",
  "resolved_report_timestamp_source": "workbook_core_properties",
  "financial_data_file": "/absolute/path/to/miska-financial-current.json",
  "financial_data_sha256": "...",
  "assortment_matrix_file": "/absolute/path/to/miska-assortment-matrix.json",
  "assortment_matrix_sha256": "...",
  "output_directory": "/absolute/path/to/output/purchasing/2026-07-19_14-35-12",
  "agent_version": "1.0.0",
  "node_version": "v24.0.0",
  "status": "success_with_warnings",
  "generated_files": [
    "result.json",
    "recommendation-explanations.json",
    "report.txt",
    "recommendation-explanations-report.md",
    "run-metadata.json"
  ],
  "recommendation_explanations": {
    "version": "miska-recommendation-explainer-v0.6",
    "explained_sku_count": 403,
    "json_file": "recommendation-explanations.json",
    "markdown_file": "recommendation-explanations-report.md",
    "matrix_context_available": true,
    "matrix_builder_version": "miska-matrix-builder-v0.5.3"
  },
  "warnings": [
    "Verify that SmartZapas free stock or analyzer recommendation reflects expected receipts"
  ],
  "errors": []
}
```

The input, financial, and assortment hashes identify the exact local source
bytes. A missing financial file has a `null` financial hash and a warning. A
missing or unreadable input workbook or required assortment matrix is fatal
and produces no partial result.

## Existing folders and `--force`

The timestamp folder must not already exist. A collision stops with a non-zero
exit code:

```text
Папка запуска уже существует ... Используйте --force ...
```

`--force` explicitly permits replacement of files requested for that exact
timestamp folder: `result.json`, `report.txt`, `run-metadata.json`, and, when
created by the selected format, `recommendation-explanations.json` and
`recommendation-explanations-report.md`. Neighboring run folders and unrelated
files are not removed.

## Safe-write behavior

All requested outputs are prepared as temporary files in the run directory.
Every JSON temporary file is parsed again before any final name is installed.
Existing target files in force mode are moved to isolated backups. Temporary
files are then atomically renamed to their final names as one batch.

If writing, validation, or renaming fails, the CLI removes new partial files,
restores available backups, cleans temporary files, and returns a non-zero exit
code. It never modifies the Excel workbook or financial JSON.

## Error behavior

- Missing, unreadable, invalid-extension, or corrupted Excel: fatal; no
  `result.json` is created.
- Missing or invalid financial JSON: product analysis completes; financial
  status is `PRELIMINARY`; overall status is `success_with_warnings`.
- Missing or invalid assortment matrix JSON: fatal; no result files are
  created.
- Existing timestamp folder without `--force`: fatal; existing files remain
  unchanged.
- Output write failure: fatal; partial final files are rolled back.

Run the complete option reference with:

```bash
npm run purchasing:run -- --help
```
