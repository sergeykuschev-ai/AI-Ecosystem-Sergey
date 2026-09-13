# Unmatched purchasing safety guard

Status: implemented. On 2026-09-09 the owner removed the accidental
electrical-product example from scope; no foreign-product exclusion rule
is required by that example.

The owner's 2026-09-08 decision prohibits treating a missing canonical
assortment policy as purchase permission. Unambiguously matched products
retain their existing pipeline. The guard runs after
assortment control and before the working-order projection
(`order_agent.js`) and also protects direct working-order calls
(`working_order.js` re-applies it idempotently).

Explicitly unmatched products receive one of these classifications:

- `UNMATCHED_CONFIDENTLY_EXCLUDED`: an existing `phase2_calculated`
  `do_not_buy` decision has zero final quantity and no required data. The
  exclusion reason is `unmatched_deterministic_no_demand`. This excludes the
  current order; it does not declare the product foreign to the assortment.
- `UNMATCHED_REVIEW_REQUIRED`: other unmatched products receive
  `manual_review`, no approved quantity, and reason
  `unmatched_product_no_assortment_policy`. Calculated demand and the prior
  recommendation remain available. Missing demand remains missing.

`unmatchedGuard.provenance` records the policy source, prior decision and
reasons, calculated demand, and pre-guard final recommendation. Positive
review proposals prefer calculated demand, otherwise the existing final
recommendation; analyzer quantities cannot provide a review-quantity fallback
for guarded rows and cannot authorize an order.

## Ambiguous matches take precedence

The owner's 2026-09-09 decision prevents a later policy match from
overriding ambiguity reported by the initial assortment matcher. The
entry point indexes the canonical matcher's `itemResults` and demand
matcher's diagnostics by their `candidateRowIdentities` and passes the
evidence to the guard. A duplicate article alone is not used as a new
matching heuristic: a uniquely resolved match retains its behavior.

An ambiguous row always receives `UNMATCHED_REVIEW_REQUIRED`,
`manual_review`, null approved quantity, and reason
`ambiguous_assortment_match`, even if the later policy says matched or
the prior quantity is zero. Calculated demand and final recommendation
remain unchanged. Zero-demand conflicts require identity review; they
are not positive order proposals.

`unmatchedGuard.provenance.ambiguousMatches` contains the matcher item or
record indices and conflicting row identities. The original decision
and quantities are retained, with source
`owner_ambiguous_assortment_safety_policy_2026_09_09`. Reapplying the guard
preserves this evidence and cannot restore automatic approval. The guard
also respects explicit `ambiguous_assortment_match` warnings in products
or decisions when called directly without the canonical matcher context.

On the 07.09.2026 Valta control workbook, all 313 initially unmatched rows
now have zero automatic approvals. Six ambiguous rows require review:
three previously approved rows totaling RUB 1,836.98, and three previously
zero-quantity `do_not_buy` rows. All 440 calculated quantities and all
434 unaffected decisions remain unchanged.

No `UNMATCHED_LOW_RISK` rule is specified or assigned. Neither product names
nor brands establish permission. The guard does not modify the matrix,
Min/Target/Max, owner decisions, learning, or financial policy.

The owner confirmed on 2026-09-09 that the electrical-product exclusion
example was accidental. Its pending exclusion placeholder was removed.
Matched and unmatched regression coverage uses a synthetic pet product.
No article/name blacklist is implemented or awaiting approval for that
example; the general unmatched safety policy remains unchanged.

Working-order `canonicalSupplier` uses `supplier_scope.resolveSupplierGroup`.
`zoogradWorkingMaximumLines/Sum` and `otherSuppliersWorkingMaximumLines/Sum`
partition the existing working maximum for reporting only. Supplier-group
reporting does not change final recommended quantities.

Validation commands:

```sh
node --test agents/purchasing/tests/unmatched_product_guard.test.js agents/purchasing/tests/working_order.test.js agents/purchasing/tests/owner_decisions.test.js
npm test
```
