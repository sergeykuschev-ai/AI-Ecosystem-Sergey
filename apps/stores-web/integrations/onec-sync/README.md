# 1C CommerceML receiver

This isolated service accepts the standard 1C website catalog exchange protocol.
It stages received files by store and never publishes products directly.

## Endpoints

- `/api/1c/exchange` - legacy Miska endpoint.
- `/api/1c/exchange/miska`
- `/api/1c/exchange/amper`
- `/api/1c/exchange/ventil`
- `/api/1c/exchange/metiz-market`

Only stores listed in `ONEC_EXCHANGE_STORES` are enabled. All endpoints use the
same Basic Auth credentials from `ONEC_EXCHANGE_USERNAME` and
`ONEC_EXCHANGE_PASSWORD`. Session cookies and staging directories are isolated
per store, so a session created for one endpoint cannot upload to another.

Supported exchange values:

- `type=catalog`
- `mode=checkauth`
- `mode=init`
- `mode=file`
- `mode=import`

The receiver returns `zip=no` and supports chunked uploads through repeated
`file` requests for the same filename.

## Publication boundary

Accepted files are recorded with state `staged`. This service does not mutate
Directus/PostgreSQL and does not expose 1C prices or stock on the storefront.
Each first real export must be inspected before a store-specific converter and
publication policy are enabled. Editorial descriptions and verified images are
kept separately so later commercial-data syncs cannot overwrite them.

Run protocol tests:

```bash
node --test integrations/onec-sync/server.test.mjs
```
