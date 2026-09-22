# VOZDOOH web

Independent technical foundation for the future VOZDOOH e-commerce storefront.

## Local development
1. Copy `.env.example` to `.env.local`.
2. Run `npm ci`.
3. Run `npm run dev -- -p 3400`.
4. Health endpoint: `/api/health`.

## Architecture
- `app/` — Next.js routing only.
- `src/config/` — environment configuration.
- `src/catalog/` — catalog and inventory domain contracts.
- `src/commerce/` — order and payment domain contracts.
- `src/integrations/` — future provider adapters.

The current page is intentionally a neutral placeholder. The approved site prototype should later replace presentation code while keeping these boundaries.
