# 1C CommerceML receiver

This service receives the standard 1C website exchange protocol at
`/api/1c/exchange`. It accepts only `type=catalog` and stages received files.

Supported modes: `checkauth`, `init`, `file`, `import`.
The receiver returns `zip=no` and supports chunked uploads.

Catalog metadata is parsed from `import*.xml`. Prices and stock are parsed from
`offers*.xml` separately so 1C never overwrites site-authored descriptions or images.

For Miska offers only these sources are accepted:
- price type: `d082a97c-f6e9-11ee-b410-bc98e9dba613` (Розничный тип цен Миска)
- warehouse: `fb68b067-ff65-11ed-b86a-7c8bca00854e` (Миска)

Vozdooh prices and every other warehouse are ignored. Zero prices become null.
Negative raw stock is retained for diagnostics but website stock is clamped to zero.

Build and import a catalog snapshot:

```bash
node integrations/onec-sync/catalog-snapshot.mjs import.xml catalog.json
node integrations/onec-sync/import-directus.mjs catalog.json
```

Import Miska prices and stock after the matching catalog is staged:

```bash
node integrations/onec-sync/import-offers-directus.mjs offers.xml
```

All staging products stay `active=false`.

Run all tests with `npm test`, or only the integration suite with:

```bash
node --test integrations/onec-sync/*.test.mjs
```

## Website taxonomy

The source 1C hierarchy is retained only as source data. `normalize-catalog.mjs` derives the website taxonomy without changing 1C:

- animal/site section (`site_section`)
- normalized category and subcategory
- brand when it can be identified safely
- confidence and a small review queue

`classify-directus.mjs` writes only derived taxonomy fields. It never overwrites `site_name`, `site_description`, `site_image`, or other curated website content.

The automatic server importer runs classification after every new `import*.xml`, so new 1C products enter the website taxonomy automatically.
