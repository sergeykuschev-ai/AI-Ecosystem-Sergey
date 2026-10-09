# Arthur: DeepSeek + GLM direct API (staged, not deployed)

## Goal

Keep daily Telegram/Arthur traffic on DeepSeek-V4.1-Flash and reserve GLM-5.3
for explicitly marked reasoning/code requests. Do not move Arthur or its data
from the Amursk server to `stores-web1`.

## Configuration (server-side only)

Set the following in Arthur Telegram Gateway's protected environment on the
**Amursk host** (not in Git, logs, Telegram messages, or a user-facing page):

```dotenv
ARTHUR_AI_PROVIDER=deepseek-glm
ARTHUR_AI_BUDGET_DIR=/var/lib/arthur-ai-budget
ARTHUR_OLLAMA_FALLBACK_ENABLED=true
DEEPSEEK_API_KEY_FILE=/run/secrets/arthur_deepseek_api_key
ZAI_API_KEY_FILE=/run/secrets/arthur_zai_api_key
DEEPSEEK_MODEL=deepseek-flash
ZAI_MODEL=glm-5.3
```

The model IDs are those published by the providers as of 2026-10-09:

- DeepSeek: https://api-docs.deepseek.com/quick_start/pricing/
- GLM: https://docs.z.ai/guides/overview/pricing

Both keys are **separate API credentials**. A Kimi web or Kimi Code
membership is not an API key for either service.

## Routing

| Work | Policy | Endpoint |
| --- | --- | --- |
| Ordinary planning, Telegram answers, routine summaries | `fast` (default) | `https://api.deepseek.com/chat/completions` — `deepseek-flash` |
| Explicit complex reasoning | `reasoning` | `https://api.z.ai/api/paas/v4/chat/completions` — `glm-5.3` |
| Explicit code request | `code` | Same Z.ai endpoint |

Current planner and synthesizer send ordinary requests by default. No
automatic classification of complexity is introduced in this change. Existing
OmniRoute and fake provider modes remain unchanged.

The new direct router does not load OmniRoute secrets as a fallback, does not
place either API key in diagnostics, and does not retry failed requests
automatically (avoiding surprise duplicate billed requests).

## Cost policy

Start with a small prepaid balance (approximately USD 10–20 total **after
explicit owner approval**), and monitor each provider account balance.
The direct API factory now **requires** a persistent writeable
`ARTHUR_AI_BUDGET_DIR` volume before any paid calls can be made.
The admission guard holds an exclusive directory lock and persists a
conservative cost *reservation* before each outgoing API POST. Limits
survive process restarts and apply across both providers. The file ledger
does not save prompts, credentials, or replies.

Default reservation ceilings (USD): DeepSeek $0.75/day and $5 lifetime,
GLM $0.75/day and $3 lifetime, together $1.25/day and $7 lifetime.
Max output tokens/request: DeepSeek 1,024; GLM 1,536. Amounts are
**conservative estimates, not a guaranteed financial hard cap**: network
timeouts still count; provider rates and final invoices may differ.
Provider-side prepayment is the final backstop. On quota exhaustion or
unavailable ledger, the Windows-specific integration can fall back to
local Ollama. The ledger directory must be mounted read-write and ACL
protected on the Amursk host; do not place it in Git or an ephemeral container. Subscription Kimi Allegretto and direct API bills are
different products.

The DeepSeek peak/off-peak price varies. Estimates from 2026-10-09:
`deepseek-flash` USD 0.15–0.30 per 1M uncached input tokens and
USD 0.60–1.20 per 1M output tokens; `glm-5.3` USD 1.40 input and USD 4.40
output. Verify pricing before top-up. Only the provider billing dashboard is
authoritative for paid usage.

## Deployment checklist (not executed)

1. Identify the actual Windows/Ubuntu host that runs Arthur in Amursk.
2. Verify that current Arthur startup uses `agents/arthur-v1/ai/provider_factory.js`.
3. Obtain the two API keys directly in the Amursk secret store, without
   sending them through chat or committing them to Git.
4. Apply this branch in a separate candidate build; run tests.
5. Test HTTPS outbound access to both API endpoints with minimal non-personal prompts.
6. Check `/status`, tasks, reminders, the KPI skill and the purchasing skill.
7. Mount durable host storage to `/var/lib/arthur-ai-budget` RW; verify the local Ollama fallback and the billing guard in staging before production.
8. Switch `ARTHUR_AI_PROVIDER`, restart only the Gateway when its maintenance
   window is confirmed, and keep the previous configuration for rollback.
9. Measure request/token usage and billing for several days before scaling.

## Verification

```bash
node --test agents/arthur-v1/tests/direct_model_router.test.js \
  agents/arthur-v1/tests/provider_factory.test.js \
  agents/arthur-v1/tests/omniroute_provider.test.js
```

The tests use fake API responses and never create provider charges.

## Protected container mounts

Mount the already-provisioned API key **files** from the Amursk host read-only
into `/run/secrets/arthur_deepseek_api_key` and
`/run/secrets/arthur_zai_api_key`. Mount the host's private
`arthur-budget-ledger` directory read-write at `/var/lib/arthur-ai-budget`.
No actual API key values belong in Compose environment, Docker image layers,
GitHub, log output, or Telegram. Set `*_API_KEY_FILE`, not plaintext `*_API_KEY`.
This staged candidate is not deployed until gateway settings and rollback have
been tested. Never erase or reset the reservation ledger merely to bypass a
quota; review billing and request explicit owner approval.
