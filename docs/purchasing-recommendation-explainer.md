# Purchasing Recommendation Explanation Layer

## Purpose

Purchasing Agent v0.6 adds a deterministic presentation/audit layer for owner
review. It explains already-computed recommendations for every retained SKU.
It does not recalculate demand, change order quantities, assign matrix roles,
alter approved policy, or modify the Financial Controller result.

The implementation is in
`agents/purchasing/explanations/recommendation_explainer.js`. The Miska
confidence configuration is stored in
`data/purchasing/miska-recommendation-explainer-config.json`.

## Data flow

```text
Purchasing Agent result
        + Matrix Builder draft role/policy context
        + Owner Decisions overlay metadata
        + Financial Controller assessment
                          |
                          v
              Recommendation Explainer
                 |                 |
                 v                 v
recommendation-explanations.json   recommendation-explanations-report.md
```

The full-run CLI builds the matrix context independently after the Purchasing
Agent has completed. The explainer reads both results by exact `rowIdentity`.
The serialized `result.json` remains the original Purchasing Agent return
value.

## Per-SKU contract

Each explanation contains:

- stable SKU and product name;
- final presentation recommendation and the existing decision status;
- approved quantity, or `null` when it is not approved;
- a short Russian owner-facing summary;
- machine reason codes with Russian descriptions and evidence field names;
- calculation facts copied from ready results;
- normalized risk flags and deterministic confidence;
- Owner Decisions, Financial Controller, and Matrix Builder influence;
- available and missing source-field lists;
- explanation version.

Absent numeric facts remain `null`. The layer never substitutes zero for an
unknown stock, price, quantity, or policy value.

Demand `minimum` and `target` are kept in `calculation_facts` because they are
part of the current order calculation. Matrix Builder draft policy is kept
separately under `matrix_role_influence.draft_policy`; it is not presented as
the formula for the current order.

## Confidence policy

Confidence measures only data completeness and the confidence of the existing
decision. It does not measure commercial attractiveness.

The default transparent rules are:

- missing `free_stock` or `sales_period` produces `low` confidence;
- missing `unit_price` limits confidence to `medium`;
- when enabled, the existing decision confidence is a ceiling, so the
  explanation cannot claim higher confidence than its source decision.

The configuration validator rejects unknown fact names, overlapping low and
medium conditions, invalid types, and missing version/store identifiers.

## Output formats

The default `--format all` run creates both explanation artifacts. The
`--format json` option creates the JSON explanation artifact; `--format text`
creates the Markdown artifact. `run-metadata.json` records the relative
artifact names, config hash, explanation version, explained SKU count, Matrix
Builder version, and Owner Decisions source summary.

The Markdown report contains:

1. Executive Summary;
2. Recommended to Order;
3. Not Recommended to Order;
4. Manual Review Required;
5. EXIT Explanations;
6. Low Confidence Explanations;
7. Owner Decisions Influence;
8. Financial Controller Influence.

## Verification

Run all automated tests:

```bash
npm test
```

The explainer tests cover positive and zero orders, transit coverage, unknown
stock and price, demand strength and spikes, matrix roles and policy status,
owner decisions, financial limits, manual review, null preservation,
determinism, source immutability, Markdown sections, and CLI artifact wiring.
