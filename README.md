# AI-Ecosystem-Sergey

AI-экосистема Сергея Кущева.

## Stores Web Platform

The mobile-first Next.js foundation for the Amper, Ventil, Metiz Market, and
Miska public websites lives in [`apps/stores-web/`](apps/stores-web/). See its
[README](apps/stores-web/README.md) for local setup, Docker, routes, CMS model,
and extension procedures.

## Arthur OS

Arthur OS — единая AI-система для личных задач, бизнеса, памяти, автоматизаций и специализированных навыков.

Главный принцип проекта: один Артур, один интерфейс, одна структурированная память, один список задач и единый журнал решений. Специализированные решения не создаются как изолированные конечные ассистенты — они подключаются к Arthur Core как навыки с ограниченными правами доступа.

Текущий Purchasing Agent for Miska является первым зрелым бизнес-навыком Arthur OS. Он не переписывается ради новой архитектуры и в дальнейшем будет подключён через единый оркестратор.

Каноническая документация проекта находится в [`docs/arthur/`](docs/arthur/):

- [видение](docs/arthur/00_PROJECT_VISION.md);
- [Master Plan](docs/arthur/01_MASTER_PLAN.md);
- [Roadmap](docs/arthur/02_ROADMAP.md);
- [архитектура](docs/arthur/03_ARCHITECTURE.md);
- [модель памяти](docs/arthur/04_MEMORY_MODEL.md);
- [принципы](docs/arthur/05_PRINCIPLES.md);
- [безопасность](docs/arthur/06_SECURITY.md);
- [правила разработки](docs/arthur/07_DEVELOPMENT_RULES.md);
- [реестр модулей](docs/arthur/08_MODULES.md);
- [backlog](docs/arthur/10_BACKLOG.md).

## Purchasing Agent for Miska

Run the complete local SmartZapas analysis with the current financial data and
mandatory assortment matrix:

```bash
npm run purchasing:run -- \
  --input "data/incoming/miska-minmax-current.xlsx"
```

The default assortment matrix is stored in
`data/purchasing/miska-assortment-matrix.json`. It is validated and matched to
report products by a unique article or, when an article is absent or
ambiguous, by an exact normalized product name. Repeated articles never merge
products automatically. The matrix adds a mandatory quality-control layer;
the financial controller remains advisory and does not reduce the order.

See [the assortment matrix guide](docs/purchasing-assortment-matrix.md) and
[the full-run CLI guide](docs/purchasing-run-cli.md) for the contracts and
operating procedure.

Every normal full run also creates deterministic JSON and Markdown
recommendation explanations. See
[the Recommendation Explanation Layer guide](docs/purchasing-recommendation-explainer.md)
for its read-only contract and confidence rules.

Build a separate, non-authoritative draft assortment matrix for review:

```bash
npm run purchasing:matrix:build -- \
  --input "data/incoming/miska-minmax-current.xlsx" \
  --existing-matrix "data/purchasing/miska-assortment-matrix.json" \
  --dry-run
```

The Matrix Builder never overwrites the working matrix or changes order
quantities. See [the Matrix Builder guide](docs/purchasing-matrix-builder.md)
for classification limits, policy provenance, and the manual-review workflow.

## Purchasing Web Backend v1

Start the local owner-facing web interface and its HTTP backend:

```bash
npm run purchasing:web
```

The server listens only on `127.0.0.1:3210`, accepts a SmartZapas Excel
workbook, runs the existing Purchasing Agent orchestration, exposes compact
browser DTOs, serves the frontend, and streams whitelisted run artifacts.
The Owner Learning Center includes read-only decision, candidate, rule
effectiveness, and Knowledge Health analytics. Candidate lifecycle,
materialization, and rule activation/deactivation remain separate manual
flows with explicit owner actions. There are no automatic rule mutations,
and the server does not send or change purchase orders.

See [the Purchasing Web Backend v1 guide](docs/purchasing-web-backend-v1.md)
for API contracts, upload limits, artifact security, retention, errors, and
local-version constraints.

## Business KPI Web v1

Start the local Business KPI application:

```bash
npm run business-kpi:web
```

The server listens on `127.0.0.1:3220`. Without a database URL it runs in an
explicit `LOCAL_DEV` mode with an in-memory Miska store and synthetic sellers.
The browser supports manual shift create, view, edit, and archive operations;
backend KPI calculation; dashboard and seller aggregation; audited monthly
plan changes; effective-dated settings; atomic historical XLSX dry-run/import
with reconciliation; import history; and a simple monthly XLSX backup export.
PostgreSQL storage and migrations are available through an isolated
`docker/business-kpi/compose.test.yml` stack for server verification. It uses
its own `business_kpi_test` database, network, and persistent volume and does
not reuse the Arthur production database.

See [the Business KPI Web v1 guide](docs/business-kpi/README.md) for the
manual input contract, formulas, routes, permissions, storage model, Excel
status, Docker profile, and local verification procedure.
