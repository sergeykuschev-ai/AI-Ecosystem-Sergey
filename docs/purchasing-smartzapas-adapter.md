# SmartZapas Adapter v1

The SmartZapas adapter is the spreadsheet boundary for the Purchasing Agent. It
reads the first worksheet of an `.xlsx` export, combines rows 1-3 into canonical
header paths, and returns normalized product rows with provenance and
diagnostics. It does not calculate purchasing quantities or perform cross-report
product merging.

## Public API

The existing n8n entry point remains unchanged:

```js
const { runOrderAgent } = require('../agents/purchasing/order_agent');

const result = runOrderAgent($input.all());
```

SmartZapas XLSX processing uses a separate entry point:

```js
const {
  runOrderAgentFromSmartZapasXlsx,
} = require('../agents/purchasing/order_agent');

const result = await runOrderAgentFromSmartZapasXlsx('/path/to/export.xlsx');
```

`runOrderAgentFromAdapterResult(adapterResult)` is available when orchestration
has already called `readSmartZapasExport(filePath)`.

## Report-local identity

Every retained product has a deterministic `rowIdentity` containing:

- the SHA-256 report-content fingerprint;
- the worksheet name;
- the 1-based source row number.

Barcode and internal product ID set `identityBasis` and may provide `matchKey`,
but never suppress a repeated source row. Article and product name are not used
to construct `rowIdentity`.

The adapter emits `matchingHints` for a future cross-report matching service:
barcode, internal product ID, supplier, article, normalized descriptive name,
and extracted package tokens. No name similarity, fuzzy matching, or automatic
cross-report merge is performed by Adapter v1.

## Product classification

The primary SmartZapas product-row signal is a non-empty product name and
supplier. Article, barcode, and internal ID are optional.

A supplierless named row with identifier or ABC/XYZ signals is retained as a
product and recorded in `ambiguousRowClassifications` for review. A named row
without supplier or row-level product signals is classified as a group,
summary, or service row and recorded in `skippedServiceRows`. Aggregate price is
not treated as a product signal because SmartZapas group rows contain aggregate
prices.

## Stock semantics

A blank `freeStock` cell remains `null`. Its original source token and column
provenance are retained in `sourceTokens.freeStock` and
`provenance.fields.freeStock`.

Agent results distinguish:

- `confirmedZeroStockCount`;
- `unknownStockCount`;
- `zeroStockDaysWithBlankStockCount`.

The legacy `zero_stock_rows_count` remains available and equals the confirmed
zero count. Unknown stock is never reported as confirmed zero.

## Diagnostics

Every adapter result contains these arrays:

- `duplicateIdentifiers`;
- `identityFallbacks`;
- `ambiguousRowClassifications`;
- `skippedServiceRows`;
- `ambiguousColumns`;
- `missingRequiredColumns`.

Duplicate barcode, internal ID, or article values retain every source row and
produce `duplicateIdentifiers` with affected row identities and source row
numbers. Column resolution uses exact canonical header paths or anchored full
date-header patterns and never selects the first substring match.

## Fixtures and verification

The default suite uses the sanitized matrix fixture
`tests/fixtures/SmartZapas_sanitized.json` and the synthetic anonymized workbook
`tests/fixtures/SmartZapas_synthetic.xlsx`. No commercial workbook is required
in a clean checkout.

Run the optional real-workbook characterization by providing a local path:

```bash
SMARTZAPAS_REAL_FIXTURE=/absolute/path/to/report.xlsx npm test
```

The real workbook is never committed. Its optional characterization asserts
403 product rows, 72 structural rows, unique identities, preserved article
collisions, and stock-unknown counts.
