# Full Purchasing Agent run CLI

The full-run CLI turns one local SmartZapas Excel export into an auditable
Purchasing Agent result folder. It reuses the existing XLSX adapter, Phase 1
and Phase 2 services, Miska demand profile, financial file input, and agent
text report. It does not duplicate purchasing formulas or connect to 1C, a
bank, an API, or n8n.

The command never writes to the input Excel or financial JSON.

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
    ├── report.txt
    └── run-metadata.json
```

The default `output/` tree is ignored by Git. JSON uses UTF-8, two-space
indentation, and a final newline.

`result.json` contains the complete serialized return value from the existing
Purchasing Agent entry point. `report.txt` contains a compact owner header,
Phase 1/2 decision distributions, warnings and critical problems, followed by
the existing Russian agent report and financial assessment.

## Output formats

Create JSON and text:

```bash
--format all
```

Create only `result.json`:

```bash
--format json
```

Create only `report.txt`:

```bash
--format text
```

`run-metadata.json` is always created for a non-dry-run execution.

## Dry-run

Dry-run validates and hashes the input, runs the complete agent, loads the
financial source, and prints the terminal summary without creating an output
folder:

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
  "financial_data_file": "/absolute/path/to/miska-financial-current.json",
  "financial_data_sha256": "...",
  "output_directory": "/absolute/path/to/output/purchasing/2026-07-19_14-35-12",
  "agent_version": "1.0.0",
  "node_version": "v24.0.0",
  "status": "success_with_warnings",
  "generated_files": [
    "result.json",
    "report.txt",
    "run-metadata.json"
  ],
  "warnings": [
    "Verify that SmartZapas free stock or analyzer recommendation reflects expected receipts"
  ],
  "errors": []
}
```

`input_file_sha256` and `financial_data_sha256` identify the exact local source
bytes. A missing financial file has a `null` financial hash and a warning. A
missing or unreadable input workbook is fatal and produces no partial result.

## Existing folders and `--force`

The timestamp folder must not already exist. A collision stops with a non-zero
exit code:

```text
Папка запуска уже существует ... Используйте --force ...
```

`--force` explicitly permits replacement of only `result.json`, `report.txt`,
and `run-metadata.json` requested for that exact timestamp folder. Neighboring
run folders and unrelated files are not removed.

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
- Existing timestamp folder without `--force`: fatal; existing files remain
  unchanged.
- Output write failure: fatal; partial final files are rolled back.

Run the complete option reference with:

```bash
npm run purchasing:run -- --help
```
