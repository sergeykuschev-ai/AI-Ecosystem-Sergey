# 1C CommerceML receiver

This service is an isolated receiver for the standard 1C website exchange protocol.
It accepts only `type=catalog` and stores received files in a staging directory.

Current phase intentionally does **not** publish products to the website or mutate
Directus/PostgreSQL. The first real 1C export is captured so its exact CommerceML
shape can be verified before the importer and catalog schema are implemented.

Endpoint: `/api/1c/exchange`.

Supported modes: `checkauth`, `init`, `file`, `import`.
The receiver returns `zip=no` and supports chunked uploads via repeated `file`
requests for the same filename.

Run protocol tests:

```bash
node --test integrations/onec-sync/server.test.mjs
```
