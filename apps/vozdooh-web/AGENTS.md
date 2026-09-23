# VOZDOOH technical foundation

This app is isolated from `apps/stores-web` (AmurskMarket).

## Scope
- Technical architecture, routing, configuration, integration contracts, tests and infrastructure.
- Storefront UI in the approved premium visual direction with the supplied VOZDOOH logo, kept in a verified pre-1C demo state.
- The 1C boundary is contractual: only SKU, name, brand, category, volume, price, stock, barcode and available characteristics may come from 1C (`TradeProduct` in `src/catalog/contracts.ts`).
- Editorial content (descriptions, images, scent families, mood, room, recommendations) stays separate from 1C (`EditorialProduct`).
- Demo placeholders must stay explicit: never invent real products, brands, prices, stock, notes or fragrance claims.
- Checkout UI is allowed; fake payments and fake order submission are not. There is no order API.
- Keep the storefront unindexed (noindex + robots disallow) until production data and domain are ready.
- Do not copy AmurskMarket business logic, content, analytics IDs, secrets or environment values.
- External catalog, inventory, payment and delivery systems connect through adapters behind local contracts.
- Never commit credentials or production secrets.

## Verification
Before commit: run `npm run verify`.
