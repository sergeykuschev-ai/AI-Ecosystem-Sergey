# VOZDOOH integration boundary

External systems must be connected through adapters that implement contracts from `src/catalog` and `src/commerce`.

## 1C boundary (pre-1C state)

Only these trade fields may come from the 1C exchange (`TradeProduct` in `src/catalog/contracts.ts`):
SKU, name, brand, category, volume, price, stock, barcode and the characteristics that are actually available in 1C.

Everything editorial stays outside 1C (`EditorialProduct`): descriptions, images, scent family, mood, room and recommendations. It is produced by the VOZDOOH content process.

Until the 1C adapter exists, `src/catalog/demo.ts` provides explicit DEMO placeholders: every 1C-owned field is null and the UI says so instead of inventing values.

Commerce boundary: there is intentionally no order or payment adapter. The checkout UI does not create orders and does not submit payments. `OrderService` and `PaymentGateway` contracts are reserved for confirmed providers only.

Planned boundaries:
- catalog source (1C CommerceML exchange);
- inventory / 1C synchronization;
- order persistence;
- payment gateway;
- delivery provider;
- analytics and event export.

Provider credentials belong in environment secrets. Do not import AmurskMarket services or configuration into this app.
