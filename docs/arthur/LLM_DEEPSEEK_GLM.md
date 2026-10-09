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
DEEPSEEK_API_KEY=<provided in server secret store>
ZAI_API_KEY=<provided in server secret store>
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
**This application does not currently enforce a cross-provider USD hard cap,
so do not enable unattended high-volume traffic before setting provider-side
payment safeguards.** Subscription Kimi Allegretto and direct API bills are
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
7. Switch `ARTHUR_AI_PROVIDER`, restart only the Gateway when its maintenance
   window is confirmed, and keep the previous configuration for rollback.
8. Measure request/token usage and billing for several days before scaling.

## Verification

```bash
node --test agents/arthur-v1/tests/direct_model_router.test.js \
  agents/arthur-v1/tests/provider_factory.test.js \
  agents/arthur-v1/tests/omniroute_provider.test.js
```

The tests use fake API responses and never create provider charges.
