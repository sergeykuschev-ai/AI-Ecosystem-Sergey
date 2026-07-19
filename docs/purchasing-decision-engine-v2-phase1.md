# Purchasing Decision Engine v2 — Phase 1

## Purpose

The Phase 1 decision engine runs after deterministic purchasing analysis. It
does not calculate or alter SmartZapas supplier order quantities. It classifies
each analyzed product as automatically approvable, pending review, postponed,
or not requiring an order, while preserving report-local `rowIdentity`.

The engine is implemented in
`agents/purchasing/services/decision_engine.js`. SmartZapas entry points expose
the resulting `decisions` and summary counts without removing any v1 fields.
The engine does not mutate the analyzer result.

## Decision contract

Each analyzed product produces:

```js
{
  rowIdentity,
  decision,
  confidence,
  calculatedOrderQuantity,
  approvedOrderQuantity,
  reasons,
  warnings,
  requiredData,
  decisionScore,
  decisionVersion: 'v2-phase-1',
}
```

`calculatedOrderQuantity` is copied from the existing analyzer. The approved
quantity is either the unchanged calculated quantity, zero for a non-positive
calculated order, or `null` when a human decision is required.

## Decision values

- `must_buy`: known critical data and A/X priority; quantity is approved.
- `recommended`: known critical data and an acceptable positive calculated
  order; quantity is approved.
- `manual_review`: critical data is missing or the ABC/XYZ combination requires
  review; approved quantity is `null`.
- `postpone`: Phase 1 risk policy postpones the product; approved quantity is
  `null`.
- `do_not_buy`: calculated quantity is zero or negative; approved quantity is
  zero.

## Confidence values

- `high`: score 85-100 before rule caps.
- `medium`: score 50-84 before rule caps.
- `low`: score 0-49.

Manual-review and postponed decisions are capped at medium confidence. Missing
article lowers confidence by exactly one level. Duplicate article is diagnostic
and does not lower confidence in Phase 1.

## Rule order

Rules are evaluated in this order:

1. A missing calculated order quantity requires manual review.
2. A calculated quantity at or below zero produces `do_not_buy`.
3. For a positive order, missing critical fields require manual review. Critical
   fields are free stock, supplier, purchase price, ABC class, and XYZ class.
4. Negative free stock requires confirmation and manual review.
5. Unknown free stock always requires manual review, including strategic and
   A/X or A/Y products.
6. A/Z, B/Z, and C/Z require manual review. C/Y is postponed.
7. Known-stock A/X is `must_buy`; known-stock A/Y is `recommended`.
8. Other known-stock positive orders are `recommended`. Strategic status adds
   priority evidence but cannot override preceding review rules.
9. Missing and duplicate article warnings are applied without changing
   `rowIdentity` or merging rows.

Confirmed zero stock means `freeStock === 0`. Blank stock remains `null` and is
unknown.

## Decision score weights

Weights are stored in the separate `DECISION_ENGINE_CONFIG` object in
`agents/purchasing/config.js`.

| Evidence | Weight |
| --- | ---: |
| Base | 40 |
| Positive calculated order | +20 |
| Non-positive calculated order | +45 |
| Known free stock | +15 |
| Unknown free stock | -35 |
| Confirmed numeric zero free stock | +10 |
| Negative free stock | -20 |
| A/X | +25 |
| A/Y | +18 |
| Strategic product | +10 |
| A/Z | -25 |
| B/Z | -20 |
| C/Y | -15 |
| C/Z | -30 |
| Each missing critical field except free stock | -20 |
| Missing article | 0; confidence is lowered separately |
| Duplicate article | 0 |

The final score is rounded and clamped to 0-100. It is deterministic and does
not use an LLM.

## Summary fields

SmartZapas agent results add:

- `mustBuyCount`
- `recommendedCount`
- `manualReviewCount`
- `postponeCount`
- `doNotBuyCount`
- `highConfidenceCount`
- `mediumConfidenceCount`
- `lowConfidenceCount`
- `approvedOrderLines`
- `approvedOrderSum`
- `pendingReviewLines`
- `pendingReviewCalculatedSum`

Approved sums use the unchanged analyzer order sums. Pending-review totals cover
positive calculated orders whose approved quantity remains `null`.

## Reporting

`agents/purchasing/services/decision_report.js` builds a Markdown report with an
executive summary, automatically approved order, manual-review queue, postponed
products, rejected/no-order products, and explicit reasons, warnings, required
data, calculated quantities, and approved quantities.

## Known limitations

- The current Valta export does not contain barcode or stable internal product
  ID fields.
- Report-local identity is not a cross-report product identifier.
- Article and product name are descriptive and matching hints only.
- Blank free stock cannot be interpreted as numeric zero.
- Phase 1 does not infer missing business data or automatically resolve
  duplicate identifiers.
- Strategic status currently comes from the existing deterministic name-fragment
  rule and is not a mandatory-assortment contract.
- Approved order sum assumes the approved quantity equals the existing
  calculated quantity, which is true for Phase 1 automatic approvals.

## Phase 2 planned inputs

Phase 2 may add explicitly sourced and validated inputs for:

- sales over 7, 14, and 30 days;
- mandatory assortment matrix;
- category-specific rules;
- supplier availability;
- profitability and turnover.

These inputs are not invented or inferred in Phase 1.
