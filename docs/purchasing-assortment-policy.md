# Purchasing Assortment Policy

Assortment Policy is an internal layer of the existing Purchasing Agent. The
canonical sequence is:

```text
source data -> Min/Max -> Assortment Policy -> Owner Review
            -> FinalOrderState -> supplier order
```

The engine is implemented in
`agents/purchasing/services/assortment_policy.js`. It does not replace the
Min/Max calculation and does not change `services/final_order.js`.

## Persistent data

Current rules are stored in
`data/purchasing/miska-assortment-policy.json`. Rule changes are recorded in
`data/purchasing/miska-assortment-policy-history.json`. The store validates its
version, unique SKU keys, supported statuses (`CORE`, `OPTIONAL`, `TEST`,
`EXIT`), order modes (`PIECE`, `BOX`), numeric boundaries, and timestamps.
Invalid JSON or an invalid store is an explicit run error.

The service method `updateAssortmentPolicyRule` requires a reason and actor,
and records `old_value`, `new_value`, `changed_by`, `changed_at`, and the
optional source run. Saving an identical rule does not add a history entry.

## First-phase rule order

The engine applies the following rules before Owner Review:

1. `EXIT` sets the policy quantity to zero.
2. An active purchase hold sets it to zero. A hold without a threshold means
   a full hold. A threshold without `purchase_hold=true` has no effect.
3. `max_stock` caps the projected stock.
4. A mandatory item below `min_stock` is restored to `target_stock` when it is
   configured, otherwise to `min_stock`.
5. The MAX cap is applied again after mandatory restoration.

Purchase hold and EXIT take priority over mandatory assortment. `CORE`,
`OPTIONAL`, and `TEST` do not otherwise change quantity in this phase. `BOX`
and display fields are validated and transported, but box rounding and display
optimization are intentionally deferred.

For an SKU without a rule, policy quantity equals the Min/Max quantity and the
item is marked as not adjusted. Owner `BUY`, `SKIP`, and `DEFER` decisions are
then applied by the existing Owner Review flow. All supplier output and budget
optimization continue to use the canonical `buildFinalOrderState` result.
