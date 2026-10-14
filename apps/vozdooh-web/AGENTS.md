# VOZDOOH technical foundation

This app is isolated from `apps/stores-web` (AmurskMarket).

## Scope
- Technical architecture, routing, configuration, integration contracts, tests and infrastructure.
- Storefront UI in the approved premium visual direction with the supplied VOZDOOH logo, with demo as the default source and a development/test-only synthetic 1C catalog adapter. Live 1C remains unconfigured.
- The 1C boundary is contractual: only SKU, name, brand, category, volume, price, stock, barcode and available characteristics may come from 1C (`TradeProduct` in `src/catalog/contracts.ts`).
- Editorial content (descriptions, images, scent families, mood, room, recommendations) stays separate from 1C (`EditorialProduct`).
- Local synthetic imports must remain explicitly labeled, isolated from demo data, excluded from Git, and forbidden under NODE_ENV=production. Never silently fall back to demo when an explicitly selected source fails.
- Demo placeholders must stay explicit: never invent real products, brands, prices, stock, notes or fragrance claims.
- Owner-approved request stage: staged-1c checkout may persist real order requests locally through /api/order-requests. Requests are not confirmed orders or reservations. No payment, 1C order creation, delivery booking or notifications are configured; never fabricate them. Keep TypeScript modules consistent with this existing Next.js app.
- Keep the storefront unindexed (noindex + robots disallow) until production data and domain are ready.
- Do not copy AmurskMarket business logic, content, analytics IDs, secrets or environment values.
- External catalog, inventory, payment and delivery systems connect through adapters behind local contracts.
- Never commit credentials or production secrets.

## Verification
Before commit: run `npm run verify`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Owner-approved production decisions (14 October 2026)

Production catalog, indexing, Ozon Pay, order email and existing Ozon delivery integrations are active and must be preserved. The pickup task explicitly authorizes building from the verified recovered production source in `/tmp/vozdooh-seo-merch` and deploying web/worker images through the existing compose; the historical October 6 release is not a valid production baseline. Free store pickup uses the fixed Khabarovsk address and never creates Ozon delivery. See `docs/pickup-release-20261014.md`.

Owner-approved paid-cart fix: cart and checkout copy describes online order checkout. A saved order still awaits verified payment. Browser cleanup may remove only original eligible SKU quantities after server-confirmed paid status; new additions and repeated success visits must be preserved. See `docs/paid-cart-release-20261014.md`.
