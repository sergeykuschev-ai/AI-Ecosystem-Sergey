# Miska mandatory assortment matrix

The Miska Purchasing Agent can apply a required, file-based assortment matrix
after SmartZapas normalization and during the existing Phase 2 flow. The
matrix is a purchasing quality-control input. It does not modify the Phase 1
analyzer formula, weekly-sales calculation, demand formula, or financial
controller.

The working file is:

```text
data/purchasing/miska-assortment-matrix.json
```

The full-run CLI loads this file by default. A missing, unreadable, malformed,
or structurally invalid required matrix stops the local run before commercial
output files are written. This prevents a plausible-looking Miska order from
being produced without its required assortment control.

## File contract

```json
{
  "version": 1,
  "updated_at": "2026-07-19",
  "store": "Миска",
  "items": [
    {
      "article": "7173648",
      "name": "AWARD Urinary ... 1,5 кг",
      "brand": "AWARD",
      "category": "Сухой корм для кошек",
      "priority": "critical",
      "policy_status": "approved",
      "minimum_shelf_stock": 2,
      "target_stock": 4,
      "allow_zero_stock": false,
      "notes": "Обязательная стратегическая позиция"
    }
  ]
}
```

Required item fields are `name`, `priority`, `minimum_shelf_stock`,
`target_stock`, and `allow_zero_stock`. `policy_status` is explicit in the
working file and accepts `approved`, `placeholder`, or
`requires_confirmation`; legacy files without it load as `approved` for
backward compatibility. `article`, `brand`, `category`, and `notes` are
optional. Allowed priorities are `critical`, `important`, and `standard`.
Stock values must be finite numbers greater than or equal to zero, and
`target_stock` cannot be below `minimum_shelf_stock`.

Do not invent articles or stock policies. When an article is not confirmed,
keep it `null` and add `article_requires_confirmation` to `notes`.

The initial file contains the requested AWARD, CRAFTIA, Мнямс, Cat's Choice,
Bambini Pets, and Ферма кота Федора groups using names and articles observed in
the 2026-07-19 local SmartZapas report. The AWARD Urinary 2/4 critical policy
is the only item policy explicitly supplied with the implementation request;
it has `policy_status: "approved"`. Other initial entries use a non-enforcing
`standard`, 0/0 policy with `policy_status: "placeholder"`. Matrix Builder may
show their differences but does not treat them as approved conflicts. A
business owner must set their real priority and shelf thresholds before those
entries become approved rules.

## Deterministic matching

The loader uses this order:

1. exact normalized article, only when both the report article and matrix
   article identify one item;
2. exact normalized full name when the article is missing or ambiguous.

Name normalization folds case, `ё`/`е`, whitespace, and punctuation. It does
not use substring or fuzzy matching. If an article is repeated, exact names
may distinguish its rows. Otherwise the match remains ambiguous and is
reported as missing/ambiguous; rows are never merged or discarded.

## Inventory projection

For each report product the result includes `assortment_matrix` and
`inventory_projection`. Projection follows:

```text
projected_stock = freeStock + inTransit + recommended_order_qty
```

The SmartZapas source column is explicitly named `Текущие остатки > Свободный
остаток`; the workbook also exposes `Текущие остатки > Резерв` separately.
`freeStock` therefore represents stock already available after reservations,
so subtracting `reserve` again would double-count the reservation. Reserve is
preserved with provenance but is not required by this SmartZapas formula.

Every product receives an `inventory_projection` object with
`calculation_status`, `missing_fields`, and the actual `formula`. Missing
required values remain `null`; `null`, `undefined`, and blank source cells are
never silently converted to zero. A separately configured physical-stock
model may use `free_stock + in_transit - reserve + recommended_order_qty`; in
that model reserve is required. The recommended quantity is the existing
Phase 2 final quantity when available, otherwise the unchanged Phase 1
analyzer quantity is exposed for review. The assortment controller does not
create or cap a quantity itself.

For `critical` and `important` items, incomplete projection data requires
manual review. A critical item cannot remain `do_not_buy` while its projected
stock is below the matrix minimum. Confirmed zero stock with positive sales is
`must_buy` when a positive existing recommendation is available. Important
items below minimum are `recommended`. Standard items retain the normal
ABC/XYZ decision behavior.

## Result and report

The JSON result contains:

- matrix annotations and projections in every `demandProducts` entry;
- `assortment_matrix_summary`;
- `missing_matrix_items`;
- `assortment_matrix_warnings`.

The Russian text report contains matrix totals, missing matrix items, and
critical products below minimum. Missing critical items produce a visible
owner warning but do not automatically block or reduce the order.

## Alternative matrix path

```bash
npm run purchasing:run -- \
  --input "data/incoming/miska-minmax-current.xlsx" \
  --assortment-matrix "data/purchasing/miska-assortment-matrix.json"
```

The matrix path and SHA-256 hash are recorded in `run-metadata.json`.
