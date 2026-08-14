# Arthur v1.0 Foundation

## Status

Implemented foundation layer with Telegram Gateway and Arthur Core reads. The
only enabled write is creation of one internal Arthur task for the configured
canonical owner; business-system writes remain disabled. No real API secrets
are stored in the repository.

## What is Arthur v1.0

Arthur v1.0 is a central orchestration layer for business modules. It turns natural-language requests from any channel into deterministic execution plans, runs the required skills, and synthesizes a single structured answer.

Arthur has a stable identity and capability-awareness layer: it knows its name, role, the businesses it serves, and the skills that are actually registered. This context is passed to the AI provider for direct responses, planning, and synthesis so Arthur never invents capabilities or claims direct access to databases and accounts.

Telegram, Web, and future interfaces are only clients. All business logic lives inside the existing agents in this repository.

## Architecture

```text
Channel (Telegram / Web / CLI)
    ↓
Arthur Gateway
    ↓
Arthur Router
    ↓
Arthur Orchestrator
    ↓
Deterministic Planner  ←  known commands / keywords
    ↓
LLM Planner            ←  ambiguous natural-language requests
    ↓
ExecutionPlan
    ↓
Execution Engine
    ↓
Skills + AI Provider + Knowledge + Memory
    ↓
Synthesizer
    ↓
Unified Response
```

## Module Boundaries

| Module | Responsibility | v1.0 State |
|--------|---------------|------------|
| `registry` | Skill registration, validation, lookup | Implemented |
| `orchestrator` | Request lifecycle, plan execution, response assembly | Implemented |
| `planner` | Rule-based intent detection + LLM plan builder | Implemented |
| `skills/purchasing` | Read-only adapter over Purchasing Agent | Implemented |
| `skills/arthur-core` | Profile/task reads and narrow internal task creation | Implemented |
| `knowledge` | File-backed knowledge index and search | Implemented |
| `memory` | Conversation context interface | Stub implemented |
| `ai` | Provider-neutral AI abstraction with OmniRoute support | Implemented |
| `context` | `requestId`, `correlationId`, `userId`, `channel`, `timestamp` | Implemented |
| `logging` | Structured JSON logs with correlation | Implemented |
| `identity` | Arthur identity, capability context, system prompts | Implemented |
| `errors` | Typed errors and retry classification | Implemented |

## ExecutionPlan Schema

```json
{
  "version": 1,
  "steps": [
    {
      "id": "step_1",
      "skill": "purchasing",
      "operation": "getStatus",
      "parameters": {},
      "dependsOn": [],
      "timeoutMs": 15000,
      "retryable": false,
      "retries": 0
    }
  ]
}
```

The contract is stable. The Orchestrator chooses between the deterministic rule-based builder and the LLM planner based on intent. Both produce the same `ExecutionPlan` shape, so the Execution Engine and skills do not change.

## Skill Contract

```javascript
{
  id: 'purchasing',
  name: 'Arthur Purchasing',
  version: '1.0.0',
  capabilities: [{ id: 'getStatus', readOnly: true }],
  readOnly: true,
  execute: async (input) => ({ status: 'success', data: {}, metadata: {} }),
  health: async () => ({ healthy: true }),
}
```

Skills must:
- have a unique `id`;
- declare capabilities with `readOnly` flag;
- implement `execute(input)` and `health()`.

## Request Lifecycle

1. Gateway/Router creates a raw input.
2. `createArthurContext(input)` generates `requestId` and `correlationId`.
3. `Orchestrator.handle(input)` builds a full request.
4. Memory snapshot is loaded.
5. Knowledge search is performed for known intents.
6. Deterministic Plan Builder produces an `ExecutionPlan` for known intents; ambiguous requests are sent to the LLM Planner.
7. Execution Engine runs steps sequentially or in parallel based on `dependsOn`.
8. Synthesizer combines skill outputs, knowledge, and failures into one answer, using the same identity/capability context.
9. Memory stores the turn.
10. Structured response is returned.

## Knowledge vs Memory vs Operational Data

- **Knowledge** — persistent business knowledge: docs, matrices, policies, architecture decisions, instructions. Rebuildable from files. Excludes runtime state, logs, backups, and transient outputs.
- **Memory** — conversation context per user/correlation. Ephemeral by default.
- **Operational Data** — live spreadsheets, order states, stock levels, owner decisions. Accessed directly by domain agents, not indexed as knowledge.

## Error Model

- `SkillTimeoutError` — step exceeded `timeoutMs`.
- `SkillExecutionError` — step failed after retries.
- `PlanBuildError` — unknown intent with no builder.
- `UnsupportedOperationError` — skill does not support the operation.
- `DataFabricationGuardError` — synthesizer produced a fabricated answer.

Retry is applied only when `error.retryable === true`.

## Current Capabilities

### Purchasing Skill (read-only)

- `getStatus` — summary of current purchasing run.
- `getSummary` — order counts, sums, warnings.
- `getOwnerReview` — items requiring owner attention.
- `getFinalOrder` — returns `NOT_AVAILABLE` / `REQUIRES_OWNER_REVIEW`.

### Supported Intents

- `purchasing.status` — "Что сейчас с закупщиком?"
- `purchasing.owner_review` — "Покажи спорные позиции."
- `purchasing.final_order` — "Какой последний заказ?"
- `purchasing.summary` — "Сводка закупки."
- `knowledge.search` — fallback for unknown messages.

## How to Add a New Skill

1. Create `agents/arthur-v1/skills/<name>/`.
2. Export a skill object matching the contract.
3. Register it in `agents/arthur-v1/index.js`.
4. Add intent mapping and plan builder if needed.
5. Add unit tests in `agents/arthur-v1/tests/`.

## AI Provider Configuration

Environment variables:

- `ARTHUR_AI_PROVIDER` — `fake` (default) or `omniroute`.
- `OMNIROUTE_BASE_URL` — base URL of the OmniRoute OpenAI-compatible API, e.g. `http://omniroute:20128/v1`.
- `OMNIROUTE_API_KEY` — API key for OmniRoute. Never commit this value. Use a dedicated inference key with minimal permissions.
- `OMNIROUTE_FAST_MODEL` — default fast model/combo, e.g. `arthur-fast`.
- `OMNIROUTE_REASONING_MODEL` — model/combo for reasoning tasks. Defaults to `OMNIROUTE_FAST_MODEL`.
- `OMNIROUTE_CODE_MODEL` — model/combo for code/analysis tasks. Defaults to `OMNIROUTE_FAST_MODEL`.

When `ARTHUR_AI_PROVIDER=omniroute`, the Orchestrator can route ambiguous natural-language requests through the LLM Planner. Deterministic commands bypass the LLM and use the rule-based planner directly.

## Model Routing

`OmniRouteProvider` supports three model policies:

- `fast` → `OMNIROUTE_FAST_MODEL`
- `reasoning` → `OMNIROUTE_REASONING_MODEL`
- `code` → `OMNIROUTE_CODE_MODEL`

The default policy is `fast`. Business logic can request a specific policy via `generate(prompt, { policy: 'reasoning' })` or override the model entirely via `generate(prompt, { model: 'custom/model' })`.

## Identity and Capability Context

The canonical identity lives in `agents/arthur-v1/identity/arthur_identity.js`.

It provides:

- `ARTHUR_IDENTITY` — name, role, known businesses, constraints;
- `buildCapabilityContext(skills)` — human-readable list of registered skills and operations;
- `buildSystemMessage({ skills, userName })` — system prompt for direct AI responses and synthesis;
- `buildPlannerSystemMessage({ skills })` — system prompt for the LLM Planner.

The Orchestrator reads the real skill registry, so capabilities are never hardcoded or hallucinated. When a new skill is registered, it automatically appears in Arthur's context.

## Deterministic vs AI Planning

Deterministic intents (rule-based, no LLM):

- `purchasing.status`
- `purchasing.owner_review`
- `purchasing.final_order`
- `purchasing.summary`
- `knowledge.search`

Ambiguous or unknown intents are sent to the LLM Planner when a real AI provider is configured. The LLM Planner:

1. receives the identity context and available skills/operations;
2. asks the model to produce a valid `ExecutionPlan`;
3. validates the plan against the skill registry;
4. rejects write operations, shell/sql/system tools, and unknown skills;
5. falls back to a safe direct AI response if the LLM fails or returns an invalid plan.

If the AI provider is unavailable, deterministic commands continue to work. For AI-only requests the Orchestrator returns a safe fallback that references only registered skills.

## Running Tests

```bash
node --test agents/arthur-v1/tests/*.test.js
npm test
```

## Telegram Gateway Behavior

- `/start` и `/help` — deterministic responses.
- `/status` — показывает статус Gateway, AI provider и выбранную модель.
- Natural-language запросы передаются в Orchestrator.
- Если запрос требует AI, но OmniRoute недоступен, пользователь получает понятное сообщение:
  "Глубокий AI-анализ сейчас недоступен. Детерминированные команды (/status, /help) продолжают работать."
- При прочих ошибках — generic fallback: "Артур временно недоступен. Попробую снова позже."

## Current Limitations

- Purchasing and Arthur Core skills are registered when their runtime configuration is valid.
- Memory is in-process only.
- LLM planner validates plans but does not yet use real model reasoning for ambiguous requests when `ARTHUR_AI_PROVIDER=fake`.
- Only deterministic internal task creation is writable; task edit/complete/delete, owner decision writes, and supplier order sending remain disabled.

## Next Steps

1. Add authentication and user identity mapping to the Telegram Gateway.
2. Implement additional skills: KPI, Sales, Tasks, Pricing, Inventory, Reports.
3. Add persistent memory store.
4. Add confirmation execution layer for write operations.
5. Evaluate LLM plan quality against real OmniRoute model and tune prompts.
