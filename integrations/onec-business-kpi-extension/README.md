# Business KPI extension for 1C:UT 11

Draft source modules for a standalone extension targeting:

- 1C:Enterprise `8.3.27.1859`;
- Trade Management (UT) `11.5.27.61`;
- Business KPI API contract `1.0`.

The final extension must read posted `Чек ККМ`, `Чек ККМ на возврат`, and
`Реализация товаров и услуг` documents. The UT metadata adapter is deliberately
closed until the exact object and field names are verified in the target
configuration. The files here are not a compiled `.cfe` and must not be
installed in production yet.

## Required safety behavior for the completed extension

- `Mode` defaults to `shadow` in the draft settings module.
- Apply requires both the `AllowApply` setting and the exact interactive
  confirmation phrase `ENABLE APPLY`; scheduled code cannot enable it.
- Unknown warehouses must be ignored locally and remain rejected by the API.
- API keys must never be returned by diagnostics or written to the event log.
- Network calls must run only in a background/scheduled job; document posting
  and cashier work may only enqueue a recalculation marker.
- A retry must reuse the same batch id and payload. A recalculated day gets a new
  batch id while retaining its stable `recordId`.

## Planned extension metadata objects

Create these objects in a new extension with compatibility mode matching UT
11.5.27.61 only after the metadata adapter is verified:

1. Information register `BusinessKPISettings`, one record, with resources:
   `ApiUrl` (string 500), `ApiKey` (string 500, password display),
   `SourceInstance` (string 120), `Mode` (string 10), `AllowApply` (boolean).
2. Information register `BusinessKPIQueue` with dimensions `QueueId` (UUID)
   and resources `BatchId`, `BusinessDate`, `StoreCode`, `Payload`, `Status`,
   `Attempts`, `NextAttemptAt`, `LastError`, `CreatedAt`, `UpdatedAt`.
3. Common modules: `BKPISettings`, `BKPIUTAdapter`, `BKPIAggregation`,
   plus queue, HTTPS transport, scheduled exchange and diagnostic modules
   after the metadata mapping has been checked.
4. Scheduled job every five minutes calling
   `BKPIScheduledExchange.ProcessQueue()`.
5. A command `Business KPI: preview` that calls
   `BKPIDiagnostics.Preview(Date)` and displays the returned value table.

Do not add subscriptions that perform HTTP during document posting. If event
subscriptions are added later, they may only enqueue the affected store/date.

## Work remaining before installation

1. Obtain a metadata export or access to a test copy of the exact UT build.
2. Implement `BKPIUTAdapter.ReadDay` against that test database.
   All UT-specific names belong in that module. Until then it raises an error
   and no POST can occur.
3. Implement and compile the queue, HTTPS transport, scheduled job and local
   preview in a standalone extension. Test network failures and recovery.
4. Import the completed extension into a test database; do not edit the main
   UT configuration and do not remove existing extensions.
5. Configure URL, source instance, and API key. Leave mode `shadow` and
   `AllowApply = false`.
6. Run local preview for one closed day and reconcile all four stores.
7. Send only to `/api/integration/1c/v1/daily-sales/shadow`.
8. Apply remains a separate manual rollout decision after reconciliation.

The `reference` directory is an executable contract model used by repository
tests. It is not runtime integration code. The server contract can be prepared
and tested independently of the extension metadata binding.
