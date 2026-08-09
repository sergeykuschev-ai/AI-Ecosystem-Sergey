# Arthur v1.0 Foundation

## Status

Implemented foundation layer. All operations are read-only. No Telegram Gateway, no writes to business systems, no real API secrets.

## What is Arthur v1.0

Arthur v1.0 is a central orchestration layer for business modules. It turns natural-language requests from any channel into deterministic execution plans, runs the required skills, and synthesizes a single structured answer.

Telegram, Web, and future interfaces are only clients. All business logic lives inside the existing agents in this repository.

## Architecture

```text
Channel (Telegram / Web / CLI)
    ↓
Arthur Gateway (not implemented in v1.0)
    ↓
Arthur Router (not implemented in v1.0)
    ↓
Arthur Orchestrator
    ↓
Rule-based Plan Builder
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
| `planner` | Rule-based intent detection and plan building | Implemented |
| `skills/purchasing` | Read-only adapter over Purchasing Agent | Implemented |
| `knowledge` | File-backed knowledge index and search | Implemented |
| `memory` | Conversation context interface | Stub implemented |
| `ai` | Provider-neutral AI abstraction | Implemented (fake provider) |
| `context` | `requestId`, `correlationId`, `userId`, `channel`, `timestamp` | Implemented |
| `logging` | Structured JSON logs with correlation | Implemented |
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

The contract is stable. The rule-based builder can later be replaced with an LLM-based planner without changing the Orchestrator or Execution Engine.

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
6. Plan Builder produces an `ExecutionPlan`.
7. Execution Engine runs steps sequentially or in parallel based on `dependsOn`.
8. Synthesizer combines skill outputs, knowledge, and failures into one answer.
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

## Running Tests

```bash
node --test agents/arthur-v1/tests/*.test.js
npm test
```

## Current Limitations

- Telegram Gateway is not implemented.
- LLM-based planner is not implemented.
- Only the purchasing skill exists.
- AI Provider uses a deterministic fake implementation.
- Memory is in-process only.
- All operations are read-only; no owner decision writes, no supplier order sending.

## Next Steps

1. Implement Arthur Telegram Gateway.
2. Add authentication and user identity mapping.
3. Replace rule-based planner with LLM-based planner using the same ExecutionPlan contract.
4. Add real AI provider with model routing.
5. Implement additional skills: KPI, Sales, Tasks, Pricing, Inventory, Reports.
6. Add persistent memory store.
7. Add confirmation execution layer for write operations.
