# VOZDOOH integration boundary

External systems connect through the contracts in `src/catalog` and `src/commerce`.
This implementation provides a validated local synthetic JSON importer and a
read-only catalog repository. It does **not** implement a live 1C exchange,
CommerceML parsing, HTTP ingestion, authentication, scheduling or orders.

## Source selection

| `CATALOG_PROVIDER` | Behavior |
| --- | --- |
| unset, `demo`, legacy `stub` | Eight explicit demo placeholders; default |
| `local-1c` | Read the internal synthetic snapshot; development/test only |
| `1c` | Fail with `ONEC_LIVE_NOT_CONFIGURED`; no fallback |
| anything else | Fail with `INVALID_CATALOG_PROVIDER` |

`ONEC_LOCAL_CATALOG_PATH` defaults to `.local/onec-catalog.json`, resolved relative
to the app working directory. A missing or corrupt selected snapshot fails closed;
no demo products are merged into the imported source. Catalog, product, finder,
cart and checkout pages read the selected repository dynamically. The homepage
retains the approved permanent editorial design. Brands/collections remain placeholders.

Both local import and local reads reject `NODE_ENV=production`. Use `next dev`
for local synthetic verification, and the demo source for `next build/start`.
Let Next.js set `NODE_ENV`; do not override it to bypass this guard. Keep local
servers bound to `127.0.0.1`; noindex/robots alone is not access control.

## Trade and editorial ownership

Only SKU, name, brand, category, volume, price, stock, barcode and available
characteristics may come from 1C (`TradeProduct`). Descriptions, images, scent
family, mood, room, recommendations and SEO must not be imported as trade fields.

`mergeCatalog(trades, editorialBySku)` accepts separately managed editorial data
keyed by exact SKU. Trade updates never modify that map. Without editorial data,
values stay null/empty and a stable `sku-<UTF-8 hex SKU>` slug is generated. Slugs
must be unique ASCII letters/digits/underscores/hyphens, starting with a letter
or digit. There is no editorial CMS or file ingestion in this change. Images
remain honest placeholders pending a separate approved content integration.

Filters use exact source categories and the existing editorial vocabulary.
Missing editorial fields do not match a selected scent/mood/room filter. Trade
characteristics never infer fragrance claims. Imported recommendations require
explicit editorial links; same-family suggestions remain demo-only.

## Local JSON input contract, version 1

Run from `apps/vozdooh-web`:

```sh
npm run catalog:import -- tests/fixtures/onec-synthetic.json
npm run catalog:import -- tests/fixtures/onec-synthetic.json
CATALOG_PROVIDER=local-1c npm run dev -- --hostname 127.0.0.1 --port 3188
```

Use only synthetic data. The committed fixture is explicitly labeled internal
test material, not merchandise. Snapshots carry `kind: internal-synthetic-1c`;
this marker describes the intended use, not an automatic check of provenance.
Never feed production exports into this local adapter.

The envelope is `{ "version": 1, "products": [...] }`, with no other keys.
Each product is a **complete trade record**, not a field patch:

| Field | Validation / normalization |
| --- | --- |
| `sku` | Required string; trimmed; 1–128 input characters; ASCII letter/digit first, then letters/digits/`.`/`_`/`-`; case-sensitive identity |
| `name`, `category` | Required nonblank strings, at most 500 input characters; trimmed |
| `brand`, `volume`, `barcode` | Optional/null or nonblank strings, at most 500 characters; trimmed; barcode leading zeros preserved |
| `price`, `stock` | Optional/null or finite JSON numbers from 0 through `Number.MAX_SAFE_INTEGER`; numeric strings rejected |
| `characteristics` | Optional object (not null); up to 100 nonblank string keys (100 characters) and string values (500 characters); values trimmed; prototype keys rejected |

Text rejects control characters. Unsupported fields reject the row. Price is RUB;
stock is source units and may be fractional. Values, including zero, are preserved
without rounding or coercion. No totals, taxes, delivery charges or currency
conversion are calculated. Missing optional fields become null (characteristics
become `{}`), even when updating an existing SKU. Missing SKUs in a batch remain
in the snapshot; there is no deletion/deactivation operation. An empty batch is
valid and preserves existing data. Duplicate trimmed SKUs reject every matching
row, so input ordering cannot silently choose a winner.

## Import semantics and diagnostics

`importCatalog(payload, previous)` is a pure normalization/upsert operation. It
returns `{ products, diagnostics }`; its candidate result can include accepted
rows even if others were rejected. It does not publish anything.

`importLocalFile(inputPath, destinationPath)` is the publication boundary. The
CLI supports `npm run catalog:import -- input.json [snapshot.json]`; the optional
argument overrides `ONEC_LOCAL_CATALOG_PATH`. Keep snapshots outside `public/`
and source control, preferably in the ignored `.local/` directory.

- Every row must pass before publication. A rejected batch preserves the previous
  snapshot byte-for-byte and returns `committed: false` with exit status 1.
- Successful imports report received/accepted/rejected/created/updated/unchanged
  counts, row diagnostics and `committed: true`. Repeating a batch produces
  unchanged records without duplicates.
- Error rows are one-based; diagnostic fields/codes contain no raw values or
  arbitrary submitted field names. CLI fatal errors print a code and exit 1.
- Input and serialized snapshots are capped at 10 MiB; batches and accumulated
  snapshots at 10,000 products. Oversized publication returns
  `SNAPSHOT_TOO_LARGE` and preserves the old file.
- An exclusive sibling `.lock` permits one writer. A mode-0600 temporary file is
  flushed then atomically renamed into place. Readers see the old or new file.
  This is local filesystem tooling, not a distributed/durable database service.
- Missing destination creates a new snapshot. Corrupt existing state is never
  silently replaced. Validation and file errors release the writer lock.

For row failures, correct the identified row/field and retry the whole batch.
For `INVALID_JSON`, fix the input JSON; for `INVALID_SNAPSHOT` or other corrupt
state errors, restore a known-good synthetic snapshot before retrying. For
`FILE_TOO_LARGE`/`SNAPSHOT_TOO_LARGE`, reduce the synthetic dataset. For
`IMPORT_LOCK_UNAVAILABLE`, first check for a running importer; remove a stale
lock only after confirming no writer remains. A crash may leave a lock/temp file.
`LOCAL_IMPORT_IO_ERROR` requires checking input/destination existence and local
filesystem permissions. No automatic retry or network calls are performed.

## Verification and remaining integration decisions

`npm test` covers normalization, boundaries, duplicate handling, idempotency,
zero/fractional values, editorial isolation, repository copy isolation, filters,
source guards, CLI exit status, atomic rejection, corrupt files and snapshot
limits. `npm run verify` adds TypeScript, zero-warning ESLint and production build.
See the app README for existing Chromium checks in demo and local modes.

Before live 1C work: confirm transport/schema (CommerceML is not assumed),
endpoint/authentication, actual characteristic names, currency/stock units,
category mapping, delta/deletion policy, operational ownership and retry/audit
requirements. No credentials, endpoint values or production data are committed.

Commerce remains local-only UI. Missing cart SKUs stay visible and removable
after source changes. Checkout is disabled even with imported prices and stock;
there is no order API, payment, delivery integration or contact-data submission.
The site retains noindex and robots disallow. AmurskMarket (`apps/stores-web`)
code, configuration, analytics and secrets remain isolated.
