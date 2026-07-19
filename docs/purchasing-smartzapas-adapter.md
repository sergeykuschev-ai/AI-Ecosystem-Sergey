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

The 2026-07-19 Valta workbook exposes these exact inventory fields:

| Column | Canonical header | Normalized field | Real product rows with values |
| --- | --- | --- | ---: |
| AQ | `текущие остатки > дней запаса` | `stockDays` | 314 |
| AR | `текущие остатки > свободный остаток` | `freeStock` | 291 |
| AS | `текущие остатки > кол-во излишков` | `excessStock` | 89 |
| AT | `текущие остатки > в пути` | `inTransit` | 0 |
| AU | `текущие остатки > резерв` | `reserve` | 10 |
| AX | `потреб-ность 26.07.2026 - 09.08.2026` | `needQty` | 127 |
| AY | `заказать у поставщика > кол-во` | `supplierOrderQty` / `orderQty` | 403 |

No physical total-stock column is present. AR is explicitly the free,
available balance and AU is a separate reserved balance. In particular, rows
247 and 257 have a positive reserve while AR is blank. The adapter therefore
records `available_free_stock` semantics and the assortment projection uses:

```text
free_stock + in_transit + recommended_order_qty
```

It does not subtract AU a second time. The raw AT field is blank for all 403
products. Miska's existing `included_in_source_stock` profile separately and
explicitly supplies `inTransitQuantity: 0`; the adapter itself preserves raw
AT blanks as `null`. Raw inventory tokens and their exact columns are retained
under `sourceTokens` and `provenance.fields`.

Agent results distinguish:

- `confirmedZeroStockCount`;
- `unknownStockCount`;
- `zeroStockDaysWithBlankStockCount`.

The legacy `zero_stock_rows_count` remains available and equals the confirmed
zero count. Unknown stock is never reported as confirmed zero.

## Sales and coverage columns in the Valta export

The real workbook dated 2026-07-19 exposes these exact three-row header paths:

| Column | Canonical header | Interpretation | Confidence |
| --- | --- | --- | --- |
| I:AI | `история по периодам > неделя&#10;с&#10;DD.MM.YY` | quantity sold in each explicitly dated week | high |
| AJ | `история за период 12.01.2026 - 19.07.2026 > продано > кол-во` | units sold over the inclusive 189-day period | high |
| AK | `история за период 12.01.2026 - 19.07.2026 > продано > кол-во (сумма)` | sales amount; currency is not declared in the header | medium |
| AL | `история за период 12.01.2026 - 19.07.2026 > продано > сделок` | transaction count | high |
| AM | `история за период 12.01.2026 - 19.07.2026 > продано > ср.чек (кол-во)` | average units per transaction | high |
| AN | `история за период 12.01.2026 - 19.07.2026 > продано > объемы сделок` | textual transaction-size distribution | high |
| AO | `история за период 12.01.2026 - 19.07.2026 > дней наличия` | labeled availability days, but observed values are inconsistent with the 189-day period | low |
| AP | `скорость > авто` | reported automatic velocity; observed values are approximately units per month, but the header declares no unit | low |
| AQ | `текущие остатки > дней запаса` | current stock coverage in days | high |

No explicit average-daily-sales or turnover column was found. Stock coverage in
AQ is not treated as turnover. The adapter does not convert AP to a daily rate:
it preserves the raw token, emits `reported_sales_velocity_unit_not_declared`,
and labels its inferred monthly semantics as low confidence.

AJ is normalized as `reportedSalesQuantity`. Because its start and end dates
are explicit, the adapter records `reportedSalesPeriodDays: 189` and derives a
high-confidence `reportedDailySalesRate` using inclusive calendar days. The
original AJ and AP values remain in `sourceTokens` and `reportedSalesMetadata`.
If the period cannot be parsed exactly, no period or daily rate is fabricated.

### Weekly history normalization

The phrase `неделя с DD.MM.YY` establishes that the header date is the period
start. The adapter parses every matching weekly column, sorts periods by this
date rather than physical column position, and exposes:

```json
{
  "weeklySalesHistory": [
    {
      "periodStart": "2026-07-13",
      "periodEnd": "2026-07-19",
      "quantity": 1,
      "sourceColumn": "AI",
      "sourceHeader": "история по периодам > неделя&#10;с&#10;13.07.26",
      "rawValue": 1,
      "completionStatus": "completed"
    }
  ]
}
```

Blank-cell semantics are enabled only after report-level reconciliation. The
adapter sums all 27 finite weekly quantities for every product and compares the
total with cumulative AJ sales using a tolerance of `0.000001`. In the
characterized workbook all 403 products match exactly, with zero tolerance-only
matches, zero mismatches, and no invalid weekly or cumulative values. This
confirms that blank cells represent zero sales in recognized completed weeks.

Every weekly value retains one provenance state:

- `explicit_zero`;
- `blank_as_confirmed_zero`;
- `positive_quantity`;
- `invalid_value`.

An incomplete-period blank remains `blank_unavailable_incomplete_period` and is
not used. Negative or non-numeric tokens remain unavailable and are recorded in
`weeklySalesWarnings`; they are never converted to zero. Raw tokens and source
headers remain available.

The rolling fields are derived only from completed seven-day windows:

- `sales7`: latest completed week;
- `sales14`: latest two completed weeks;
- `sales28`: latest four completed weeks.

An aggregate is `null` if any constituent weekly quantity is missing. This
allows Phase 2 to renormalize the remaining configured aggregate weights rather
than silently treating missing history as zero. `weeklyPeriodsUsed` records the
exact period-start dates used for each aggregate.

Completion uses the report timestamp when it is available. A week completes
only after its period-end calendar day has fully elapsed. Therefore a timestamp
on the period-end day still marks that week partial. When only a report date is
known, the adapter retains the date-only fallback in which a period ending on
that date is complete. If neither can be established, weekly values are
preserved but not used for rolling demand.

For the characterized workbook, both the original filename and XLSX core
properties contain `2026-07-19T06:00:53`. A renamed current workbook can
therefore preserve timestamp-aware completion through its content metadata.
The resolution order is filename timestamp, workbook content, explicit run
metadata, and finally an unavailable-date warning; the current system date is
never substituted silently. Of 27 detected periods, 26 are complete. The period
starting 2026-07-13 and ending 2026-07-19 is excluded as partial. Rolling dates
are therefore:

- `sales7`: 2026-07-06;
- `sales14`: 2026-06-29 and 2026-07-06;
- `sales28`: 2026-06-15, 2026-06-22, 2026-06-29, and 2026-07-06.

The reconciliation covers all 27 source columns, including the preserved
partial-week values, because cumulative AJ also ends on 2026-07-19. The rolling
demand calculation excludes that partial period independently.

## Diagnostics

Every adapter result contains these arrays:

- `duplicateIdentifiers`;
- `identityFallbacks`;
- `ambiguousRowClassifications`;
- `skippedServiceRows`;
- `ambiguousColumns`;
- `missingRequiredColumns`.
- `salesSemanticsWarnings`.
- `reportDateWarnings`.

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
