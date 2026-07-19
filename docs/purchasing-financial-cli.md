# Miska financial data CLI

The local CLI updates and validates
`data/purchasing/miska-financial-current.json` without editing JavaScript. It
does not connect to 1C, a bank, an API, or n8n. It does not run or modify the
Purchasing Agent's product calculations.

## Interactive update

Run:

```bash
npm run finance:update:miska
```

The CLI:

1. loads and validates the current JSON through the existing financial data
   loader;
2. displays `store`, `currency`, `updated_at`, and all editable values;
3. asks for each editable value in sequence;
4. keeps the current value when Enter is pressed without input;
5. repeats the current question after invalid input;
6. displays a preview and calculation summary;
7. asks for confirmation before writing.

Editable fields are:

- `cash_balance`;
- `bank_balance`;
- `expected_revenue`;
- `fixed_expenses`;
- `acquiring_rate`;
- `supplier_debt`;
- `committed_supplier_payments`;
- `minimum_reserve`;
- `comment`.

`store` and `currency` are displayed but not edited. `updated_at` is not
prompted: it is set to the current local `YYYY-MM-DD` date only inside a
confirmed successful save. Cancelling, validation failure, check mode, and
dry-run preserve the previous date.

Pressing Ctrl+C exits with code 130 and does not write the file.

## Number and percentage formats

Money must be finite and at least zero. Spaces and a decimal comma are
accepted:

```text
118000
118 000
685 899,16
```

The acquiring rate accepts either a decimal fraction or an explicit percent:

```text
0.025
2.5%
2,5%
```

All three rate examples are stored as `0.025`. A value such as `2.5` without
the percent sign is rejected because it is not a valid fraction from 0 to 1.

## Check mode

Run:

```bash
npm run finance:check:miska
```

Check mode validates the structure and types, prints the current values and
financial summary, and never writes. If `updated_at` is more than 31 elapsed
days old, it prints:

```text
Предупреждение: Финансовые данные не обновлялись более 31 дня
```

The summary contains:

- total available liquidity;
- fixed expenses;
- estimated acquiring expense;
- total mandatory expenses;
- amount remaining after expenses and supplier obligations;
- minimum reserve;
- maximum safe monthly amount for new orders.

The CLI obtains these values from `evaluateFinancialPurchase()` with a zero
new-order amount. Financial formulas are not copied into the script.

## Non-interactive update

Supply only fields that should change. Unspecified fields remain unchanged:

```bash
node scripts/update-miska-financial-data.js \
  --cash-balance 125000 \
  --bank-balance 280000 \
  --minimum-reserve 100000 \
  --comment "Обновлено после сверки кассы" \
  --yes
```

Without `--yes`, the CLI displays the preview and asks for confirmation.
Invalid or unknown arguments stop execution before the file is written.

For development or a separately approved local file, `--file` selects a JSON
path:

```bash
node scripts/update-miska-financial-data.js \
  --file /path/to/miska-financial-copy.json \
  --cash-balance "125 000" \
  --yes
```

## Dry-run

Add `--dry-run` to validate arguments and show the complete preview without a
confirmation prompt or write:

```bash
node scripts/update-miska-financial-data.js \
  --bank-balance 280000 \
  --acquiring-rate "2,5%" \
  --dry-run
```

`--dry-run` cannot be combined with `--yes`. Check mode cannot be combined
with updates, `--yes`, or `--dry-run`.

Run `node scripts/update-miska-financial-data.js --help` for the complete flag
list.

## Safe-save guarantees

Before replacing the current JSON, the CLI:

1. validates the complete candidate object in memory;
2. applies the current local date to `updated_at`;
3. writes a uniquely named temporary file in the same directory;
4. loads and validates that temporary JSON through the existing financial data
   loader;
5. atomically renames the temporary file over the configured file.

JSON uses two-space indentation and ends with a newline. If writing,
post-write validation, or renaming fails, the CLI removes the temporary file
and leaves the original file intact. It never attempts to repair invalid input
with inferred or default financial values.

The financial controller remains advisory. Updating this file does not alter
product rows, quantities, Phase 1/2 statuses, or purchasing formulas.
