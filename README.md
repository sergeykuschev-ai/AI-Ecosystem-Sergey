# AI-Ecosystem-Sergey
AI-экосистема Сергея Кущева

## Purchasing Agent for Miska

Run the complete local SmartZapas analysis with the current financial data and
mandatory assortment matrix:

```bash
npm run purchasing:run -- \
  --input "data/incoming/miska-minmax-current.xlsx"
```

The default assortment matrix is stored in
`data/purchasing/miska-assortment-matrix.json`. It is validated and matched to
report products by a unique article or, when an article is absent or
ambiguous, by an exact normalized product name. Repeated articles never merge
products automatically. The matrix adds a mandatory quality-control layer;
the financial controller remains advisory and does not reduce the order.

See [the assortment matrix guide](docs/purchasing-assortment-matrix.md) and
[the full-run CLI guide](docs/purchasing-run-cli.md) for the contracts and
operating procedure.

Every normal full run also creates deterministic JSON and Markdown
recommendation explanations. See
[the Recommendation Explanation Layer guide](docs/purchasing-recommendation-explainer.md)
for its read-only contract and confidence rules.

Build a separate, non-authoritative draft assortment matrix for review:

```bash
npm run purchasing:matrix:build -- \
  --input "data/incoming/miska-minmax-current.xlsx" \
  --existing-matrix "data/purchasing/miska-assortment-matrix.json" \
  --dry-run
```

The Matrix Builder never overwrites the working matrix or changes order
quantities. See [the Matrix Builder guide](docs/purchasing-matrix-builder.md)
for classification limits, policy provenance, and the manual-review workflow.

## Purchasing Web Backend v1

Start the local HTTP backend for a future owner-facing web interface:

```bash
npm run purchasing:web
```

The server listens only on `127.0.0.1:3210`, accepts a SmartZapas Excel
workbook, runs the existing Purchasing Agent orchestration, exposes compact
browser DTOs, and streams whitelisted run artifacts. It does not send or
change purchase orders and does not provide a frontend.

See [the Purchasing Web Backend v1 guide](docs/purchasing-web-backend-v1.md)
for API contracts, upload limits, artifact security, retention, errors, and
local-version constraints.
