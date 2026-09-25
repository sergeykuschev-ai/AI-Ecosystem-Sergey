# Private preview reliability — 2026-09-25

## Staged conversion

The converter accepts complete snapshots only. Missing/duplicate product or offer
IDs, incomplete joins, invalid/nonfinite selected numbers, negative prices,
duplicate selected warehouse/price entries, unsafe/colliding SKUs and snapshots
outside the reader's size/text/numeric limits fail before publication. Partial
exports need a separately approved merge policy. Absent selected warehouse still
means zero stock; absent selected price remains null. Existing negative-stock
clamping, fractional stock and explicit price-publication option are preserved.

Source SHA-256 values are recorded and rechecked before publication. Source files
are read-only. Output/report must be distinct and outside the exchange root.
An exclusive output lock prevents competing converters for that output; a stale
lock requires an operator to confirm no writer is active before removal. Unique
temporary files are flushed, atomically replaced, then their directory fsynced.
Retries of identical sources/options are deterministic.

Snapshot and report are individually atomic, not one filesystem transaction.
An I/O failure after replacing the snapshot can leave an older report. After fixing
storage, repeat the same validated sources/options and compare source hashes.
Use a separate report path per output. Never regenerate the existing priced
snapshot during verification. `npm test` now requires Python 3 for synthetic
converter regressions; no live source or order data is used by these tests.

## Checkout and preview

See [order request guarantees](src/integrations/order-requests.md). Checkout has a
15-second confirmation timeout, retains retry identity and validates receipts.
Stored receipts are checked before replay, without migration or rewriting.
Russian recovery screens provide retry/catalog navigation without internal errors.
HTTP noindex/nofollow supplements existing metadata and robots disallow on all
routes. Neutral metadata replaces stale demo-only claims; homepage UI is unchanged.

`VOZDOOH_ISOLATED_BUILD=true npm run build` builds into `.next-verify`, preserving
a running preview's `.next` artifacts. Use the same flag for `next start` on a
separate loopback port to smoke-test it. It does not restart the existing preview.
Restore generated `next-env.d.ts` after verification. No public deployment,
payment, procurement, 1C mutation or additional integration is authorized here.

## Frozen research discrepancy

The read-only demand validator currently rejects the staged snapshot hash:

- Frozen study: `05c1dd3a1f01f58fba9eef9c292ea1456b2894de0c127a632ff1195e382ffd91`
- Current snapshot: `a71400f603b5b8169fa02cf5cdfd78f192973c002832ae2b7f8eddd0d113120f`

The README documents confirmed retail prices in today's snapshot; the frozen
study used an earlier unpriced state. This context does not establish the exact
cause of every byte difference. The frozen hash remains strict and unchanged;
a dated provenance review is still required. Ranking is not recalculated.
The 12 exact-image and five unknown-brand blockers remain unresolved.

Read-only browser verification: with Playwright installed, run
`VOZDOOH_TEST_URL=http://127.0.0.1:3419 node scripts/verify-private-preview.cjs`.
Set `PLAYWRIGHT_MODULE` if the module is installed outside this app. It verifies
21 route/viewport combinations, noindex, headings, overflow, robots, 136 pictured
products and frozen TOP-25 links. It submits no orders and uses no existing browser
profile. This is targeted coverage, not a complete accessibility audit.
