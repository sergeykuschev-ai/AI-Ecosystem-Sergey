# Purchasing Agent — local financial data file

The Purchasing Agent can read Miska's current financial inputs from a local
JSON file. This keeps frequently updated balances and forecasts outside
JavaScript source while preserving the existing advisory-only financial
control boundary.

The current working file is:

```text
data/purchasing/miska-financial-current.json
```

It is a manually maintained local input. No 1C, bank, API, n8n, network, or
automatic refresh integration is enabled.

## File schema

These fields are required:

| Field | Type and constraint | Purpose |
| --- | --- | --- |
| `store` | non-empty string | Store named by the data owner |
| `updated_at` | valid `YYYY-MM-DD` date | Date when the values were verified |
| `currency` | string equal to `RUB` | Currency of all monetary values |
| `cash_balance` | finite number, at least zero | Available cash |
| `bank_balance` | finite number, at least zero | Available bank balance |
| `expected_revenue` | finite number, at least zero | Revenue used for acquiring estimation |
| `fixed_expenses` | finite number, at least zero | Total fixed mandatory expenses |
| `acquiring_rate` | finite number from 0 to 1 | Acquiring share of expected revenue |
| `supplier_debt` | finite number, at least zero | Current supplier debt |
| `committed_supplier_payments` | finite number, at least zero | Other committed supplier payments |
| `minimum_reserve` | finite number, at least zero | Required liquidity reserve |

`comment` is optional and must be a string or `null`. A missing or invalid
required value is never replaced with a configured default or inferred value.

The checked-in current example is:

```json
{
  "store": "Миска",
  "updated_at": "2026-07-19",
  "currency": "RUB",
  "cash_balance": 118000,
  "bank_balance": 300000,
  "expected_revenue": 685899.16,
  "fixed_expenses": 174750,
  "acquiring_rate": 0.025,
  "supplier_debt": 0,
  "committed_supplier_payments": 0,
  "minimum_reserve": 100000,
  "comment": "Платежи поставщикам производятся месяц в месяц, долгов нет."
}
```

## Updating the file

Before a purchasing run, replace only values that have been verified and set
`updated_at` to the verification date. Keep monetary units in RUB and the
acquiring rate as a fraction: `0.025` means 2.5%.

Validate the file through the loader before using it:

```bash
node -e "const { loadFinancialData } = require('./agents/purchasing/services/financial_data_loader'); console.log(JSON.stringify(loadFinancialData(process.argv[1]), null, 2));" data/purchasing/miska-financial-current.json
```

The loader returns normalized `financialData` separately from `metadata`. It
throws a Russian-language `FinancialDataLoadError` when direct loader usage
cannot read or validate the file.

## Purchasing Agent usage

Pass the file path in the optional entry-point options:

```js
const { runOrderAgent } = require('./agents/purchasing/order_agent');

const result = runOrderAgent(inputData, {
  financialDataPath: 'data/purchasing/miska-financial-current.json',
});
```

Relative paths are resolved from the process working directory. The same
option is available to SmartZapas entry points. For Phase 2 entry points it
remains the third argument, after `phase2Inputs`.

Source priority is deterministic:

1. A present `financialData` object is used.
2. Otherwise, a present `financialDataPath` is loaded.
3. With neither source, the assessment stays `PRELIMINARY` as before.

When both sources are present, inline data wins and
`financial_data_warnings` contains:

```text
Передан financialData; financialDataPath проигнорирован.
```

## Error and freshness behavior

File read, JSON syntax, schema, and type errors are contained inside the
financial advisory layer. The Purchasing Agent still returns the complete,
unchanged product calculation. Its financial assessment is `PRELIMINARY`,
`financial_data_source` is `file`, and `financial_data_errors` contains the
Russian error. The report explicitly says:

```text
Финансовая конфигурация не загружена.
```

When `updated_at` is more than 31 elapsed days before the run, the valid
financial calculation still runs and its status is not changed automatically.
The result and report add:

```text
Финансовые данные не обновлялись более 31 дня
```

Every `financial_assessment` includes:

```json
{
  "financial_data_source": "file",
  "financial_data_updated_at": "2026-07-19",
  "financial_data_store": "Миска",
  "financial_data_warnings": [],
  "financial_data_errors": []
}
```

Allowed source values are `inline`, `file`, and `none`. File metadata is for
provenance only. It does not change product quantities, Phase 1/2 statuses, or
the formulas in the financial controller.

## CLI example

The input file in this example must contain the existing n8n-compatible array
of `{ "json": { ... } }` product items:

```bash
node -e "const fs = require('node:fs'); const { runOrderAgent } = require('./agents/purchasing/order_agent'); const inputData = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); const result = runOrderAgent(inputData, { financialDataPath: process.argv[2] }); console.log(JSON.stringify(result, null, 2));" tmp/purchasing/input-items.json data/purchasing/miska-financial-current.json
```

This command only reads local files and prints the result. It does not create,
submit, reduce, or otherwise modify a supplier order.
