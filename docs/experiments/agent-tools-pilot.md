# Pilot: Ponytail, selected Agent Skills, Graphify (2026-10-09)

## Scope and constraints

Target: the Purchasing Agent in this repository. **No production rollout.**
Do not execute the experiment on stores-web1 or inside Amursk production services.
The target machine is the **Amursk Windows development/AI server**, using a
separate local pilot profile and disposable checkout. A MacBook is not required.
No changes to 1C, production databases, stock matrices, KPI data, production
service settings or deployments. Do not pass credentials, source customer
records, supplier exports or live purchase spreadsheets to any new tool.

Existing `AGENTS.md` already requires small changes, verifiable tests, and
careful review. Additional tools are optional and must not override those
requirements. No claim of token savings is accepted without a controlled test.

## First automated pilot

`.github/workflows/agent-tools-pilot.yml` runs in isolated GitHub-hosted
runners **only for this pilot pull request**:
1. Baseline: install repository dependencies without lifecycle scripts, run
   `node --test agents/purchasing/tests/*.test.js`.
2. Graphify: execute `uvx --from graphifyy graphify agents/purchasing --no-viz`.
3. Verify the graph exists and is nonempty. Capture the CLI version in logs.

Important: this checks graph generation, **not** token savings or code quality.
The third-party PyPI package runs exclusively in an ephemeral CI runner with
read-only GitHub permissions, not on an operating store server.

## Installation on the Amursk Windows server (isolated pilot only)

Verify the installed Codex/Claude Code versions and inspect the upstream
plugin repositories/activation hooks before applying. Prefer project-scoped
installation over a global modification. Do not use these commands on VPS.

Ponytail for Codex (author's current documented interface):

```sh
codex plugin marketplace add DietrichGebert/ponytail
codex plugin add ponytail@ponytail
```

Selected Agent Skills: start with `test-driven-development`,
`code-review-and-quality`, and `security-and-hardening`. The native
Codex plugin installs **all** skills; per-skill selection is available via
`npx skills add addyosmani/agent-skills --skill <name>` after inspecting
what files that installer will write. Review shared references because
per-skill installation does not include all repository-level references.

```sh
npx skills add addyosmani/agent-skills --list
```

Graphify is installed inside the isolated Python venv. For all code maps use
`graphify <module> --no-viz --code-only` to avoid LLM processing of docs/images.
Codex's skill registration is project-scoped and must be reviewed before
activation; do not enable automatic lifecycle hooks.

Never enable strict interception or persistent hooks until their behavior is
reviewed. In Codex, inspect and explicitly trust any installed hooks.

## Decision gate

Compare the same fixed, synthetic development task twice (clean control vs.
tool-equipped agent), record: model/version, prompt, input/context tokens,
output tokens, elapsed time, final diff, tests, and any mistakes.
Only then consider extending to Arthur Core and Business KPI.
Leave OmniRoute out of the pilot.

Upstream sources:
- https://github.com/DietrichGebert/ponytail/blob/main/INSTALL.md
- https://github.com/addyosmani/agent-skills
- https://github.com/Graphify-Labs/graphify

## Verified Amursk installation — 2026-10-09

**Actual approach differs from the optional script above:** the Windows
machine has Python 3.13, Codex 0.155.1, Kimi and Claude Code, but no `uvx`.
Therefore `setup-amursk-agent-tools.ps1 -Apply` was NOT used and should NOT
be executed unchanged on that host. The existing production tools were retained.

Via the pre-existing authenticated Tailscale/SSH tunnel, created
`C:\\AI\\AgentToolsPilot20261009\\` containing a clean checkout of this
experiment branch and a local Python `.venv`.

- Installed `graphifyy==0.9.81` with local `python -m pip` in the pilot venv.
- On a clean copy of `agents/purchasing`, parsed **143 code files** and wrote
  a graph of **2463 nodes / 5530 links / 99 communities**.
- Installed project-only Codex Graphify skill using
  `graphify install --project --platform codex`, which modified ONLY the
  pilot checkout's `AGENTS.md`, `.codex/skills/graphify/` and `.codex/hooks.json`.
- Copied project-only Ponytail skill from upstream commit `9cc65d0`, and
  Test-Driven Development, Code Review and Security Hardening skills from
  Agent Skills upstream commit `1401c8b` into pilot `.agents/skills/`.
- `graphify cluster-only` could not label communities: Claude Code on this
  Windows account reported `Not logged in`. The deterministic code graph is
  valid independently of these optional LLM-generated labels.
- Verified the existing purchasing Docker container remained `running`
  and `healthy`. The production checkout does not contain the new Graphify
  skill. No deployment, runtime restart, production database write or migration.

**Pending:** review the project-only Graphify hook and compare a fixed coding
exercise (baseline vs pilot) before enabling these tools outside the pilot.
Codex marketplace plugin listing returned HTTP 403, so the pilot uses local
skills rather than claiming global native marketplace plugin installation.

## Next-step verification — 2026-10-09

An independent clean control checkout was created under
`C:\\AI\\AgentToolsPilot20261009\\AI-Ecosystem-Baseline`.
The same read-only `codex exec` investigation was prepared for control/pilot,
with separate output logs under `C:\\AI\\AgentToolsPilot20261009\\comparison`.
The **control run could not contact the model endpoint** and failed before any
answer was generated. Codex was authenticated (`codex login status` showed
"Logged in using ChatGPT"), but its WebSocket request to
`wss://chatgpt.com/backend-api/codex/responses` returned repeated **HTTP 403
Forbidden**. The pilot run was deliberately **not** launched after that error.
No conclusions about model output quality or token savings can be drawn.

Graphify's deterministic CLI **does work without Claude login** in the isolated
Purchasing Agent folder: `graphify query 'XLSX supplier workbook export'`
returned exit code **0** in **2.14 seconds**, traversed **75 nodes** (52 shown
within its default 2000-token budget), and identified
`services/supplier_order.js:123 buildSupplierOrder()`,
`services/supplier_order.js:189 buildSupplierOrderXlsx()`, and
`tests/xlsx_exporter.test.js` among relevant results.

**Blockers before production adoption**:
1. Resolve the external Codex endpoint's HTTP 403, then repeat both comparison
   runs with the same model/configuration and log their token use.
2. The Graphify Codex project instructions currently reference a root-level
   `graphify-out/`, while the generated graph is in
   `agents/purchasing/graphify-out/`. Adjust the location guidance in the pilot
   only, and ensure the Graphify venv executable is on the pilot Codex PATH.
3. Review/trust hooks before enabling them. Do not merge the draft PR yet.

No changes to the production checkout or services were made during this check.

## 2026-10-11 architecture rollout: completed and pending

Source of truth for live container inventory, AgentControl, current public
VPS state and risk register:
[Live system inventory](../architecture/LIVE_SYSTEM_INVENTORY_2026-10-11.md).

**Completed (Windows host DESKTOP-6NKDIC8, isolated pilot checkout only):**

| Code subtree | Nodes | Edges |
|---|---:|---:|
| agents/purchasing | 2463 | 5530 |
| apps/purchasing-web-backend | 2057 | 4344 |
| agents/arthur-core | 371 | 715 |
| agents/arthur-v1 | 1365 | 2949 |
| agents/business-kpi | 109 | 215 |
| apps/business-kpi-web | 836 | 1827 |
| apps/stores-web | 952 | 2813 |
| apps/vozdooh-web | 131 | 256 |

No external model was called for these AST graphs: use `--code-only` for
mixed-code/doc projects. The counts describe the isolated repository snapshot,
not the live container images or overall cross-project architecture.

Added an **opt-in** quality report CLI with no deploy capabilities:

```powershell
cd C:\AI\AgentToolsPilot20261009\AI-Ecosystem-Sergey
node --test scripts/devtools/agent-quality-gate.test.mjs
node scripts/devtools/agent-quality-gate.mjs --project purchasing --require-graph --require-skills
node scripts/devtools/agent-quality-gate.mjs --project arthur --require-graph --require-skills
node scripts/devtools/agent-quality-gate.mjs --project business-kpi --require-graph --require-skills
node scripts/devtools/agent-quality-gate.mjs --project stores --require-graph --require-skills
node scripts/devtools/agent-quality-gate.mjs --project vozdooh --require-graph --require-skills
```

All five **graph-and-skill readiness** checks and 4 local CLI unit tests passed
on the Windows pilot. This is **not** evidence of code-review quality or faster
model responses. A separate `--run-tests` option runs project Node regression
tests; it refuses to execute outside CI or an `AgentToolsPilot` checkout.
The CI pipeline also tests the CLI and purchasing/backend code with synthetic
fixtures, with no live databases or secrets.

Use `scripts/devtools/launch-amursk-agent-pilot.ps1` to preview the existing
SSH-proxy route without changes; add `-Launch -ExpectedHost DESKTOP-6NKDIC8`
for an **interactive, pilot-only Codex session**. This sets proxy env vars only
for that process and adds the local Graphify venv Scripts directory to PATH.
It does not install global Codex plugins. Never launch it elevated.

**Not yet enabled:** globally installed Ponytail hooks, automatically loaded
Agent Skills across every task, an AgentControl production queue stage, or
self-deploying capabilities. The live working repository contains numerous
uncommitted changes and must not be overwritten or auto-merged.

**Next approval gate:** paired Codex baseline versus Codex with selected skills using the
existing German proxy/tunnel, review of any hook code, then guarded promotion
to one project-scoped development workflow. Do not merge this PR to main or
attach it to the live scheduler before the acceptance criteria are met.

## 2026-10-11: actual Codex-over-tunnel A/B smoke result

The user's **existing** Windows SSH tunnel and proxy on
`127.0.0.1:8443` were used through process-local HTTP(S)/ALL_PROXY
variables. Both invocations of `codex-cli 0.162.1` finished with exit code
0 using `codex exec --ephemeral -s read-only`, in distinct checkouts of
the same pilot branch, against one fixed XLSX code-tracing prompt.

| Metric | Control checkout | Pilot checkout |
|---|---:|---:|
| Elapsed time | 79,689 ms | 60,905 ms |
| Input tokens reported by CLI | 235,005 | 212,681 |
| Cached input tokens | 190,848 | 171,904 |
| Output tokens | 1,418 | 1,368 |
| Exit code | 0 | 0 |
| Included supplier order source and tests | Yes | Yes |

The pilot run was 23.6% faster in this single observation and reported
9.5% fewer input tokens. **Not a causal improvement claim**: one run only,
model ID not captured in the summary, differing caches; native Ponytail
hooks were deliberately disabled, and no evidence was captured that all
installed skills were invoked. Full answer quality was not externally scored.
The optional benchmark script stores only aggregated telemetry locally in
`C:\\AI\\AgentToolsPilot20261009\\comparison\\agent-tools-ab-summary.json`.
The benchmark should be repeated with fixed model/version, multiple trials
and explicit invocation of individual skills before promoting them.

Prior `403` errors occurred in attempts that **did not set up the existing
proxy**. The proxy-enabled benchmark was successful; do not replace the tunnel.

### Hook and production safeguards

In the isolated checkout, restored the repository's normal `AGENTS.md`
after Graphify had appended generic root-level graph path instructions and
disabled the auto-created `.codex/hooks.json` (kept a local disabled copy).
The project-scoped Graphify skill remains available, along with the selected
Agent Skills and Ponytail. No auto-executing plugin hooks run as a side effect.
The main working checkout, Windows scheduled tasks, live AgentControl queues,
Docker containers and data volumes are unchanged.

A safe next deployment is **only** an opt-in development-stage quality gate
called by AgentControl after a task's isolated source checkout is ready.
It must not block ordinary consumer actions or auto-deploy production.

## Owner correction on 2026-10-11: no Kimi deployment

Kimi is **paused by owner decision**, even though the older AgentControl
configuration still exposes it as an enabled secondary worker. This pilot
supports **AgentControl + Codex over the existing tunnel**; it neither
promotes Kimi nor changes the live AgentControl router. The route must be
updated and verified separately before claiming Kimi is disabled.

Do not confuse selected Agent Skills with AI models. The specific names of
newly selected provider models have not yet been verified, so no model names
are invented here. Local Ollama and existing OmniRoute are separate parts of
Arthur's model infrastructure, not substitutes automatically selected by this
pilot.
