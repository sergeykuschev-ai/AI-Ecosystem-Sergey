# AI-Ecosystem-Sergey Development Guide

This file is the primary development guide for humans and AI coding agents working in this repository. Its instructions apply to the entire repository unless a more specific `AGENTS.md` exists in a subdirectory.
When this guide conflicts with an ad hoc implementation preference, follow this guide. When it conflicts with an explicit product decision, document the decision and update this guide in the same change.

## 1. Project Mission

AI-Ecosystem-Sergey is a modular ecosystem of specialized business agents. Each agent should turn domain data into reliable, explainable, and actionable results.
The system should automate repetitive operational work without hiding important business decisions.

The project exists to:

- encode business expertise in maintainable agent modules;
- improve the speed and quality of recurring business decisions;
- make calculations and recommendations reproducible;
- keep orchestration separate from domain logic;
- support incremental delivery, beginning with purchasing;
- provide clear interfaces for future integrations and user experiences.

The project values correctness, traceability, and operational usefulness over novelty. An agent is successful only when its output can be understood, checked, and safely used. Human review must remain possible for consequential or irreversible actions.

## 2. Repository Structure

The intended top-level structure is:

```text
AI-Ecosystem-Sergey/
├── agents/                 # Domain agents and their business logic
│   ├── purchasing/         # Highest-priority agent
│   ├── analytics/          # Analytics capabilities
│   ├── crm/                # Customer relationship capabilities
│   ├── finance/            # Financial capabilities
│   └── marketing/          # Marketing capabilities
├── docker/                 # Container and local runtime definitions
├── docs/                   # Architecture, decisions, and operating guides
├── knowledge/              # Curated, non-secret domain knowledge
├── n8n/                    # Exported workflows and orchestration assets
├── prompts/                # Versioned reusable prompt assets
├── scripts/                # Repository maintenance and developer tooling
├── AGENTS.md               # Primary development guide
├── README.md               # Project overview and quick start
└── package.json            # Node.js project metadata and commands
```

Within a mature agent, prefer this shape when applicable:

```text
agents/<agent-name>/
├── <agent-name>_agent.js   # Public entry point or application service
├── config.js               # Non-secret defaults and configuration mapping
├── parsers/                # Input normalization and parsing
├── rules/                  # Explicit domain rules and policy constants
├── services/               # Business use cases and transformations
├── prompts/                # Agent-specific prompts, if needed
├── schemas/                # Input and output contracts, if needed
├── tests/                  # Tests and fixtures
└── original/               # Temporary reference code awaiting migration
```

Do not create directories speculatively. Add a directory when it has a clear owner and at least one real artifact.
The `original/` directory is reference material, not the preferred production path. New code must use the modular implementation outside `original/`.

## 3. Development Principles

Make the smallest coherent change that solves the stated problem. Preserve existing behavior unless the task explicitly changes it.
Prefer simple modules and explicit data flow over hidden framework behavior. Separate parsing, validation, business rules, analysis, and presentation.
Make domain decisions visible in named functions, constants, and tests. Design every important calculation so that it can be reproduced from recorded inputs.

Use these principles during implementation:

- understand the current flow before editing it;
- confirm assumptions against repository code and documentation;
- define inputs, outputs, and failure modes before adding complexity;
- reject invalid data early with actionable error messages;
- keep deterministic work deterministic;
- isolate external services behind narrow interfaces;
- avoid unrelated refactoring in feature and bug-fix changes;
- prefer incremental migration over large rewrites;
- optimize only after correctness and measurement;
- leave the touched area clearer than it was.

Never silently guess when missing data could materially change a purchasing decision. If a fallback is safe and intentional, name it, test it, and expose it in result metadata.
Logs and diagnostics must identify the input, stage, and failure reason. Never log secrets or unnecessary customer, supplier, or financial data.

## 4. Git Rules

Keep commits focused on one logical change. Use imperative, descriptive commit subjects.
Recommended prefixes include `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, and `chore:`. Explain non-obvious changes in the commit body or associated documentation.

Before committing:

- inspect `git status` and the complete diff;
- remove debug output and accidental generated files;
- run relevant tests and quality checks;
- verify that no secret or private dataset is staged;
- update documentation when interfaces or behavior changed.

Do not commit `.env` files, credentials, API keys, tokens, private certificates, or production exports.
Do not commit raw business spreadsheets or PDFs unless they are approved, sanitized fixtures. Use synthetic or anonymized test data.
Do not rewrite shared history without explicit maintainer approval, force-push protected branches, or bypass failing checks to merge a change.

Avoid mixing formatting-only changes with behavioral changes. Do not discard or overwrite another contributor's uncommitted work.
Generated n8n workflow exports must be reviewed as code. Pull requests should state the problem, approach, validation performed, and operational risk.

## 5. Coding Standards

The current runtime is Node.js using CommonJS modules. Use `require` and `module.exports` consistently until an intentional repository-wide migration is approved. Do not mix module systems within the same agent.

Write code that is direct and readable:

- use `const` by default and `let` only for reassignment;
- never use `var` in new code;
- use descriptive domain names instead of generic placeholders;
- keep functions focused on one level of abstraction;
- prefer early validation and guard clauses;
- avoid mutation of caller-owned data unless explicitly documented;
- replace unexplained literals with named domain constants;
- keep configuration separate from executable logic;
- use comments to explain intent and constraints, not syntax;
- remove dead code instead of commenting it out.

Public functions must have stable, documented input and output shapes. Validate data at system and agent boundaries.
Error messages should identify what failed and how to correct it. Do not suppress errors; wrap them only to add context, preserving the original cause when possible.

Use English consistently for identifiers and developer-facing comments. Business-facing generated text may use the product's required language.
Preserve precision during calculations and round only at an explicit reporting or contract boundary. Document currency and rounding rules.
Treat dates, time zones, units, and percentages as explicit data, never implied context.

Add dependencies only when they provide clear value over a small local implementation. Prefer maintained packages with compatible licenses and limited transitive risk. Never add a dependency for a trivial helper.

## 6. Architecture Rules

Each domain agent owns its domain behavior, contracts, and tests. Agents must be independently callable without n8n.
Core business logic must be deterministic wherever practical. Infrastructure details must not leak into domain rules.

Use this dependency direction:

```text
external trigger -> adapter/orchestrator -> agent entry point
agent entry point -> validation -> parser -> domain services/rules
domain result -> formatter/contract -> external response
```

Dependencies may point inward toward domain logic, not outward toward orchestration. Rules must not import n8n workflow code.
Parsers normalize data without unrelated business decisions. Prompt builders must not replace deterministic calculations. Validators enforce contracts without performing the main use case.

Define an explicit contract at every agent boundary. Prefer plain JavaScript objects that can be serialized and tested.
Include provenance and diagnostics when they support auditing. Version contracts when a breaking change cannot be avoided.

External APIs, databases, file systems, and language models are infrastructure. Access them through adapters or services with narrow interfaces.
Use dependency injection when it improves testing. Avoid global mutable state and hidden initialization order. Design retries, timeouts, and idempotency at integration boundaries.

Cross-agent shared code belongs in a shared module only after genuine duplication exists. Do not couple agents through undocumented internal imports.
Communicate through explicit contracts, not shared mutable storage. Record significant architectural decisions in `docs/`.

## 7. n8n Rules

n8n is orchestration only. All business logic must stay inside agents.
An n8n workflow may trigger, route, schedule, authenticate, and transport data. It may not own purchasing formulas, classification policy, validation policy, or recommendation logic.

Allowed n8n responsibilities include:

- schedules, webhooks, and manual triggers;
- fetching input from approved systems;
- mapping transport fields into a documented agent request;
- calling an agent through its public entry point or API;
- routing success, retry, and failure paths;
- sending agent results to approved destinations;
- operational notifications and correlation metadata.

Forbidden n8n responsibilities include:

- calculating order quantities or stock thresholds;
- embedding supplier, category, ABC, or XYZ policy;
- implementing data-quality rules that belong to an agent;
- using large Code nodes as hidden application modules;
- constructing core recommendations directly in prompts;
- duplicating agent logic across workflow branches;
- treating workflow state as the system of record.

Code nodes should be small adapters only. If one requires unit tests, domain knowledge, or repeated changes, move it into an agent.
Workflow expressions should perform only transport-level mapping and simple formatting.

Store reviewed workflow exports under `n8n/` with stable, descriptive names. Remove credentials, execution data, personal identifiers, and environment-specific IDs before commit.
Document required credentials without their values. Every production workflow needs an owner, purpose, trigger, agent contract, and failure path. Test success and failure scenarios.

## 8. Purchasing Agent

The Purchasing Agent is the highest-priority project in this repository. When priorities conflict, protect its correctness, test coverage, and delivery path first.
Changes to purchasing calculations require stronger review than cosmetic or experimental work elsewhere.

The current public flow begins in `agents/purchasing/order_agent.js`; it orchestrates internal modules and constructs the result contract.
Parsing belongs in `parsers/`. Supplier, category, ABC, and XYZ policy belongs in `rules/`.
Analysis and prompt construction belong in focused `services/` modules. Input and result checks belong in `services/validator.js` until a dedicated validation layer is justified.

Purchasing work must preserve these qualities:

- source rows can be traced through normalization and analysis;
- detected columns and assumptions are visible;
- product, order, and zero-stock counts are reproducible;
- preliminary order sums use documented precision and rounding;
- supplier and category rules are explicit and independently testable;
- recommendations distinguish facts, calculations, assumptions, and generated explanation;
- malformed inputs fail clearly instead of producing plausible-looking orders.

Do not add behavior to `original/minmax_parser_v1.js`; use it only to compare legacy behavior during migration.
Move required behavior into modular code with characterization tests. Delete legacy code only after parity is demonstrated and removal is approved.

Before changing a purchasing rule, identify its business source and affected scenarios. Test thresholds, boundaries, missing values, zero stock, and exceptional categories.
Do not let an LLM decide deterministic quantities. LLMs may explain, summarize, flag ambiguity, or draft recommendations from verified calculations.

Any future action that creates or sends a purchase order must be idempotent and support human approval, audit logging, and safe retries.
No automated purchasing action may be introduced as a side effect of an analysis function.

## 9. Testing Requirements

Every behavioral change requires tests proportional to its risk. Bug fixes require a regression test that fails before the fix and passes after it.
Refactoring must preserve existing tests and observable behavior. New public contracts require positive, negative, and boundary tests.

At minimum, test:

- valid representative input;
- empty and missing input;
- malformed rows and unsupported values;
- column detection and normalization variants;
- zero, negative, fractional, and unusually large numbers where relevant;
- threshold values immediately below, at, and above each rule boundary;
- stable output shape and required metadata;
- external-service errors, timeouts, and retries when integrations exist.

Prefer unit tests for parsers, rules, validators, and deterministic services. Use integration tests for the complete agent entry point.
Use workflow tests only for orchestration and contract wiring. Do not rely on live services in the default suite; use fakes or fixtures and separate opt-in end-to-end tests.

Test fixtures must be minimal, readable, synthetic, and free of secrets. Snapshots may supplement but not replace meaningful business assertions.
Tests must assert important values, not merely successful execution. Test non-deterministic model output through structured contracts and bounded invariants.

The current `npm test` placeholder is not an acceptable long-term strategy. Keep the first test framework lightweight and document all commands.
Until automation exists, record repeatable manual checks. Never claim a test passed unless it ran in the current environment.

## 10. Documentation Rules

Documentation is part of the implementation; update it in the same change as the behavior it describes.
Keep the root `README.md` focused on purpose, setup, and quick start, and detailed architecture, operations, and decision records in `docs/`.

Document:

- public agent inputs, outputs, and examples;
- required environment variables without secret values;
- business rules and their authoritative source;
- setup, test, and execution commands;
- integration failure behavior and recovery steps;
- breaking changes and migration instructions;
- assumptions that affect calculations or recommendations.

Use professional English for developer documentation.
Use clear headings, short paragraphs, and executable examples.
Mark proposals and future behavior as such; do not describe them as implemented.
Keep diagrams close to the text they explain and update both together.
Link to code instead of copying large code blocks that will drift.

Prompt files are versioned product artifacts.
Document their purpose, required variables, expected output, and evaluation method.
Do not place secrets, private data, or environment-specific values in prompts or examples.
Architecture decision records should explain context, decision, alternatives, and consequences.

## 11. AI Workflow

The default division of responsibility is:

```text
ChatGPT -> architecture and product reasoning
Codex   -> repository implementation and verification
n8n     -> runtime orchestration and integration routing
```

ChatGPT defines or reviews system boundaries, contracts, tradeoffs, and staged plans.
Codex inspects the repository, implements scoped changes, runs checks, and reports evidence.
n8n connects approved triggers and systems to stable agent interfaces.
These roles may collaborate, but their responsibilities must not blur architectural boundaries.

For AI-assisted work:

1. State the objective, constraints, and acceptance criteria.
2. Inspect existing code and documentation before proposing changes.
3. Identify affected contracts, rules, tests, and operational risks.
4. Implement the smallest complete change in the correct layer.
5. Run relevant tests and inspect the final diff.
6. Report what changed, what was verified, and what remains uncertain.
7. Update documentation and roadmap status when appropriate.

AI output is a draft until verified against code, tests, and domain rules.
Never accept invented APIs, filenames, business policies, or test results.
Ask for domain confirmation when a purchasing assumption could change an order decision.
Prefer structured handoffs with explicit inputs, outputs, and acceptance criteria.

ChatGPT should not design business logic directly into n8n.
Codex should not introduce architectural scope beyond the stated goal without surfacing it.
n8n should not compensate for an unclear agent contract with duplicated logic.
Human maintainers retain final authority over business policy and production actions.

## 12. Current Roadmap

The roadmap is ordered by current priority and should be updated as milestones change.

### Phase 1: Purchasing Agent Foundation

- stabilize the modular Purchasing Agent entry point;
- characterize legacy parser behavior with tests;
- define and document canonical input and output contracts;
- cover parser, validator, analyzer, and rule boundaries with unit tests;
- replace the placeholder `npm test` command with a real test suite;
- create synthetic fixtures for common spreadsheet layouts;
- document purchasing assumptions, units, currency, and rounding.

### Phase 2: Purchasing Reliability

- add structured diagnostics and error categories;
- make calculation provenance visible in results;
- evaluate parity with required behavior from `original/`;
- add integration tests for the full Purchasing Agent flow;
- formalize prompt evaluation for generated purchasing text;
- define human approval and audit requirements for order actions.

### Phase 3: n8n Integration

- define a minimal workflow-to-agent adapter contract;
- add reviewed development workflow exports under `n8n/`;
- test success, validation failure, retry, and notification paths;
- document credentials, deployment, ownership, and recovery procedures;
- verify that workflows contain orchestration only.

### Phase 4: Platform Foundations

- establish shared logging and configuration conventions;
- add continuous integration for tests and basic quality checks;
- define secure secret management and environment separation;
- document agent versioning and compatibility policy;
- introduce shared modules only where proven duplication exists.

### Phase 5: Additional Agents

- select the next agent from analytics, CRM, finance, or marketing by business value;
- define its domain owner, contract, risks, and success measures;
- reuse stable platform conventions without coupling domain logic;
- deliver one narrow, tested use case before expanding scope;
- integrate through n8n only after the agent works independently.

Roadmap items are plans, not claims of completed functionality.
Keep active work small enough to verify and deploy safely.
Purchasing Agent correctness remains the release gate for purchasing-related automation.
