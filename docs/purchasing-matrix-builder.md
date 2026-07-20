# Purchasing Matrix Builder

## Purpose and safety boundary

The Matrix Builder produces a reviewable draft assortment policy from a
SmartZapas Min-Max export. It is a separate local pipeline: it does not update
`data/purchasing/miska-assortment-matrix.json`, change Purchasing Agent
quantities, or submit any order.

Every output has `status: "draft"`. Review work is separated into identity,
commercial, exit, approved-policy conflict, large-inventory, and
insufficient-data queues. An SKU may belong to several queues, while the unique
manual-review total counts it once.

Only `approved` matrix values take precedence in the effective draft.
`placeholder` values remain visible but do not override the automatic draft or
count as approved conflicts. `requires_confirmation` is routed to review.

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
- `manual-review.json`: unique review items plus the six named review queues;
- `owner-review.json`: owner-facing review dashboard data with applied owner
  decisions;
- `owner-review-report.md`: Markdown owner review dashboard;
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
| Cumulative sold quantity | AJ, `история за период ... > продано > кол-во` | `reportedSalesQuantity` | possible-new and long-horizon evidence |
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

- `CORE`: at least eight reliable completed weeks, long-horizon average at or
  above the configured absolute threshold, enough active weeks, supporting
  A/B and X/Y signals, and no confirmed positive excess;
- `OPTIONAL`: low-significance, irregular, or excess-stock evidence;
- `NEW`: short reliable history plus unavailable cumulative sales (not a
  confirmed zero-sales history), always for review;
- `EXIT`: configured low classes plus zero sales over the category horizon
  (8, 12, or 26 weeks), no partial-week sale, no supplier demand, no strategic
  or approved-policy protection, enough history, positive inventory/excess,
  and a stable identifier; every candidate remains review-only;
- `UNCLASSIFIED`: missing or conflicting evidence, always for review.

The builder does not infer `TRAFFIC`, `PROFIT`, `IMAGE`, or `SEASONAL` without
explicit supporting configuration/data. In particular, `PROFIT` needs margin
evidence and seasonality needs a separately confirmed model.

Strategic groups use exact articles, exact normalized required tokens, and
explicit token-alternative sets. They do not use fuzzy names. A strategic
match may assign `important` and blocks automatic EXIT, but never creates CORE
without sufficient demand. Category profiles independently control EXIT
horizons, shelf presentation, and lead time.

## Stock policy

The v0.5.3 policy requires eight reliable completed weeks and prefers twelve.
It records short (4), base (8), preferred (12), and full-history averages. The
short average can raise the selected 8/12-week baseline only up to the
configured multiple of the full-history average:

```text
capped_short     = min(short_average, long_term_average * growth_cap)
effective_average = max(base_or_preferred_average, capped_short)
minimum          = max(profile shelf units, ceil(effective_average * profile cover))
safety           = ceil(weekly standard deviation * sqrt(lead time weeks))
target           = max(minimum, ceil(effective_average * 2) + safety)
maximum          = max(target, ceil(effective_average * 4) + safety)
```

Minimum and safety are independent: minimum represents shelf presentation,
while safety represents observed variability over an explicit lead time.
Confirmed all-zero histories produce numeric zero levels. Insufficient or
invalid history produces `null` policy values and review; it is never converted
to zero.

When purchase price is available, the draft records
`maximum_stock_value = maximum_stock * purchase_price`. Values at or above
10,000 RUB enter large-inventory review and values at or above 20,000 RUB are
marked critical. Missing price remains `null` and enters insufficient-data
review. The unit threshold remains as an independent backstop.

These parameters are conservative draft defaults, not approved Miska policy.
Their values, formula strings, completed period starts, source columns, and
value states are recorded in each SKU's provenance.

## Confidence and validation

Confidence is `high`, `medium`, or `low`. Repeated identifiers, absent stable
identifiers, too little history, and invalid values lower confidence. Review
membership is determined by explicit queues rather than by one undifferentiated
confidence flag. Per-SKU validation records errors and warnings without hiding
other valid SKU results.

Before promoting any recommendation into the working matrix, the owner should
review `manual-review.json`, reconcile conflicts, confirm NEW/EXIT candidates,
and explicitly approve the stock-policy parameters. Promotion is intentionally
outside Matrix Builder v0.5.3.

An approved item must be transferred manually: copy only the owner-confirmed
`priority`, `minimum_shelf_stock`, `target_stock`, and `allow_zero_stock` values
into the working matrix, keep the working matrix schema valid, run the full
test suite, and inspect a Purchasing Agent dry run. Never replace the working
matrix wholesale with `matrix-draft.json`.
