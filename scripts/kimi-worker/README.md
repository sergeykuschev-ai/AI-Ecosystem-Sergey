# Kimi Autonomous Worker (V1)

A safe, local worker that turns labelled GitHub Issues into reviewed Pull
Requests using Kimi Code CLI. The worker never touches `main`, never merges,
never deploys, and works only inside allowlisted areas of the monorepo.

## Flow

1. Poll open Issues that carry **all** required labels:
   `ai:kimi` (executor permission) + an area label, e.g. `area:stores-web`.
2. Verify idempotency: skip Issues with `ai:pr-open`, an open PR for the
   branch, or a terminal entry in the local state file.
3. Create (or reuse) a dedicated git worktree under `~/.kimi-worker/…` on a
   task branch `ai/kimi-<issue>-<slug>` cut from `origin/main`.
4. Run `kimi -p "<issue + rules>" --agent-file <copy>` under a macOS
   Seatbelt sandbox (`sandbox-exec`), non-interactively, inside the worktree
   (transcript in the logs directory). See "Security model" below. The
   `--agent-file` value is a per-task copy of `kimi-agent.md` staged inside
   the worktree (`agentFile.js`): the canonical file lives under
   `~/Documents`, which the sandbox denies for reads (issue #37), so the copy
   is the only sandbox-readable form. It is removed before `git status`, so
   it can never be committed.
5. Validate: changed files must stay inside the area's allowed paths; a
   forbidden-path and secret-content scan runs before anything is staged.
6. Run checks (`git diff --check`, `npm run lint`, `npm run typecheck`,
   `npm run build` for stores-web). **If any check fails, nothing is
   committed** and the Issue gets a comment with the reason.
7. On success: commit → `git push -u origin <branch>` →
   `gh pr create --base main` → comment on the Issue → label `ai:pr-open`.
8. Merge and production deploy remain **manual owner approvals**.

## Security model

Isolation is enforced DURING Kimi execution, not just by post-run checks.
Four independent layers:

1. **OS sandbox (macOS Seatbelt / `sandbox-exec`)** — every `kimi -p` run is
   wrapped in a generated profile (`sandbox.js`) that:
   - denies **writes everywhere except** the task worktree, `/private/tmp`,
     `~/.kimi-code` (Kimi session state) and `/dev` — the main worktree,
     purchasing, business-kpi, other repos, `~/.ssh`, `~/.config`, `/opt`
     and sibling worktrees are unwritable *while Kimi runs*;
   - denies **reads** of `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config`
     (contains the `gh` token), `~/Library` (Keychains), `~/Documents`
     (the main clone and every other repo/worktree), and the worker admin
     dir (logs, state, lock) — including through symlinks;
   - makes sibling task worktrees unlistable and unreadable;
   - blocks execution of credential/admin tooling (`security`, `gh`, `ssh`,
     `scp`, `gpg`, `sudo`, `launchctl`).
   If `sandbox-exec` is missing the worker **fails closed** (no Kimi run);
   `AIKIMI_ALLOW_NO_SANDBOX=1` is the explicit escape hatch.
2. **Kimi tool policy (`kimi-agent.md` via `--agent-file`)** — technically
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
   worker never adds them.
3. **Post-run gates (before commit)** — changed files must stay inside the
   area's allowed paths; `.env*`, keys, `node_modules`, build outputs and
   `.github/workflows` are rejected; **symlinks are rejected outright**
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
Kimi transcripts). Nothing secret is written there.

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
| `AIKIMI_KIMI_TIMEOUT_MS` | per-task Kimi timeout (default 30 min) |
| `AIKIMI_SKIP_BUILD` | `1` skips `npm run build` in checks |
| `AIKIMI_REQUIRED_LABEL` | permission label (default `ai:kimi`) |

New areas: add an entry to `config.areas` with `allowedPaths` and `checks`.
If the area's `npm run build` requires non-secret configuration (the worktree
has no `.env`), declare fixed test values in `buildTestEnv` — they are the
only env overrides the build receives.
