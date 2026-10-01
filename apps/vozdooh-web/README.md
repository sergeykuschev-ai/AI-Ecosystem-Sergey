# vozdooh-web

VOZDOOH web application workspace. Currently contains the **Task 8 logistics
research pipeline**: an evidence-backed dimensions/weight dataset for the
current real VOZDOOH stock, prepared so delivery tariff calculation can later
use verified product/package parameters.

## Layout

```text
apps/vozdooh-web/
├── src/                        # deterministic research pipeline modules
│   ├── eligibility.js          # derive customer-eligible positive-stock SKUs from the 1C snapshot
│   ├── evidence-rules.js       # evidence policy: exact unit conversion, no inferred dimensions,
│   │                           #   no volume→weight facts, source-authority conflict resolution
│   ├── dataset.js              # merge eligible SKUs + evidence into the machine-readable dataset
│   └── audit.js                # render the markdown audit
├── research/
│   ├── data/
│   │   ├── logistics-dataset.json        # generated machine-readable dataset (keyed by SKU)
│   │   └── sources/
│   │       ├── 1c-snapshot.json          # staged 1C snapshot (NOT committed; see below)
│   │       ├── 1c-snapshot.example.json  # synthetic example of the expected snapshot shape
│   │       └── evidence.jsonl            # evidence records collected from public sources (JSON Lines)
│   └── audit/
│       └── logistics-audit.md            # generated markdown audit
├── scripts/
│   ├── build-dataset.js        # npm run build — regenerates dataset JSON + audit markdown
│   └── lint.js                 # zero-dependency style/syntax lint
└── tests/                      # node --test unit + integration tests with synthetic fixtures
```

## Data inputs

The pipeline starts from the **staged 1C snapshot** and re-derives the eligible
SKU set (customer-eligible, positive stock) on every build — the SKU list is
never hard-coded. To run against real data:

1. Place the exported 1C snapshot at `research/data/sources/1c-snapshot.json`.
   Expected row shape is documented in `research/data/sources/1c-snapshot.example.json`.
2. Append evidence records (one JSON object per line) to
   `research/data/sources/evidence.jsonl`. The record contract is validated by
   `src/evidence-rules.js`; see `tests/fixtures/evidence.synthetic.json` for a
   full example of every status path.
3. Run `npm run build`.

## Evidence policy (enforced in code and tests)

- Facts are accepted only for **exact SKU/product identity matches**
  (brand + line/fragrance + format + volume/size). Similar or same-volume
  products never contribute facts unless the source explicitly establishes
  shared packaging dimensions.
- Every accepted fact records the exact source URL, source type
  (`MANUFACTURER_OFFICIAL` / `OFFICIAL_DISTRIBUTOR` / `SPECIALIST_RETAILER` /
  `OTHER`), and retrieval date.
- Dimensions and weight are stored **exactly as reported**; normalized mm/g
  values are produced only when the conversion is mathematically exact
  (terminating decimal × exact unit factor). Approximations and ranges are
  never normalized.
- A missing third dimension is **never inferred** from two-dimensional data.
- Volume (e.g. 250 ml) is **never** converted into shipping weight (0.25 kg) as
  a fact. A retailer weight that merely equals liquid volume is retained only
  as `source_reported_weight` with low logistics confidence.
- Source authority: official manufacturer > official distributor > specialist
  retailer (e.g. Candlesbox). Candlesbox is a research source, not an
  authority when it conflicts with official data.

This task prepares **evidence only**. No guessed logistics value is written
into 1C or public product cards.

## Commands

```bash
npm run test        # node --test unit + integration tests
npm run lint        # syntax + style checks (zero dependencies)
npm run typecheck   # tsc --noEmit with JSDoc type checking
npm run build       # regenerate research/data/logistics-dataset.json + research/audit/logistics-audit.md
```

Node.js >= 20 is required (uses the built-in test runner and `node:util` parsing).
