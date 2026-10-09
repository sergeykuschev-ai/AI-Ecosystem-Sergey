# Pilot: Ponytail, selected Agent Skills, Graphify (2026-10-09)

## Scope and constraints

Target: the Purchasing Agent in this repository. **No production rollout.**
Do not execute the experiment on stores-web1 or inside Amursk production services.\nThe target machine is the **Amursk Windows development/AI server**, using a\nseparate local pilot profile and disposable checkout. A MacBook is not required.
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

Graphify local CLI and Codex skill registration:

```sh
uv tool install graphifyy
graphify install --project --platform codex
graphify agents/purchasing --no-viz
```

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
