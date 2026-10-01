# VOZDOOH Task 8 — Logistics dimensions/weight audit

Generated: 2026-10-01 (dataset schema v1)

Scope: evidence-backed logistics dataset for customer-eligible positive-stock SKUs. Evidence only — no guessed value is written into 1C or public product cards.

## Source set

- 1C snapshot path: `research/data/sources/1c-snapshot.json`
- 1C snapshot present: **false**
- Snapshot rows total: 0
- Note: 1C snapshot is not staged in this workspace; the eligible SKU set could not be derived. Place the export at research/data/sources/1c-snapshot.json and run npm run build.
- Evidence records on file: 0

## Summary counts

- Total eligible SKUs: **0**
- Exact product-identity matches: **0**
- Verified complete (dimensions complete + weight): **0**
- Verified (status VERIFIED): **0**
- Partial (e.g. only two dimensions published): **0**
- Conflicts between sources: **0**
- Needs source: **0**

## Breakdown by brand

_No eligible SKUs derived yet._

## Records

_No records. The eligible SKU set is empty — see Source set above._

## Conflicts between sources

_No conflicting source values recorded._

## Unresolved SKUs (NEEDS_SOURCE and CONFLICT)

_None._

## Rejected / ignored evidence

_None._

## Methodology and evidence policy

- evidence-only: exact identity match; exact unit conversion; no inferred dimensions; no volume-to-weight facts; official sources override specialist retailers (e.g. Candlesbox).
- SKU set is re-derived from the staged 1C snapshot on every build (customer-eligible, positive stock); it is never hard-coded.
- Facts are accepted only for exact product identity matches (brand + line/fragrance + format + volume/size).
- Dimensions and weight are stored exactly as published; normalized mm/g values appear only when conversion is mathematically exact.
- A missing third dimension is never inferred from two-dimensional data.
- Volume (e.g. 250 ml) is never converted into shipping weight (0.25 kg); volume-equivalent retailer weights are kept only as source_reported_weight with low confidence.
- Priority of sources: official manufacturer → official distributor → reputable specialist retailer (e.g. Candlesbox). Candlesbox is a research source, not an authority when it conflicts with official data.
- Every accepted fact carries the exact source URL, source type, and retrieval date.
