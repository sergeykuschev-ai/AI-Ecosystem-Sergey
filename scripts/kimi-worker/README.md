# Autonomous AI Worker (Kimi + Codex)

A safe, local worker that turns labelled GitHub Issues into reviewed Pull
Requests using Kimi Code or OpenAI Codex. In `auto` mode it protects the Kimi quota and routes work to Codex when the Kimi reserve is reached. The worker never touches `main`, never merges,
never deploys, and works only inside allowlisted areas of the monorepo.

## Flow

1. Poll open Issues that carry **all** required labels:
   `ai:kimi` (executor permission) + an area label, e.g. `area:stores-web`.
2. Verify idempotency: skip Issues with `ai:pr-open`, an open PR for the
   branch, or a terminal entry in the local state file.
3. Create (or reuse) a dedicated git worktree under `~/.kimi-worker/…` on a
   task branch `ai/kimi-<issue>-<slug>` cut from `origin/main`.
4. In `auto` mode, query Kimi's local read-only OAuth usage endpoint. If every
   quota window has more than the protected reserve (default 10%) left, run
   Kimi; otherwise run Codex. If the quota probe itself fails, prefer Codex so
   Kimi's remaining quota is not burned blindly. Both agents run
   non-interactively under the generated macOS Seatbelt profile. Kimi also
   receives its staged `kimi-agent.md`; Codex runs with `approval=never`, its
   own `workspace-write` sandbox, ephemeral session state, and user config/MCP
   rules disabled. Per-task transcripts are written to the worker log dir.
5. Validate: changed files must stay inside the area's allowed paths; a
   forbidden-path and secret-content scan runs before anything is staged.
6. Run checks (`git diff --check`, `npm run lint`, `npm run typecheck`,
   `npm run build` for stores-web). **If any check fails, nothing is
   committed** and the Issue gets a comment with the reason.
7. On success: commit → `git push -u origin <branch>` →
   `gh pr create --base main` → comment on the Issue → label `ai:pr-open`.
8. Merge and production deploy remain **manual owner approvals**.

## Security model

Isolation is enforced DURING agent execution, not just by post-run checks.
Four independent layers:

1. **OS sandbox (macOS Seatbelt / `sandbox-exec`)** — every Kimi/Codex run is
   wrapped in a generated profile (`sandbox.js`) that:
   - denies **writes everywhere except** the task worktree, `/private/tmp`,
     `~/.kimi-code` / `~/.codex` (agent runtime state) and `/dev` — the main worktree,
     purchasing, business-kpi, other repos, `~/.ssh`, `~/.config`, `/opt`
     and sibling worktrees are unwritable *while an agent runs*;
   - denies **reads** of `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config`
     (contains the `gh` token), `~/Library` (Keychains), `~/Documents`
     (the main clone and every other repo/worktree), and the worker admin
     dir (logs, state, lock) — including through symlinks;
   - makes sibling task worktrees unlistable and unreadable;
   - blocks execution of credential/admin tooling (`security`, `gh`, `ssh`,
     `scp`, `gpg`, `sudo`, `launchctl`).
   If `sandbox-exec` is missing the worker **fails closed** (no agent run);
   `AIKIMI_ALLOW_NO_SANDBOX=1` is the explicit escape hatch.
2. **Agent-level sandbox/policy** — Kimi uses `kimi-agent.md` via `--agent-file`, with a technically
   enforced allowlist: `Read/Grep/Glob/Write/Edit/TodoList/Bash` only. No
   `Agent`/`AgentSwarm` (no sub-agents), no `WebSearch`/`FetchURL` (no
   untrusted fetch), no `Skill`, no cron, no plan-mode tools. The agent is
   bound at session start and outranks any repo-supplied agent file.
   The file passed to `--agent-file` is a byte-identical copy staged inside
   the task worktree by `agentFile.js`; the canonical
   `scripts/kimi-worker/kimi-agent.md` remains the source of truth and stays
   unreadable under the sandbox. The copy is deleted before git status/commit.
   Note: `kimi -p` already runs under the `auto` permission policy; passing
   `--auto`/`--yolo` together with `--prompt` is rejected by the CLI, so the
   worker never adds them. Codex runs with `approval=never`,
   `workspace-write`, `--ephemeral`, `--ignore-user-config` and
   `--ignore-rules`; the worker does not enable Codex web search or MCP.
3. **Post-run gates (before commit)** — changed files must stay inside the
   area's allowed paths; `.env*`, keys, `node_modules`, build outputs and
   `.github/workflows` are rejected by default (the stores-web area has one exact-file exception for `.github/workflows/stores-web-ci.yml`); **symlinks are rejected outright**
   (never followed by the secret scan); staged content is scanned for
   credential-shaped strings; `git diff --check` + lint/typecheck/build must
   pass. Any failure means nothing is committed.
   `npm run build` runs **hermetically**: it inherits neither the worker's
   process environment nor any `.env` (task worktrees have none); it receives
   only `PATH`/`HOME`/npm cache plus the area's fixed, non-secret
   `buildTestEnv` overrides from `config.js` (for stores-web:
   `NEXT_PUBLIC_SITE_URL=https://example.invalid`, `CONTENT_SOURCE=mock`).
   See `tests/build-env.test.js`.
4. **Worker git discipline** — the worker itself only ever fetches, creates
   task worktrees/branches from `origin/main`, commits on the task branch
   and pushes that branch. `reset`/`clean`/`rebase`/`force-push`/`merge` do
   not exist in the code. PRs are created without merge; deploys are manual.

GitHub Issue content is treated as **untrusted data**: it is embedded in the
prompt between explicit delimiters with an untrusted-data warning, is never
interpolated into a shell (the worker spawns processes with argv arrays
only), and branch names are derived from a slug that strips all shell
metacharacters.

### Known residual risks (documented, not hidden)

- **Outbound network is open inside the sandbox.** macOS 26 seatbelt no
  longer accepts hostname filtering for `network-outbound` (only `*` or
  `localhost`), and Kimi needs API access, so a hijacked task could in
  theory exfiltrate what the sandbox can read: worktree content and the
  LLM API key from `~/.kimi-code/config.toml`. Keychain itself is reachable
  via its daemon (not mach-blockable), but `gh`/`security`/`ssh` binaries
  are exec-blocked and `~/.config` is unreadable, so GitHub credentials are
  not directly reachable. Mitigations if this matters: keep issue content
  owner-authored, and/or add an outbound firewall (LuLu / Little Snitch)
  restricted to the API host.
- The lock file is advisory; a determined local same-user process can
  bypass it — out of scope for a single-user Mac worker.

## Setup (owner, one-time)

1. **Create labels on GitHub** (worker state labels are auto-created):
   - `ai:kimi` — permission to execute with Kimi
   - `area:stores-web` — allowed area (more areas can be added in `config.js`)
2. Write the Issue with a clear title/body and both labels.
3. Verify the environment:

   ```bash
   node scripts/kimi-worker/run.js --setup-check
   ```

## Running

```bash
# Dry-run: lists what would happen, zero mutations (default if AIKIMI_DRY_RUN=1)
node scripts/kimi-worker/run.js --dry-run

# Process at most one eligible issue for real
node scripts/kimi-worker/run.js --no-dry-run

# Process a specific issue (still subject to label policy)
node scripts/kimi-worker/run.js --dry-run --issue 25
```

Locking: a PID lock at `~/.kimi-worker-admin/AI-Ecosystem-Sergey/worker.lock`
prevents concurrent workers; stale locks are reclaimed automatically.

Logs: `~/.kimi-worker-admin/AI-Ecosystem-Sergey/logs/` (worker log + per-issue
agent transcripts). Nothing secret is written there.

Tests:

```bash
node --test scripts/kimi-worker/tests/*.test.js
```

## launchd (optional, manual)

A template is provided at
`launchd/com.sergeykuschev.kimi-worker.plist.template` (one issue per run,
every 300 s). It is **not installed by the repo**. After reviewing it:

```bash
scripts/kimi-worker/launchd/install-launchd.sh        # renders + copies the plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.sergeykuschev.kimi-worker.plist
```

Deactivate: `launchctl bootout gui/$(id -u)/com.sergeykuschev.kimi-worker`.

## Configuration

Environment variables (see `config.js` for defaults):

| Variable | Purpose |
|---|---|
| `AIKIMI_REPO` | GitHub repo (`owner/name`) |
| `AIKIMI_DRY_RUN` | `1` forces dry-run |
| `AIKIMI_WORKER_HOME` | override `~/.kimi-worker/AI-Ecosystem-Sergey` (worktrees) |
| `AIKIMI_ADMIN_HOME` | override `~/.kimi-worker-admin/AI-Ecosystem-Sergey` (logs, state, lock, sandbox profiles) |
| `AIKIMI_ALLOW_NO_SANDBOX` | `1` permits running Kimi without the OS sandbox (NOT recommended) |
| `AIKIMI_AGENT_MODE` | `auto` (default), `kimi`, or `codex` |
| `AIKIMI_KIMI_RESERVE_PERCENT` | protected Kimi reserve in every quota window (default 10%) |
| `AIKIMI_KIMI_TIMEOUT_MS` | per-task Kimi timeout (default 30 min) |
| `AIKIMI_CODEX_TIMEOUT_MS` | per-task Codex timeout (default 30 min) |
| `AIKIMI_CODEX_CMD` | Codex CLI path (default `~/.local/bin/codex`) |
| `AIKIMI_SKIP_BUILD` | `1` skips `npm run build` in checks |
| `AIKIMI_REQUIRED_LABEL` | permission label (default `ai:kimi`) |

New areas: add an entry to `config.areas` with `allowedPaths` and `checks`.
If the area's `npm run build` requires non-secret configuration (the worktree
has no `.env`), declare fixed test values in `buildTestEnv` — they are the
only env overrides the build receives.
