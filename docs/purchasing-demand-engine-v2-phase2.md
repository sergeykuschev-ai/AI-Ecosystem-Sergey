# Purchasing Demand Engine v2 — Phase 2

## Purpose

Phase 2 adds deterministic demand, assortment, and supply-cycle calculations
after the existing SmartZapas analyzer. It preserves the analyzer quantity as a
comparison signal and does not modify the SmartZapas adapter, report-local
`rowIdentity`, `matchingHints`, or Phase 1 entry-point behavior.

Use `runOrderAgentFromSmartZapasXlsxWithDemand(filePath, phase2Inputs)` for a
Phase 2 run. `runOrderAgentFromSmartZapasXlsx(filePath)` remains the Phase 1
entry point.

## Required inputs

Phase 2 accepts three versioned external sources:

- sales history containing `sales7`, `sales14`, and `sales30`;
- mandatory assortment matrix;
- confirmed in-transit quantities.

The assortment matrix uses this shape:

```json
{
  "version": "assortment-v1",
  "products": [
    {
      "matchType": "barcode",
      "matchKey": "0123456789012",
      "mandatory": true,
      "minDisplayStock": 3,
      "assortmentPriority": "critical",
      "strategicSku": true,
      "strategicBrand": false,
      "notes": "Approved business input"
    }
  ]
}
```

`assortmentMatrixMode` controls whether this dataset is critical:

- `optional` is the default. An absent matrix is reported once as
  `not_provided`, leaves `mandatoryAssortment` unknown, and contributes a zero
  mandatory gap without blocking an otherwise complete demand calculation.
- `required` makes an absent matrix blocking and reports
  `required_not_provided`.
- `disabled` ignores assortment records and contributes a zero mandatory gap.

Sales and in-transit sources use the same `version`, `products`, `matchType`,
and `matchKey` envelope. They add sales-period fields or
`inTransitQuantity`, respectively. Blank values are unknown; numeric zero is a
confirmed value. Negative sales and negative in-transit values are invalid.
Per-product in-transit status is one of `source_not_provided`,
`quantity_unknown`, `confirmed_zero`, or `known_positive`. A missing dataset is
never converted to zero and is reported once at report level.

## Exact matching rules

Input records are matched in this strength order:

1. exact barcode;
2. exact internal product ID;
3. exact normalized supplier plus article, only when unique in the report;
4. exact normalized product name, optionally supplier-scoped, only when unique.

Supplier/article keys may be represented as
`{"supplier":"...","article":"..."}`. Supplier-scoped name keys use
`{"supplier":"...","name":"..."}`. Fuzzy similarity is never an automatic
match. Ambiguous supplier/article or normalized-name candidates remain
unmatched and emit diagnostics. An ambiguous assortment candidate leaves
mandatory status unknown and forces manual review; it is never treated as a
non-mandatory match. Every report row remains independent.

Assortment results expose match method and confidence. Exact barcode and
internal ID are high confidence, supplier/article is medium, and exact
normalized-name fallback is low.

## Sales-rate formula

Each known period is converted to a daily rate before weighting:

```text
rate7  = sales7  / 7
rate14 = sales14 / 14
rate30 = sales30 / 30

salesDailyRate =
  (rate7 × 0.50 + rate14 × 0.30 + rate30 × 0.20)
  / sum(weights for available periods)
```

If a period is missing, its weight is removed and the remaining weights are
renormalized. Missing periods are retained in `requiredData` and produce a
partial-history warning, but an available rate may still be calculated. If all
periods are missing or any supplied value is invalid, the demand rate and final
quantity are `null` and the decision requires review.

Three numeric zero periods produce a confirmed zero rate and
`zero_sales_30d`. They do not produce an automatic order unless a confirmed
mandatory assortment gap exists.

## Supply cycle and safety stock

Supplier cycles are configured in `DEMAND_ENGINE_CONFIG`. Valta is explicitly
mapped to its 14-day default. There is no global fallback for unknown suppliers,
because applying Valta's cycle elsewhere would invent supply data. A caller may
supply an exact normalized supplier override through
`phase2Inputs.supplierDeliveryCycleDays`.

Safety-stock defaults are:

| ABC/XYZ | Days |
| --- | ---: |
| A/X | 21 |
| A/Y | 14 |
| A/Z | 7 |
| B/X | 14 |
| B/Y | 7 |
| B/Z | 0 |
| C/X | 7 |
| C/Y | 0 |
| C/Z | 0 |
| D/ZZ | 0 |

An unsupported or missing ABC/XYZ combination leaves safety stock unknown and
requires review.

## Quantity formulas

```text
targetCoverageDays = supplierDeliveryCycleDays + safetyStockDays

targetStock = ceil(salesDailyRate × targetCoverageDays)

availableStock = freeStock + inTransitQuantity

demandCalculatedQuantity = max(0, targetStock - availableStock)

mandatoryMinimumGap = mandatoryAssortment
  ? max(0, minDisplayStock - availableStock)
  : 0

finalRecommendedQuantity = max(
  analyzerCalculatedQuantity,
  demandCalculatedQuantity,
  mandatoryMinimumGap
)
```

The final quantity is calculated only when its critical inputs are known.
Unknown free stock, all sales missing, unknown in-transit stock, a required but
missing assortment source, invalid safety stock, or missing analyzer quantity
leaves it `null`. An optional missing assortment matrix does not block the
calculation. A confirmed in-transit quantity is always included in available
stock.

## Phase 2 decisions

- Non-positive final quantity produces `do_not_buy`.
- A critical mandatory product with known inputs and a positive final quantity
  produces `must_buy`.
- A/X produces `must_buy`; A/Y and consistent B/X produce `recommended`.
- A/Z, B/Z, and C/Z require manual review; C/Y is postponed.
- An all-zero sales history blocks automatic ordering unless a mandatory
  display-stock gap is confirmed.
- A 7-day daily rate greater than twice the 30-day rate emits
  `short_term_sales_spike`. A final quantity of at least 20 units or value of at
  least 5,000 RUB requires manual review.
- A 7-day rate below half the 30-day rate emits `declining_sales` and lowers
  confidence.
- Missing critical inputs produce `manual_review`, `null` approved quantity,
  and explicit `requiredData`.
- When the analyzer quantity is zero, all sales are missing, mandatory status is
  not confirmed, and no positive demand exists, Phase 2 emits a low-confidence
  provisional `do_not_buy` with `decisionBasis: provisional_phase1_no_order`.
  This means “no Phase 1 action while Phase 2 data is unavailable,” not a
  commercially validated rejection. Positive analyzer lines with missing Phase
  2 inputs remain `manual_review`.

Phase 2 scoring is deterministic and configured beside the demand defaults.
The score starts at 40 and adds evidence for known final quantity (+20), known
stock (+15), valid sales (+15), complete sales (+10), critical mandatory status
(+20), and A/X (+15), A/Y (+10), or B/X (+5). Missing critical fields deduct 15
each; missing sales periods deduct 5 each; spike and decline warnings deduct 15
and 10. Confidence thresholds remain high at 85 and medium at 50.

## Summary fields

Phase 2 adds:

- `productsWithSalesData`
- `productsMissingAllSales`
- `mandatoryProductsMatched`
- `mandatoryProductsMissing`
- `mandatoryZeroStockCount`
- `demandOrderLines`
- `demandOrderSum`
- `finalApprovedLines`
- `finalApprovedSum`
- `analyzerVsFinalQuantityDelta`
- `analyzerVsFinalSumDelta`
- `provisionalNoActionCount`
- `positiveAnalyzerLinesAwaitingData`
- `assortmentMatrixStatus`
- `inTransitSourceStatus`

Unavailable business totals are `null`, not zero. Analyzer fields and Phase 1
decisions remain present for comparison in Phase 2 results.

The Phase 2 report contains a single `Missing input datasets` section. Dataset-
level absence is not repeated in every product's `requiredData`; row-specific
missing or invalid values remain attached to their affected rows.

## Limitations and required real inputs

- SmartZapas history is not treated as 7/14/30 sales because the export does
  not establish those three approved periods.
- Mandatory status and strategic SKU/brand status come only from a supplied
  matrix; they are never inferred from names.
- Supplier availability, order multiplicity, profitability, turnover,
  promotions, and seasonality are not Phase 2 inputs.
- Exact normalized-name matching is a low-confidence fallback, not fuzzy
  matching.
- Real order totals cannot be validated until approved Valta sales, assortment,
  and in-transit inputs are supplied and matched.

The committed JSON fixtures under `tests/fixtures/` are synthetic and contain
no commercial product data.
