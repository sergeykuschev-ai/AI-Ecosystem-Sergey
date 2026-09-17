# Purchasing hardening audit — 2026-09-15

Scope: `agents/purchasing`, `apps/purchasing-web-backend`, purchasing scripts,
tests and documentation only. No real supplier order was placed.

## Verified state

- Full purchasing regression: 1,898 tests; 1,896 pass; 0 fail; 2 skipped.
- Valta flow was audited from workbook/input handling through demand, review,
  FinalOrder and supplier-order safety paths; no remaining confirmed defect.
- Zoograd/Onikienko supplier identity and alias flow was audited without
  changing supplier grouping rules.
- Owner decision 2026-09-15: purchasing/delivery cycle is 14 days for every
  supplier. Stale per-run 7/21-day overrides cannot replace this rule.
- Owner-review, triage and FinalOrder targeted regression passed with no
  confirmed false-blocker or duplicate-order defect.
- Mandatory SKU, duplicate-article and assortment-overlay safeguards passed
  targeted regression with no confirmed defect.
- Excel/import diagnostics and malformed-upload safeguards passed targeted
  regression with no confirmed defect.
- Purchasing web UI/API operational regression passed with no confirmed defect.

## Remaining blockers

No confirmed code blocker remains from this audit plan.

Two full-suite tests are intentionally skipped because they require optional
real workbook data: the AWARD Urinary real-workbook characterization and the
403-product/72-structural-row SmartZapas real-workbook characterization. These
skips do not mask a failing production-code assertion in the sanitized suite.

Any future change to financial values, owner decisions, supplier ordering, or
real order placement remains outside this audit and requires explicit owner
approval.
