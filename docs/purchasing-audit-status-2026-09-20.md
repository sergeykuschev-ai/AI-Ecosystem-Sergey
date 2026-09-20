# Purchasing source audit — 2026-09-20

## Scope and baseline

Read the root `AGENTS.md`, purchasing operational/API documentation, the prior
2026-09-15 audit, and current purchasing implementation and tests. No nested
`AGENTS.md` was found in the scoped agent/backend directories. The initial
tracked working tree was clean. No commits, deployment, production service
restarts, credentials, or server/network configuration changes were made.

Baseline command:

```bash
node --test agents/purchasing/tests/*.test.js apps/purchasing-web-backend/tests/*.test.js
```

Baseline: 1,942 tests, 1,940 passed, zero failures, two skipped; approximately
101 seconds. No test hang was reproduced.

## Reproduced defects and fixes

1. **Re-export erased invoice and lifecycle metadata.** `recordOrder` rebuilt
   a journal entry without its actual invoice amount, invoice timestamp, or
   received/cancelled timestamp. Re-exporting a received order could replace
   actual monthly spend with its original calculated reserve. Preserve the
   existing journal fields when updating calculated order rows. Regression
   verifies the invoice, received timestamp, purchased total, and remaining
   budget after an identical re-export.
2. **Invalid invoice values silently became money.** JavaScript coercion
   accepted null, blanks, booleans, and arrays as zero or another amount.
   Very large finite values could overflow rounding and serialize as null.
   Reject invalid monetary types and rounding overflow before saving. Keep
   zero and nonempty finite numeric strings compatible. Service and HTTP
   regressions verify rejection without changing persisted spend.
3. **An unchanged browser budget snapshot reset accumulated purchases.** The
   form resubmitted restored values as a new manual baseline on every run,
   excluding orders added after that page snapshot. Omit unchanged restored
   budget fields so the backend reads current ledger purchases. Explicit
   edits still submit a new baseline; a successfully submitted baseline is
   also remembered. Regression checks actual multipart fields for restored
   and explicitly edited values.
4. **Sparse package SKU IDs shifted onto neighboring products.** Compaction
   intentionally omits missing IDs, while the presenter treated the shortened
   list as positional. Only use positional IDs when the list covers every
   article; otherwise resolve by article from the existing canonical lookup.
   Unresolvable IDs remain null. The regression runs compaction and presentation
   together and verifies both affected package members.

Five Codex regression tests failed against the original implementation and
passed after the fixes. A final manual safety review then found and fixed a
fifth defect class in the browser: a blank invoice field was coerced to numeric
zero before the API call. A dedicated frontend regression now rejects blank
invoice input while preserving explicit zero as a valid amount.

## Requirements reviewed and preserved

- Monthly ledger baseline, subsequent purchases, invoice substitution,
  cancellation/receipt accounting, business-month timezone, and remaining
  spend feed the existing financial override path.
- The financial controller retains the minimum of liquidity capacity and
  non-negative remaining monthly purchasing capacity when both are available.
- Current triage, data blockers, compact business decision packages, and
  resolved owner decisions retain their existing queue semantics.
- Strict item-rule auto-approval retains its existing repeated-decision,
  agreement, contradiction, identity, and status requirements.
- Zoograd/Onikienko, Rich Store, and Khabarovsk Opt grouping remains governed
  by the existing supplier canonicalization. Active order-decision matching
  already canonicalizes these supplier identities.
- FinalOrder remains the shared source for final quantities/amounts and
  supplier export; owner decisions, packaging, unresolved/data blockers, and
  duplicate-order checks retain their current contracts.
- Existing upload, API, frontend, and error-contract coverage passed unchanged.

## Changed files

| File | Purpose |
|---|---|
| `apps/purchasing-web-backend/application/purchase_ledger_service.js` | Preserve journal metadata and validate monetary inputs |
| `apps/purchasing-web-backend/http/run_handlers.js` | Reject invalid invoice value types before coercion |
| `apps/purchasing-web-backend/public/app.js` | Distinguish restored budget snapshots from explicit baseline edits; reject blank invoice input before numeric coercion |
| `apps/purchasing-web-backend/application/review_triage_presenter.js` | Prevent sparse SKU IDs from shifting between products |
| `apps/purchasing-web-backend/tests/purchase_ledger_service.test.js` | Two ledger regressions |
| `apps/purchasing-web-backend/tests/purchase_ledger_http.test.js` | Invalid invoice API regression |
| `apps/purchasing-web-backend/tests/static_frontend.test.js` | Budget multipart submission and blank-invoice regressions |
| `apps/purchasing-web-backend/tests/review_triage_presenter.test.js` | Compaction-to-presentation regression |
| `docs/purchasing-web-backend-v1.md` | Document existing ledger endpoints and corrected behavior |
| `docs/purchasing-audit-status-2026-09-20.md` | Audit evidence and limitations |

## Final verification

- Codex verification before the final blank-invoice fix: **1,947 tests; 1,945 passed; zero failures; zero cancelled; two skipped**, approximately 116 seconds.
- Final focused suite after all fixes: **1,948 tests; 1,946 passed; zero failures; zero cancelled; two skipped**, approximately 102 seconds.
- `node --check` passed for all **242** JavaScript files under
  `agents/purchasing` and `apps/purchasing-web-backend`.
- `git diff --check` passed. No separate lint command is defined in package.json.
- The two unchanged skips require optional real workbooks: AWARD Urinary and
  the 403-product/72-structural-row SmartZapas characterization.

## Limitations and policy questions

No reproduced test failure remains. Real workbook coverage and production
runtime verification were not performed; production runtime is outside scope.

The existing manual monthly baseline is an absolute total: ledger orders at
or before its timestamp are excluded from subsequent accumulation. How later
invoice corrections or cancellations for those already-baselined orders should
adjust that absolute total is not specified by the current tests. No new
accounting policy was introduced for that case.

Completed runs retain their saved financial ceiling. This change refreshes
ledger inputs for new runs; it does not introduce live rebudgeting of older
runs when another order consumes budget. Whether export should revalidate
against a live ceiling, including how to exclude that run's existing reserve,
requires an explicit contract rather than silently changing snapshot semantics.
