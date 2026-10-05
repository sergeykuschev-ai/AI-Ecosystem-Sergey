# UT 11.5.27.61 daily sales contract extension

This document extends the deployed `1.0` daily-sales API. It does not add an
endpoint or replace the existing `020_onec_integration` tables. Migration
`021_onec_ut11527_contract` adds columns to `onec_daily_sales` for diagnostics
and source provenance. It must be applied before deploying the updated server
code; it has not been applied to production by this change.

## Source facts

The 1C extension must use only posted documents:

| 1C source | Effect on KPI | Date |
|---|---|---|
| Чек ККМ | Retail sale, payment channels, receipts, units | Check date |
| Чек ККМ на возврат | Reduce actual refund channel and units | Return check date |
| Реализация товаров и услуг to a legal entity | B2B shipment | Realization date |
| Заказ клиента | None | — |
| Поступление безналичных ДС | None | — |

Store identity comes from the document's store or warehouse. Organization is
retained separately as provenance. The only accepted store codes are `amper`,
`ventil`, `metiz-market`, and `miska`.

## Daily record

One record is sent per store and closed business date. `recordId` is stable,
for example `miska:2026-10-04`; `sourceUpdatedAt` must increase whenever a
source document is changed, reposted or unposted. A changed aggregate gets a
new `batchId`. A transport retry reuses the original `batchId` and JSON body.

Existing fields retain their meaning:

- `cash`: net retail cash after cash refunds;
- `acquiring`: net card plus SBP after card and SBP refunds;
- `qr`: net SBP, already included in `acquiring`;
- `b2b`: posted legal-entity shipments;
- `receipts`: sale checks only;
- `itemsSold`: sale units less returned units;
- `returnsAmount`: positive retail refunds for legacy clients.

Optional v1 additions are:

- `retailSales`, `retailReturns`: gross sale and refund amounts;
- `cashReturns`, `cardReturns`, `qrReturns`: actual refund channels;
- `cashiers`: array of `{ref, code, name, receipts, itemsSold}`;
- `organizationRefs`: array of 1C organization references;
- `sourceDocuments`: array of `{type, ref, number, postedAt, updatedAt,
  warehouseRef, organizationRef, cashierRef}`. Type is `retail_sale`,
  `retail_return`, or `b2b_shipment`.

`retailSales - retailReturns = cash + acquiring` and
`retailReturns = cashReturns + cardReturns + qrReturns` when the refund
breakdown is supplied. `qr <= acquiring`. Revenue is `cash + acquiring + b2b`;
adding `qr` again would double count SBP. Legacy payloads without the new
fields remain accepted, including retries of previously accepted batches.

## Miska shadow reconciliation

For a store-level Miska record without `employeeCode`, the shadow endpoint
compares the 1C aggregate with the sum of active manual seller shifts for that
date. The accepted shadow row has no employee ID. Cashier details remain in
`cashiers` and source documents. Applying a store-level Miska aggregate to a
personal shift is rejected with `ONEC_MISKA_APPLY_REQUIRES_REVIEW`, even if an
employee code is supplied. Personal attribution needs a separately reviewed
contract before apply can be used for Miska.

## Known validation boundary

The current KPI shift model requires nonnegative net payment amounts and
integer nonnegative sold units. A return-only day or a day where refunds
exceed sales in one channel can produce a negative net value. Such a day must
remain in local preview and must not be sent as a misleading zero or assigned
to a different payment channel. Supporting signed daily KPI shifts requires a
separate reviewed change to the existing KPI calculation and shift schema.

## Rollout

The 1C metadata adapter and `.cfe` have not been validated. Once available,
preview a closed day locally, reconcile all four stores, then send only to
`POST /api/integration/1c/v1/daily-sales/shadow`. The production apply endpoint
is not enabled by this work.
