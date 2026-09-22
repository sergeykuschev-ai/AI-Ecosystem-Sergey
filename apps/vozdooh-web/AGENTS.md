# VOZDOOH technical foundation

This app is isolated from `apps/stores-web` (AmurskMarket).

## Scope
- Technical architecture, routing, configuration, integration contracts, tests and infrastructure only.
- UI work is out of scope until the approved prototype is supplied.
- Keep the root page as a neutral technical placeholder.
- Do not copy AmurskMarket business logic, content, analytics IDs, secrets or environment values.
- External catalog, inventory, payment and delivery systems connect through adapters behind local contracts.
- Never commit credentials or production secrets.

## Verification
Before commit: run `npm run verify`.
