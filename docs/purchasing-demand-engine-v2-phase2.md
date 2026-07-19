# Purchasing Demand Engine v2 — Phase 2

## Purpose

Phase 2 adds deterministic demand, assortment, and supply-cycle calculations
after the existing SmartZapas analyzer. It preserves the analyzer quantity as a
comparison signal and does not modify report-local `rowIdentity`,
`matchingHints`, or Phase 1 entry-point behavior.

Use `runOrderAgentFromSmartZapasXlsxWithDemand(filePath, phase2Inputs)` for a
Phase 2 run. `runOrderAgentFromSmartZapasXlsx(filePath)` remains the Phase 1
entry point.

## Required inputs

Phase 2 can accept three versioned external sources:

- sales history containing `sales7`, `sales14`, and `sales30`;
- mandatory assortment matrix;
- in-transit quantities, when the selected purchasing profile requires or
  permits a separate source.

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
`quantity_unknown`, `confirmed_zero`, `known_positive`,
`included_in_source_stock`, or `disabled`, depending on the configured mode.

`inTransitMode` controls how separate expected receipts are handled:

- `required` is the safe generic default. An absent in-transit source blocks
  final approval.
- `optional` uses supplied quantities when present. If the source is absent,
  the separate quantity is treated as zero for calculation and a single
  report-level warning records the assumption.
- `included_in_source_stock` is the Miska profile default. It assumes the
  previous order was registered in 1C as an expected receipt and is already
  reflected by SmartZapas. Separate in-transit quantity is therefore zero;
  supplied invoice data is ignored unless the caller explicitly selects
  `required` or `optional`, preventing double counting.
- `disabled` ignores separate in-transit logic and supplied quantities.

Unknown purchasing profiles resolve to the generic profile and its `required`
mode. A caller may explicitly override `inTransitMode`. The Miska assumption is
exposed as
`inTransitDecisionBasis: previous_order_registered_as_expected_receipt`,
`sourceStockIncludesExpectedReceipts: assumed`, and a preliminary result
status. The verification warning appears once at report level:
`Verify that SmartZapas free stock or analyzer recommendation reflects expected
receipts`.

`salesInputMode` selects the usable sales-rate source:

- `auto` is the default. It uses the source priority documented below.
- `period_sales` uses only matched 7/14/30-day sales values.
- `reported_daily_rate` uses only the normalized SmartZapas rate.

In `auto` mode the exact priority is:

1. SmartZapas completed weekly history using 7/14/28-day aggregates;
2. matched external 7/14/30-day inputs;
3. SmartZapas cumulative AJ quantity divided by its explicit period;
4. another confirmed SmartZapas reported daily rate;
5. unavailable.

The selected source is exposed as `smartzapas_weekly_weighted`,
`external_period_sales_weighted`, `smartzapas_cumulative_period`, or
`smartzapas_reported_daily_rate`. Negative, non-finite, or unit-ambiguous rates
are not automatically approved. Low-confidence rate semantics force manual
review for a positive analyzer or demand quantity.

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
`zero_sales_weighted_periods`. They do not produce an automatic order unless a confirmed
mandatory assortment gap exists.

SmartZapas weekly history uses a separate period configuration and never
substitutes `sales28` into the external `sales30` field:

```text
salesDailyRate =
  sales7  / 7  × 0.50 +
  sales14 / 14 × 0.30 +
  sales28 / 28 × 0.20
```

Missing 7/14/28 aggregates remove their weights and renormalize the remaining
weights. Confirmed blank weekly cells contribute zero; malformed tokens remain
missing. The exact source weeks are retained in `weeklyPeriodsUsed`. A partial
latest seven-day window is excluded before aggregation and exposed as
`excludedPartialWeek`. Timestamp-aware completion requires the period-end day
to have fully elapsed; date-only reports retain the inclusive date fallback.

In `auto` mode, a missing weighted rate may fall back to the adapter's
high-confidence daily average derived from SmartZapas's explicit cumulative
sales period. The target-stock and demand formulas below are unchanged. The
raw SmartZapas cumulative sales and automatic-velocity tokens remain available
in every demand row and report. SmartZapas's unitless `скорость > авто` value
is not converted to daily units.

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

availableStock = freeStock + separateInTransitQuantity

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
Unknown free stock, all sales missing, unknown required in-transit stock, a
required but missing assortment source, invalid safety stock, or missing
analyzer quantity leaves it `null`. An optional missing assortment matrix does
not block the calculation. In `included_in_source_stock` mode, separate
in-transit quantity is zero because expected receipts are assumed to be already
represented by the source; adding an invoice quantity again would double-count
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

## Purchasing workflow projection

The working-order projection is applied after the unchanged Phase 2 decision
engine. It does not recalculate quantities or alter decisions. It maps products
relevant to the purchasing workflow into:

- `auto_approved`: existing `must_buy` or `recommended` decisions with a
  positive approved quantity;
- `pending_manual_review`: a positive Phase 1 analyzer quantity or positive
  Phase 2 final recommendation exists, but automatic approval is blocked;
- `postponed`: the existing `postpone` decision;
- `confidently_excluded`: a positive Phase 1 quantity has a deterministic,
  complete-data `do_not_buy` result;
- `no_order_action`: no positive Phase 1 or Phase 2 quantity exists and no
  order review is required.

Manual-review products with neither a positive Phase 1 quantity nor a positive
Phase 2 recommendation remain visible as data-review diagnostics, but they are
not working-order lines. They are not silently classified as an order or a
confident exclusion.

Positive pending-review and postponed lines preserve a provisional quantity:

1. positive `finalRecommendedQuantity` with source
   `phase2_final_recommendation`;
2. otherwise positive `analyzerCalculatedQuantity` with source
   `phase1_analyzer_fallback`;
3. otherwise `null` with source `unavailable`.

`provisionalOrderQuantity` and `provisionalLineSum` are never approved
quantities. `approvalRequired` is true for pending manual review. The working
maximum combines only automatically approved quantities and provisional
pending-review quantities. It excludes postponed quantities and is labelled
`not_approved_not_ready_for_automatic_submission`.

Every positive Phase 1 analyzer line is reconciled exactly once into
`auto_approved`, `pending_manual_review`, `postponed`, or
`confidently_excluded`. Phase 2 additions are reported separately and do not
change the Phase 1 reconciliation.

## Summary fields

Phase 2 adds:

- `productsWithSalesData`
- `productsMissingAllSales`
- `productsWithPeriodSales`
- `productsWithReportedDailyRate`
- `productsUsingWeightedSales`
- `productsUsingSmartZapasRate`
- `productsMissingUsableSalesInput`
- `productsWithWeeklyHistory`
- `productsWithSales7`
- `productsWithSales14`
- `productsWithSales28`
- `productsUsingWeeklyWeightedRate`
- `productsUsingCumulativeFallback`
- `productsWithPartialLatestWeekExcluded`
- `productsMissingUsableSales`
- `blankWeeklyCellsInterpretedAsZero`
- `weeklyToCumulativeExactMatches`
- `weeklyToCumulativeToleranceMatches`
- `weeklyToCumulativeMismatches`
- `excludedPartialWeek`
- `mandatoryProductsMatched`
- `mandatoryProductsMissing`
- `mandatoryZeroStockCount`
- `demandOrderLines`
- `demandOrderSum`
- `finalApprovedLines`
- `finalApprovedSum`
- `autoApprovedLines`
- `autoApprovedSum`
- `pendingReviewLines`
- `pendingReviewProvisionalSum`
- `postponedLines`
- `postponedProvisionalSum`
- `confidentlyExcludedLines`
- `confidentlyExcludedPhase1Value`
- `workingMaximumLines`
- `workingMaximumSum`
- `workingMaximumStatus`
- `phase2AdditionLines`
- `workingOrderProducts`
- `phase1Reconciliation`
- `analyzerVsFinalQuantityDelta`
- `analyzerVsFinalSumDelta`
- `provisionalNoActionCount`
- `positiveAnalyzerLinesAwaitingData`
- `assortmentMatrixStatus`
- `purchasingProfile`
- `inTransitMode`
- `inTransitSourceStatus`
- `inTransitDecisionBasis`
- `sourceStockIncludesExpectedReceipts`
- `phase2ResultStatus`
- `reportWarnings`
- `demandQuantitiesCalculated`
- `finalQuantitiesCalculated`

Unavailable business totals are `null`, not zero. Analyzer fields and Phase 1
decisions remain present for comparison in Phase 2 results.

`finalApprovedLines` and `finalApprovedSum` remain compatibility fields from the
decision summary. User-facing reports call the same quantities the
automatically approved portion. They are not described as a complete or final
order while positive pending-review lines remain unresolved.

The Phase 2 report contains a single `Missing input datasets` section. Dataset-
level absence is not repeated in every product's `requiredData`; row-specific
missing or invalid values remain attached to their affected rows.

## Limitations and required real inputs

- SmartZapas cumulative history is not re-labeled as 7/14/30 sales. The dated
  cumulative quantity may provide a separate average daily rate because its
  exact period is explicit.
- SmartZapas `скорость > авто` has no declared unit and remains raw provenance;
  its approximately monthly interpretation is not used automatically.
- Mandatory status and strategic SKU/brand status come only from a supplied
  matrix; they are never inferred from names.
- Supplier availability, order multiplicity, profitability, turnover,
  promotions, and seasonality are not Phase 2 inputs.
- Exact normalized-name matching is a low-confidence fallback, not fuzzy
  matching.
- A Miska run using `included_in_source_stock` is preliminary until the
  SmartZapas expected-receipt semantics are confirmed operationally. Its
  separate in-transit quantity must not be interpreted as a confirmed physical
  zero.

The committed JSON fixtures under `tests/fixtures/` are synthetic and contain
no commercial product data.
