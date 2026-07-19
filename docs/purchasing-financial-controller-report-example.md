# Miska Financial Purchasing Controller — Preliminary Example

Status: **preliminary; affordability cannot be finalized**.

This example evaluates the current purchasing scenarios without changing their
lines, units, quantities, or order sums. It is not approval to place an order.

## Executive conclusion

No scenario can currently be classified `affordable: yes`. The controller is
missing the current cash balance, complete unpaid mandatory expenses, already
committed supplier payments, current-month purchasing commitments, revenue
forecast, liquidity reserve, maximum purchasing share, and purchasing history.

The known revenue plans and 190,000 RUB planning-expense baseline are not
sufficient to infer cash availability. In particular, the planning baseline
does not state which expenses remain unpaid and may omit utilities, acquiring
fees, loans, or other fixed costs.

## Known profile values

| Input | Value | Status |
| --- | ---: | --- |
| Minimum monthly revenue plan | 750,000.00 RUB | Owner-provided profile parameter; not source-verified |
| Target monthly revenue plan | 800,000.00 RUB | Owner-provided profile parameter; not source-verified |
| Rent plan | 70,000.00 RUB | Known planning parameter; paid/unpaid status unknown |
| Payroll default | 85,000.00 RUB | Configurable default; range and paid/unpaid status unknown |
| Tax plan | 35,000.00 RUB | Known planning parameter; paid/unpaid status unknown |
| Known planning-expense baseline | 190,000.00 RUB | Provisional until Sergey verifies that the mandatory-expense schedule is complete |

## Report-level missing inputs

- Current bank/cash balance and timestamp.
- Complete unpaid mandatory expenses with due dates.
- Existing approved supplier payments not yet paid.
- Current-month purchasing spend already committed.
- Forecast monthly revenue and confidence.
- Actual revenue to date for working/aggressive eligibility.
- Minimum and desired liquidity reserves.
- Maximum purchasing share of forecast revenue.
- At least six completed months of purchasing history, preferably twelve.
- Confirmation of overdue mandatory expenses.

## Scenario evaluation

Unknown financial results remain unknown; they are not replaced with zero.

| Scenario | Lines | Units | Order sum | Financial budget | Remaining liquidity | % forecast revenue | % historical baseline | Budget variance | Affordable | Risk | Recommendation | Approval |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| Safe auto-approved portion | 82 | 476 | 89,742.05 RUB | unknown | unknown | unknown | unknown | unknown | conditional | critical | Hold for complete financial inputs | Owner financial approval after data completion |
| Recommended reviewed proposal | 97 | 525 | 103,389.40 RUB | unknown | unknown | unknown | unknown | unknown | conditional | critical | Hold for complete financial inputs | Owner financial approval after data completion |
| Reviewed upper bound | 105 | 570 | 112,698.84 RUB | unknown | unknown | unknown | unknown | unknown | conditional | critical | Do not select until stock reviews and financial inputs are complete | Purchasing and owner financial approval |
| Working maximum | 121 | 614 | 122,249.62 RUB | unknown | unknown | unknown | unknown | unknown | conditional | critical | Not ready for automatic submission | Purchasing and owner financial approval |

Phase 1 remains a comparison reference: 127 lines / 89,159.68 RUB. It is not a
fifth financial scenario in this example.

## Financial modes

### Minimum

Not yet eligible. Although the safe auto-approved portion is the natural
minimum candidate, cash capacity and reserve protection cannot be tested.

### Working

Not yet eligible. The recommended reviewed proposal is the natural working
candidate, but forecast reliability, actual revenue progress, desired reserve,
and overdue-payment status are unknown.

### Aggressive

Blocked. Forecast revenue is unknown and therefore cannot be shown to exceed
the 800,000 RUB target. Inventory-opportunity evidence and explicit owner
approval are also required.

## Report-level warnings

- `current_cash_missing`
- `revenue_forecast_missing`
- `purchasing_history_insufficient`
- `mandatory_expenses_incomplete`
- `liquidity_reserve_missing`
- `supplier_commitments_missing`
- `current_month_purchasing_commitments_missing`
- `maximum_purchasing_share_missing`
- `overdue_expense_status_unknown`

These warnings appear once here rather than being repeated for all scenarios.

## Required next action

Collect and verify the critical inputs for the same as-of timestamp. Then
calculate cash, revenue, and historical ceilings, select the most conservative
valid safe limit, and re-evaluate all four scenarios from the same financial
snapshot. Until then, no scenario is financially approved.
