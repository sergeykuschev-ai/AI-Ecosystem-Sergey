# PAY-CART-01 candidate

Verified PAID and browser reconciliation are separate facts. `applyConfirmedPaymentResult`
reports `cleaned`, `already-done`, `missing-receipt`, `receipt-mismatch`, or
`storage-failure`. Existing boolean APIs remain available, returning true only for
the first two outcomes. Analytics retains its independent receipt and Web Lock;
missing cart evidence does not suppress a verified purchase event.

Only the original locally captured, order-bound SKU quantities authorize removal.
The cart and cleaned receipt remain one storage write. Missing/invalid/legacy
unbound receipts preserve the cart. Even a cleaned receipt must match paid items.
New units remain protected by the existing remaining-unit accounting. The UI
retains PAID during retries and stops polling terminal reconciliation outcomes;
storage failures retry automatically, on focus, or via the retry button. No retry
submits an order or starts a payment.

## Limits for owner review

The reported 24-hour commerce-worker reconciliation window is not a browser cart
receipt, cannot reconstruct ownership of current cart units, and does not imply
that a browser revisits the storefront within that window. Its runtime behavior
was not inspected or verified here. Missing local evidence needs manual review;
worker reconciliation cannot justify clearing the cart. Automatic replay is not
implemented. Any future replay needs separate owner review of status retention,
idempotency, bounded retries and trustworthy receipt continuity.

Cross-tab serialization requires Web Locks. If all durable analytics stores are
blocked, the existing memory fallback only deduplicates within one document;
cross-tab/reload exactly-once analytics cannot be guaranteed in that environment.

## Verification and synthetic manual acceptance

The initial Codex run had 30 passing Node tests. Independent QA subsequently
confirmed **32/32 passing on Windows and 32/32 in isolated Linux**, including the
second-tab test rewritten to avoid unsupported extensionless Node ESM imports.

```powershell
node -e "require('node:module').registerHooks({resolve(s,c,n){try{return n(s,c)}catch(e){if(s.startsWith('.'))return n(s+'.ts',c);throw e}}});require('./apps/vozdooh-web/tests/paid-cart.test.cjs');require('./apps/vozdooh-web/tests/paid-cart-qa-state.test.cjs')"
```

Coverage includes missing/mismatched receipts, legacy continuity, newer units,
storage recovery, concurrent independent tab modules with shared lock/receipts,
pending/canceled/unverified status and duplicate analytics. No live fetch was used.
At the time of the initial Codex run the candidate had no npm dependencies.
Subsequently, dependencies were installed into this isolated worktree offline,
and independent QA completed the full five-stage regression gate: Linux Node,
Linux Python, TypeScript, ESLint and isolated Next.js build — **5/5 PASS**.
A browser run in locally hosted Next.js using synthetic paid/pending status
responses and blocked order/payment POSTs passed **4/4 scenarios**: bound paid
receipt, missing receipt, pending status and transient storage failure with
retry. Two-tab behavior was tested; the pending case also confirmed that a
synthetic payment-status GET actually occurred. These checks did not call Ozon.

The existing `scripts/verify-paid-cart-browser.cjs` can express synthetic browser
checks: it intercepts order/payment POSTs and status GETs, blocks external origins,
and exercises two tabs at 390/1280px. It requires a separately prepared local
synthetic app/catalog and browser. It was inspected, not executed or modified.
Before running it, ensure all non-GET traffic is fulfilled/aborted and no live
catalog, customer, order, mail or payment adapter is configured.

Manual acceptance checklist (four isolated browser cases verified; production remains untested):

- Supply intercepted PAID status on the success page with no snapshot: show PAID
  plus manual cart review; preserve every line, including on focus/reload.
- Supply a matching bound receipt: remove only original eligible units; retain
  later additions. Repeat in two tabs and reload: no extra purchase event.
- Block cart storage read/write: show PAID plus retry/manual instruction. Restore
  storage and retry: reconcile the same receipt, with no order/payment POST.
- Supply pending/canceled or a mismatched order ID: preserve all cart lines and
  never display payment confirmation for that response.
- Change request ID while a status promise is pending: ignore the old response.
  Repeated focus/status responses must not replace a completed result.
- Check Russian status and retry button with keyboard at both widths. Use only
  synthetic IDs/SKUs and intercepted responses; never navigate to a provider.

The implementation was saved in a **local review Git commit only**. No push,
deployment, production payment requests or real order mutations occurred.
Machine-readable QA artifacts and screenshots remain outside this Git worktree
at `C:\\AI-Ecosystem\\candidates\\vozdooh-design-audit-20261018\\PAYCART_FULL_REGRESSION.json`
and `PAYCART_BROWSER_ACCEPTANCE.json`.
