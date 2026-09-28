# Production readiness review — 2026-09-28

Safe local work starts at Ozon scaffold `ac75aa66`; the scaffold is preserved.
Checkout now shares deterministic request validation with the API, retains the
existing retry digest format, and links to privacy, delivery and payment terms.
The API rejects malformed UTF-8 JSON. The sitemap excludes transactional cart
and checkout pages; preview crawling and indexing remain disabled.

## Blockers and review limits

The footer and information pages retain repository-approved seller details and
delivery policy. Checkout records a pickup/courier preference, not a shipment.
The public domain was inaccessible through the web tool during this review;
live parity could not be established. No authentication bypass was attempted.

Owner decisions remain required for retention/deletion policy, payment methods,
receipts and outstanding legal-page owner blocks. Live integrations, operational
request processing, production indexing, access protection changes and deployment
remain separate release gates. No browser/device verification was performed in
this pass. No credentials, payments, shipments, deployment or push were used.

## Verification

Run `VOZDOOH_ISOLATED_BUILD=true npm run verify` from `apps/vozdooh-web`.
It runs synthetic automated tests, TypeScript, lint and a production build in
`.next-verify`, preserving the existing preview build. Execution results and any
environment blockers are recorded in the overnight report.

Verified in this session: 81 app tests (including a concurrently added seller
consistency test left outside this change), 2 exchange tests, 9 Python tests,
TypeScript, zero-warning lint and isolated production build all passed. The
restricted sandbox first failed catalog CLI subprocess assertions; the full
verification passed when rerun with approved local process permissions.
