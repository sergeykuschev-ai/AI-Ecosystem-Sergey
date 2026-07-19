# Purchasing Matrix Builder

## Purpose and safety boundary

The Matrix Builder produces a reviewable draft assortment policy from a
SmartZapas Min-Max export. It is a separate local pipeline: it does not update
`data/purchasing/miska-assortment-matrix.json`, change Purchasing Agent
quantities, or submit any order.

Every output has `status: "draft"`. Low-confidence, new-product, exit, identity
ambiguity, and policy-conflict cases are routed to manual review. Existing
matrix values take precedence in the effective draft; any different automatic
suggestion is retained alongside them as a conflict for owner review.

`missing_stable_identifier` is distinct from `ambiguous_identity`: the former
means a row is valid but cannot yet be carried safely across reports, while the
latter means a present identifier or matrix match has multiple candidates.

## Run locally

Dry run:

```bash
npm run purchasing:matrix:build -- \
  --input "data/incoming/miska-minmax-current.xlsx" \
  --existing-matrix "data/purchasing/miska-assortment-matrix.json" \
  --dry-run
```

Write a timestamped review package:

```bash
npm run purchasing:matrix:build -- \
  --input "data/incoming/miska-minmax-current.xlsx" \
  --existing-matrix "data/purchasing/miska-assortment-matrix.json" \
  --output-dir "output/purchasing-matrix"
```

Use `--report-date YYYY-MM-DD` only when the filename and workbook metadata do
not provide a report date. The current system date is never silently used as
the SmartZapas report date. Use `--config <path>` to test an explicitly
versioned policy configuration.

Each written run contains exactly:

- `matrix-draft.json`: one recommendation and its provenance per recognized
  product row;
- `matrix-report.txt`: Russian-language owner review;
- `manual-review.json`: all items that need an explicit decision;
- `run-metadata.json`: source/config hashes, timestamps, counts, and validation
  totals.

`output/` is ignored by Git. Raw SmartZapas workbooks remain ignored and must
not be committed.

## Source data contract

The builder consumes only normalized rows from the SmartZapas adapter. The
real 2026-07-19 workbook audit established the following inputs:

| Evidence | SmartZapas source | Normalized field | Builder use |
| --- | --- | --- | --- |
| Product identity | article/barcode/internal ID plus report-local identity | `article`, `barcode`, `internalProductId`, `rowIdentity` | provenance and ambiguity detection; no row merging |
| Classification | ABC and XYZ columns | `abc`, `xyz` | CORE/OPTIONAL/EXIT evidence |
| Weekly sales | 27 columns named `история по периодам > неделя > с DD.MM.YY` | `weeklySalesHistory` | completed-week stock policy only |
| Cumulative sold quantity | AJ, `история за период ... > продано > кол-во` | `reportedSalesQuantity` | possible-new evidence only |
| Stock days | AQ, `текущие остатки > дней запаса` | `stockDays` | data quality evidence |
| Free stock | AR, `текущие остатки > свободный остаток` | `freeStock` | inventory evidence |
| Excess stock | AS, `текущие остатки > кол-во излишков` | `excessStock` | optional/exit evidence |
| In transit | AT, `текущие остатки > в пути` | adapter demand fields | preserved in the Purchasing Agent; not used to invent matrix policy |
| Reserve | AU, `текущие остатки > резерв` | adapter inventory fields | not treated as zero when absent |
| Need | AX, `потребность ...` | `needQty` | evidence only |
| Supplier recommendation | AY/AZ, `заказать у поставщика > кол-во/сумма` | `supplierOrderQty`, `supplierOrderSum` | evidence only; quantities are not modified |

Blank completed weekly cells are accepted only through the adapter's explicit
`blank_as_confirmed_zero` provenance. Invalid or nonnumeric values remain
unavailable. Partial and future weeks are excluded.

## Classification

Supported draft roles are `CORE`, `TRAFFIC`, `PROFIT`, `IMAGE`, `SEASONAL`,
`NEW`, `OPTIONAL`, `EXIT`, and `UNCLASSIFIED`.

The first configuration deliberately assigns only roles supported by current
evidence:

- `CORE`: configured A/B and X/Y classes, regular positive sales in enough
  completed weeks, and no confirmed positive excess;
- `OPTIONAL`: low-significance, irregular, or excess-stock evidence;
- `NEW`: short reliable history plus unavailable cumulative sales (not a
  confirmed zero-sales history), always for review;
- `EXIT`: configured low classes, confirmed zero completed-week sales,
  positive inventory/excess, and a stable source identifier, always for
  review;
- `UNCLASSIFIED`: missing or conflicting evidence, always for review.

The builder does not infer `TRAFFIC`, `PROFIT`, `IMAGE`, or `SEASONAL` without
explicit supporting configuration/data. In particular, `PROFIT` needs margin
evidence and seasonality needs a separately confirmed model.

Strategic groups in
`data/purchasing/miska-matrix-builder-config.json` use exact normalized token
sets. They do not use fuzzy names and do not merge products. The configuration
is a draft policy input and must be reviewed before it is treated as an
authoritative business rule.

## Stock policy

The policy uses the latest four completed weeks by default and requires at
least two reliable completed values. Let `average_weekly_sales` be the mean of
those reliable values. The versioned default is:

```text
minimum_shelf_stock = ceil(average_weekly_sales * 0.5)
safety_stock        = ceil(average_weekly_sales * 0.5)
target_stock        = max(minimum, ceil(average_weekly_sales * 2) + safety)
maximum_stock       = max(target, ceil(average_weekly_sales * 4) + safety)
```

For a positive rate, minimum is at least one unit. Confirmed all-zero weeks
produce numeric zero levels. Insufficient or invalid history produces `null`
policy values and manual review; it is never converted to zero.

These parameters are conservative draft defaults, not approved Miska policy.
Their values, formula strings, completed period starts, source columns, and
value states are recorded in each SKU's provenance.

## Confidence and validation

Confidence is `high`, `medium`, or `low`. A low-confidence result always
requires manual review. Repeated identifiers, absent stable source identifiers,
too little history, and invalid values lower confidence. Per-SKU validation
records errors and warnings without hiding other valid SKU results.

Before promoting any recommendation into the working matrix, the owner should
review `manual-review.json`, reconcile conflicts, confirm NEW/EXIT candidates,
and explicitly approve the stock-policy parameters. Promotion is intentionally
outside Matrix Builder v1.

An approved item must be transferred manually: copy only the owner-confirmed
`priority`, `minimum_shelf_stock`, `target_stock`, and `allow_zero_stock` values
into the working matrix, keep the working matrix schema valid, run the full
test suite, and inspect a Purchasing Agent dry run. Never replace the working
matrix wholesale with `matrix-draft.json`.
