# VOZDOOH catalog completeness + price/stock audit — 2026-09-28

Read-only audit of the staged-1c storefront catalog (`/opt/vozdooh/data/catalog-staged.json`,
source of truth = 1C CommerceML export). No trade values, prices, stock, images or fragrance
claims were invented or changed except the single explicitly noted editorial completion.

## Method

- Source rows: all 803 rows of the staged snapshot (`kind: staged-real-1c`, version 1).
- Eligible: positive selected-warehouse stock, minus the excluded legacy SKU `445445`.
- Visible: eligible products with a verified local image (`storefrontProducts`).
- Completeness fields: `description`, `scentFamily`, `mood`, `room`, `volume`, barcode,
  price positivity, image presence. Characteristics come only from 1C and are empty for the
  whole current export, so they are reported but not treated as a content gap.

## Totals

| Metric | Count |
| --- | --- |
| Total staged source rows | 803 |
| Positive-stock rows | 148 |
| Excluded legacy (SKU 445445) | 1 |
| Customer-eligible | 147 |
| Visible on storefront | 144 |
| Eligible but hidden (no verified exact image) | 3 |

Hidden SKUs (blocked on exact photo/identity evidence, see catalog-cleanup-evidence-2026-09.md):
`121211` (ротанговые палочки 500 мл), `045850b2-…` (AROMAgroup Салями картридж 100 мл),
`0189` (ножницы для фитиля). Re-verified as unresolvable from public sources; remain hidden.

## Visible-catalog completeness (before this pass)

| Field | Missing | Notes |
| --- | --- | --- |
| Verified image | 0 / 144 | every visible card has an exact, rights-cleared local image |
| Description | 0 / 144 | every visible card has a checked-in description |
| Positive price (RUB) | 0 / 144 | prices published from the selected 1C price type |
| scentFamily | 45 / 144 | gaps are accessories, professional AROMAgroup cartridges, car formats, one set, and SKUs whose notes are deliberately unpublished |
| mood | 46 / 144 | same distribution as scentFamily |
| room | 56 / 144 | + all 11 car products (no room by design) |
| volume | 26 / 144 | formats where volume genuinely does not apply (car diffusers, devices, sachets, potpourri, sticks) |
| barcode | 2 / 144 | 1C does not provide one for two AROMAgroup rows; never invented |
| characteristics (from 1C) | 144 / 144 | current 1C export provides none; contract field only |

scentFamily gap detail (non-AROMAgroup): reed sticks ×5, ceramic vase, XMAS gift set,
CULTI Décor Malìa (notes deliberately unpublished), Ladenac Jet Lag Black Gold. AROMAgroup
cartridge notes describe multiple families at once (e.g. «цитрусы, пряности и древесный
аккорд»), so no single family is assigned without a verified binding.

## Editorial completion made in this pass

- `344565` Ladenac Lui&Lei Jet Lag Black Gold: `scentFamily` set to `woody`. Support is the
  product's own checked-in description («восточно-древесная композиция с кедром и табачным
  аккордом»). No other field changed. After: scentFamily gap 45 → 44.

## Brand-landing coverage

13 brands with visible products; all 13 have evidence-backed landing stories in
`src/catalog/landings.ts`, sourced per `research/brand-stories-2026-09.md`. No brand page
invents founders, dates or materials; where an official source names no founder, none is claimed.

## Price/stock mapping audit (staged 1C → production)

- Source integrity: `import0_1.xml` sha256 `710c322a…` and `offers0_1.xml` sha256 `32f5e000…`
  match `/opt/vozdooh/data/catalog-staging-report.json` exactly; the export is unmodified.
- Converter (`scripts/convert-commerce-ml.py`) reads stock only from the selected VOZDOOH
  warehouse `8821bc1b-…` and price only from the selected price type `f9bf1e9b-…` (both equal
  to the report), clamps negative stock to zero (2 rows), and rejects negative prices.
- Staged snapshot: 148 positive-stock rows, all 148 with a positive selected price;
  655 zero-stock rows retained for future transitions; no duplicate SKUs (importer rejects).
- Enrichment (`stagedTrade`) touches brand/category/volume only; price and stock pass through
  untouched. Order-request validation re-reads raw staged trades, so checkout prices/stock
  are anchored to the same source of truth.
- Production spot-check (2026-09-28, 12 evenly sampled visible products on
  https://vozdooh27.ru): rendered Product JSON-LD price and InStock state matched the staged
  rows exactly for 12/12 (e.g. Aramara Decor 250 = 11200.00 RUB InStock; Africa Camouflage
  set = 39800.00 RUB InStock).

## Residual gaps (need owner/provider input, not code)

- Exact photographs for the 3 hidden SKUs (or their removal from 1C).
- Two missing barcodes (only 1C can supply them).
- 1C characteristics are absent from the export; if 1C later provides them they flow through
  the existing contract unchanged.
- scent/mood/room for AROMAgroup professional cartridges and a handful of sets: bindable only
  from verified per-SKU external cards, not from mixed-note descriptions.
