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

A read-only provenance review on 2026-09-26 established the exact difference.
Commit `e930519e` froze the unpriced study after `16759b26`; `7a30bd55`
subsequently documented confirmed retail prices and request checkout. In memory,
replacing only every current product's `price` with `None`, then serializing with
Python `json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n"`, reproduces
**exactly** the frozen SHA-256 above. The real snapshot was never rewritten.
All 803 rows have non-null prices today (793 nonzero according to the staging
report); the 148 positive-stock SKUs, original names and 220 stock units match
the frozen evidence. This establishes a price-only difference under the original
serialization, not a new demand study or approval to update its inputs.

The current staging report's source digests match the read-only XML files:

- import: `710c322a5f568f2f95372c9275b87c36eb70f327b0b5b47f418fabcc03a1f2f4`
- offers: `32f5e000ec1f9a982b8fc5c35f9c29d65a3c42476e3af38771dee0018201934e`

The strict research validator still fails on the priced snapshot, as designed.
No source hash, evidence, ranking or validator was changed. A new dated study
would be required to certify the priced snapshot as research input.
The 12 exact-image and five unknown-brand blockers remain unresolved.

Read-only browser verification: with Playwright installed, run
`VOZDOOH_TEST_URL=http://127.0.0.1:3419 node scripts/verify-private-preview.cjs`.
Set `PLAYWRIGHT_MODULE` if the module is installed outside this app. It verifies
21 route/viewport combinations, noindex, headings, overflow, robots, 136 pictured
products and frozen TOP-25 links. It submits no orders and uses no existing browser
profile. This is targeted coverage, not a complete accessibility audit.

## Runtime capacity observation

The temporary preview served and decoded product images successfully, but its
server log reported failed image-cache writes. The filesystem reported zero
available bytes. Installed Next.js documentation specifies a default disk-image
cache budget of half the available space at initialization, explaining the zero
cache budget. No image/cache policy was weakened to conceal this condition.

After stopping only this pass's temporary loopback server, its 148 MB isolated
`.next-verify` directory was removed. The filesystem then reported 94 MB available
(still 100% when rounded). Broader host disk cleanup is outside this app-only scope;
no existing build, staged export, source snapshot, order record or other app was
removed. Capacity should be restored before another large build or preview restart.
The existing preview was not restarted, so its cache recovery is not claimed.

## Capacity recovery and preview refresh — 2026-09-26

Disk capacity was restored before this pass (9.4 GB free); this pass did not
clean other applications. `VOZDOOH_ISOLATED_BUILD=true npm run verify` passed:
47 app tests, two receiver tests, nine Python tests, typecheck, zero-warning lint
and production build. Generated `next-env.d.ts` was restored afterward.

The prior port-3411 listener lacked the new HTTP noindex header. Its working
directory and staged-catalog environment were verified before any signal.
The validated `.next-verify` build first passed the read-only 21-case browser
preflight on port 3419. Using the documented app-local `next start` mechanism,
only those two VOZDOOH processes were stopped, then the validated build was
started on `127.0.0.1:3411` with the original process environment plus
`VOZDOOH_ISOLATED_BUILD=true`. The `.next` build was not replaced during the
listener switch. A subsequent full verification after the browser-script fix rebuilt that now-inactive output.

**The active preview now serves `.next-verify`. Do not remove or rebuild that
directory while it is serving.** The earlier isolated-build command is safe only
when that output is not active. For a subsequent refresh, build into the inactive
`.next` using `npm run verify` without the isolated flag, preflight with the same
staged environment on a separate loopback port, then switch only the identified
VOZDOOH listener. Preserve the process environment and working directory so
snapshot selection and local order storage remain unchanged. Never regenerate
the priced snapshot as part of a build or restart.

The documented `next start` mechanism logs Next.js's standalone-output advisory;
the runtime checks below, rather than absence of that advisory, establish service
health. No service manager, public listener or external integration was changed.

The optional visual verifier previously waited indefinitely on `decode()` for
lazy images outside the viewport. It now sets eager loading only in its test
page DOM and bounds decoding to 60 seconds. A repeatable filtered-route
`networkidle` timeout was traced to background RSC prefetch activity after the
page rendered successfully. The verifier now waits for page load and explicitly
decodes its images, retaining status, layout, filters, noindex and runtime-error
assertions. Storefront loading behavior, image
mappings and product content are unchanged. The live browser suite is the
regression check for this verification-only change.
