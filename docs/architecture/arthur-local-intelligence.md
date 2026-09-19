# Arthur Local Intelligence

Status: canonical architecture direction
Owner: Sergey Kuschev
Project: AI-Ecosystem-Sergey / Arthur

## 1. Strategic decision

Arthur must not depend on any single external AI provider. Claude is not part of the working stack because access is blocked. OpenAI, Qwen and Kimi are replaceable compute providers, not the owners of Arthur's memory, rules or business logic.

Canonical principle:

> Arthur owns the memory, knowledge, business rules, tools and audit trail. External and local models are interchangeable executors.

The target architecture is hybrid:

- local-first for memory, knowledge, rules, routing and basic inference;
- cloud-assisted for difficult reasoning, coding and long-context analysis;
- offline-capable for core store operations;
- provider-agnostic by design.

## 2. Goals

1. Keep Arthur operational when internet access or a cloud provider is unavailable.
2. Preserve all canonical data and decisions on infrastructure controlled by Sergey.
3. Route each task to the cheapest suitable model without rewriting business modules.
4. Allow local models to cover routine operations and cloud models to handle complex work.
5. Prevent AI providers from becoming the source of truth.
6. Make every model action observable, reproducible and auditable.

## 3. Non-goals

- Do not attempt to run a frontier cloud-scale model fully on the current store PC.
- Do not move deterministic purchasing rules into prompts.
- Do not let model memory replace canonical JSON, database or Git-managed policy files.
- Do not give experimental models unrestricted write access to production data or the main branch.

## 4. Target architecture

```text
Users / UI / API / n8n
          |
          v
Arthur Intelligence Runtime
  |-- Task Router
  |-- Policy Engine
  |-- Model Gateway
  |-- Tool Registry
  |-- Memory Service
  |-- Knowledge Service / RAG
  |-- Context Builder
  |-- Safety and Approval Layer
  |-- Audit and Observability
          |
          +------------------------------+
          |                              |
          v                              v
 Local providers                    Cloud providers
  |-- Ollama                         |-- OpenAI / Codex
  |-- local Qwen                     |-- Qwen Max / Qwen API
  |-- future Bonsai builds           |-- Kimi
                                     |-- future providers
```

## 5. Core components

### 5.1 Task Router

Responsibilities:

- classify request type;
- estimate complexity, latency and privacy level;
- choose local or cloud execution;
- apply fallback order;
- refuse unsafe or unauthorized actions;
- record routing reasons.

Example routing policy:

- deterministic calculation or policy check -> local code, no LLM;
- SKU matching, categorization, summaries, simple Q&A -> local model;
- large repository audit, difficult reasoning, architecture -> cloud model;
- sensitive business data -> local processing by default;
- model unavailable -> next compatible provider;
- all providers unavailable -> degraded local mode.

### 5.2 Model Gateway

One internal interface for all models.

Required provider adapters:

- `local_ollama_provider`;
- `openai_provider`;
- `qwen_provider`;
- `kimi_provider`;
- future OpenAI-compatible providers.

The interface must normalize:

- messages and system instructions;
- structured output;
- tool calls;
- streaming;
- reasoning mode;
- token and cost metadata;
- timeout and retry behavior;
- model capability metadata.

Business modules must never call provider SDKs directly.

### 5.3 Policy Engine

Deterministic business logic remains outside the LLM.

For the purchasing agent this includes:

- Min/Max;
- Assortment Policy;
- CORE / OPTIONAL / TEST / EXIT;
- purchase hold;
- pack multiples;
- minimum display quantity;
- mandatory assortment;
- owner decisions and their priority;
- final approved quantity.

The LLM may explain or classify, but it must not silently override canonical rules.

### 5.4 Memory Service

Memory classes:

- canonical project memory;
- owner decisions;
- conversation summaries;
- task state;
- entity facts;
- preferences;
- episodic execution history.

Storage rules:

- structured facts in database or versioned JSON;
- documents in controlled storage;
- embeddings in a replaceable vector index;
- model-specific memory is only a cache;
- every important memory item must have source, timestamp and confidence;
- owner corrections override inferred memory.

### 5.5 Knowledge Service / RAG

Sources:

- repository documentation;
- assortment matrices;
- supplier files;
- purchasing history;
- Owner Review history;
- store procedures;
- KPI documentation;
- product and operational knowledge.

Pipeline:

1. ingest;
2. normalize;
3. deduplicate;
4. assign source metadata and access level;
5. chunk;
6. index;
7. retrieve;
8. cite sources in responses;
9. re-index when canonical files change.

The embedding model and vector database must be replaceable.

### 5.6 Tool Registry

Tools are explicit capabilities, not hidden prompt instructions.

Initial tool groups:

- purchasing calculations;
- assortment policy lookup;
- file import/export;
- Excel report generation;
- Git operations;
- database lookup;
- n8n workflows;
- notification and approval requests.

Every tool must define:

- input schema;
- output schema;
- required permission;
- read/write classification;
- timeout;
- retry policy;
- audit event.

### 5.7 Approval and safety layer

Actions requiring owner approval:

- changing canonical assortment rules;
- approving or sending supplier orders;
- writing to production data;
- deleting files or records;
- changing credentials or infrastructure;
- merging code into main;
- external communications with financial or legal effect.

Read-only analysis may run automatically. Writes must use explicit approval boundaries.

### 5.8 Audit and observability

Record for every run:

- task ID;
- user and source;
- chosen model and provider;
- routing reason;
- input data references;
- tool calls;
- output artifact;
- approval state;
- latency;
- token usage and cost;
- errors and fallbacks;
- final decision source.

Logs must not expose secrets.

## 6. Local intelligence layer

### 6.1 Current base

Use the existing server stack:

- Docker;
- Ollama;
- Open WebUI;
- n8n.

The current server can host memory, RAG, routing, automation and light local inference. It should not be treated as capable of running very large models efficiently without hardware upgrades.

### 6.2 Local model roles

Local models should first handle:

- SKU and product-name matching;
- categorization;
- duplicate detection;
- document summaries;
- retrieval-grounded Q&A;
- routine explanations;
- request classification;
- fallback chat;
- simple extraction into strict JSON.

They must not autonomously approve purchases or modify canonical rules.

### 6.3 Qwen local candidates

Evaluate official, supported Qwen models that fit actual hardware. Selection must be based on measured quality, latency and memory use, not social-media claims.

Bonsai or other extreme quantization builds are experimental candidates only. Before adoption verify:

- repository and release authenticity;
- license of both model and quantization method;
- reproducible benchmark results;
- tool-calling and structured-output quality;
- Russian-language quality;
- long-context stability;
- prompt-injection resistance;
- CPU, RAM and GPU requirements;
- compatibility with Ollama or another supported runtime.

No Bonsai build becomes production-default until it passes the internal evaluation suite.

## 7. Cloud intelligence layer

### OpenAI / Codex

Primary use:

- architecture;
- complex development;
- difficult debugging;
- controlled code generation;
- final review of high-risk changes.

### Qwen

Primary use:

- second coding and reasoning provider;
- repository audit;
- multimodal analysis;
- long-context work;
- fallback when OpenAI is unavailable or uneconomical.

Qwen Code should first be used in read-only audit mode. Any code changes must occur in a dedicated branch with tests and review.

### Kimi

Primary use:

- large-context audits;
- independent review;
- long analytical reports;
- cross-checking complex logic.

### Claude

Not part of the operational stack because access is blocked. No workflow may depend on Claude.

## 8. Suggested repository structure

```text
core/
  intelligence/
    runtime/
    task_router/
    context_builder/
    approvals/
    audit/
  providers/
    base_provider.*
    local_ollama_provider.*
    openai_provider.*
    qwen_provider.*
    kimi_provider.*
  memory/
    memory_service.*
    schemas/
  knowledge/
    ingestion/
    retrieval/
    citations/
  tools/
    registry/
    purchasing/
    files/
    reports/
config/
  models.*
  routing_policy.*
  permissions.*
  fallback_policy.*
data/
  memory/
  knowledge/
  audit/
tests/
  intelligence/
  providers/
  routing/
  safety/
```

Exact paths must be adapted after auditing the current repository. Do not create a parallel architecture that duplicates existing modules.

## 9. Delivery roadmap

### Phase 0 — Architecture and inventory

- audit current repository and provider integrations;
- map existing memory, storage, router, purchasing pipeline and UI;
- identify reusable modules;
- define interfaces and data contracts;
- record current server hardware and benchmarks.

Exit criteria:

- approved architecture map;
- no duplicate subsystem proposed;
- agreed provider interface;
- agreed canonical stores.

### Phase 1 — Provider abstraction

- introduce a common model-provider interface;
- wrap the current OpenAI path;
- add capability metadata;
- add timeouts, retry and fallback;
- ensure business modules do not import provider SDKs directly.

Exit criteria:

- existing behavior remains backward compatible;
- current tests pass;
- provider can be swapped by configuration.

### Phase 2 — Qwen connection and training workflow

- install and authenticate official Qwen Code on Mac;
- run read-only repository audit;
- test one isolated task in a dedicated branch;
- add Qwen API adapter to the runtime;
- measure quality, cost, latency and failure behavior;
- document safe operating procedure.

Exit criteria:

- Qwen works as a second provider;
- no direct production writes;
- evaluation report is stored;
- fallback is tested.

### Phase 3 — Local runtime MVP

- connect Ollama through the common provider interface;
- select a small supported Qwen model;
- add structured extraction and classification tasks;
- add local health checks;
- implement degraded offline mode.

Exit criteria:

- local model completes approved routine tasks offline;
- failures fall back safely;
- no purchasing quantity is changed without deterministic validation.

### Phase 4 — Memory and knowledge

- define canonical memory schemas;
- ingest project and business documents;
- add source-aware RAG;
- add citations and access controls;
- add snapshots and backup/restore.

Exit criteria:

- answers cite internal sources;
- owner corrections persist;
- memory can be exported and restored without a model provider.

### Phase 5 — Tooling and approvals

- expose purchasing and reporting tools through Tool Registry;
- add permission boundaries;
- connect Owner Review approvals;
- record complete audit events.

Exit criteria:

- read and write actions are clearly separated;
- irreversible actions require approval;
- all actions are traceable.

### Phase 6 — Local model evaluation and hardware decision

- benchmark multiple official local models;
- optionally benchmark Bonsai builds in a sandbox;
- compare quality, speed, RAM, power and stability;
- decide whether to upgrade server hardware or add a dedicated AI node.

Exit criteria:

- measured recommendation;
- defined production model and fallback model;
- hardware purchase only after evidence.

### Phase 7 — Production hardening

- monitoring and alerting;
- encrypted secrets;
- backups;
- disaster recovery test;
- prompt-injection tests;
- permission tests;
- load and timeout tests;
- provider outage simulation.

Exit criteria:

- Arthur remains operational in degraded mode during cloud outage;
- recovery procedure is documented and tested.

## 10. Initial priority order

1. Stabilize the purchasing agent and assortment matrix.
2. Audit the repository before architectural changes.
3. Connect and learn Qwen Code in read-only mode.
4. Introduce the provider abstraction layer.
5. Connect Ollama through the same interface.
6. Build canonical memory and source-aware RAG.
7. Evaluate local Qwen and Bonsai candidates.
8. Make a hardware decision from benchmarks.

The architecture must be considered during current purchasing-agent work, but implementation must not destabilize the canonical purchasing pipeline.

## 11. Mandatory evaluation suite

Every candidate model must be tested on real Arthur tasks:

- Russian business instructions;
- SKU matching with noisy names;
- duplicate detection;
- CORE / OPTIONAL / TEST / EXIT classification;
- extraction from supplier documents;
- explanation of deterministic purchasing decisions;
- strict JSON compliance;
- tool-call correctness;
- resistance to instructions embedded in documents;
- repository navigation;
- code review without unauthorized edits;
- latency and resource usage.

A model is selected by task, not by a single public benchmark.

## 12. Canonical rules to remember

- Claude is unavailable and excluded from the operational architecture.
- Arthur is provider-agnostic.
- Local data, memory, rules and audit logs belong to Arthur.
- External models are replaceable executors.
- Qwen must be connected and learned as a second cloud/coding provider.
- Ollama is the initial local inference runtime.
- Local Qwen models are the primary local-model candidates.
- Bonsai is an experimental candidate, not an accepted production dependency.
- Deterministic purchasing logic remains outside LLMs.
- No model may silently modify canonical assortment decisions.
- All production writes require controlled permissions and auditability.
