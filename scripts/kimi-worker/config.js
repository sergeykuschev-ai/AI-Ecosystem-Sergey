'use strict';

const path = require('path');
const os = require('os');

const HOME = os.homedir();

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const REPO_SLUG = 'AI-Ecosystem-Sergey';
const WORKER_HOME = process.env.AIKIMI_WORKER_HOME || path.join(HOME, '.kimi-worker', REPO_SLUG);
// Logs, state, lock and sandbox profiles live OUTSIDE the worktrees tree so
// the sandbox can deny the whole admin dir without breaking the worktree
// ancestor chain (kqueue watchers and getcwd need to traverse it).
const ADMIN_HOME = process.env.AIKIMI_ADMIN_HOME || path.join(HOME, '.kimi-worker-admin', REPO_SLUG);

const config = {
  repo: process.env.AIKIMI_REPO || 'sergeykuschev-ai/AI-Ecosystem-Sergey',

  // Label policy: an issue is eligible only if it has ALL required labels.
  requiredLabel: process.env.AIKIMI_REQUIRED_LABEL || 'ai:kimi',

  // Worker-owned state labels (auto-created, never processed again).
  stateLabels: {
    processing: process.env.AIKIMI_PROCESSING_LABEL || 'ai:processing',
    done: process.env.AIKIMI_DONE_LABEL || 'ai:pr-open',
  },

  // Areas an issue may touch. Key = required label, value = policy.
  // The worker refuses to stage any file outside allowedPaths.
  areas: {
    'area:stores-web': {
      name: 'stores-web',
      allowedPaths: ['apps/stores-web/'],
      checks: ['git-diff-check', 'npm:lint', 'npm:typecheck', 'npm:build'],
      packageDir: 'apps/stores-web',
      // Fixed, non-secret test values for `npm run build` in the validation
      // worktree (issue #37: build failed with "NEXT_PUBLIC_SITE_URL or
      // SITE_URL must be configured" because the worktree deliberately has
      // no .env). These are the ONLY env overrides the build receives; they
      // must never be sourced from .env, the process environment, or any
      // production value.
      buildTestEnv: Object.freeze({
        NEXT_PUBLIC_SITE_URL: 'https://example.invalid',
        CONTENT_SOURCE: 'mock',
      }),
    },
  },

  // Files that must never be committed, regardless of area.
  forbiddenPathPatterns: [
    /(^|\/)\.env(\.|$)/,
    /(^|\/)\.npmrc$/,
    /\.(pem|key|p12|pfx|keystore|crt)$/,
    /(^|\/)id_rsa/,
    /(^|\/)node_modules\//,
    /(^|\/)\.next\//,
    /(^|\/)(dist|build|out)\//,
    /(^|\/)\.ssh\//,
    /(^|\/)\.aws\//,
    /(^|\/)\.kube\//,
    /(^|\/)secrets?\./i,
    /(^|\/)credentials?\.(json|ya?ml)$/i,
    /(^|\/)\.github\/workflows\//,
  ],

  // Content heuristics for the pre-commit secret scan.
  secretPatterns: [
    { name: 'github-token', re: /gh[pousr]_[A-Za-z0-9]{20,}/ },
    { name: 'github-pat', re: /github_pat_[A-Za-z0-9_]{20,}/ },
    { name: 'openai-sk', re: /sk-[A-Za-z0-9]{16,}/ },
    { name: 'google-api-key', re: /AIza[0-9A-Za-z_-]{20,}/ },
    { name: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/ },
    { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    { name: 'generic-secret-assignment', re: /(api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*["']?[A-Za-z0-9_\-\/+=]{24,}["']?/i },
  ],
  secretScanMaxFileBytes: 1024 * 1024,

  kimi: {
    command: process.env.AIKIMI_KIMI_CMD || 'kimi',
    timeoutMs: int(process.env.AIKIMI_KIMI_TIMEOUT_MS, 30 * 60 * 1000),
    // NOTE: `kimi -p` (print mode) already runs under the `auto` permission
    // policy and REJECTS combining --prompt with --auto/--yolo (docs: kimi
    // command reference). Never add those flags here.
    agentFile: path.join(__dirname, 'kimi-agent.md'),
  },

  sandbox: {
    // Fail closed when sandbox-exec is unavailable. Escape hatch is explicit.
    required: !bool(process.env.AIKIMI_ALLOW_NO_SANDBOX, false),
    // Hostname-based egress filtering is not supported by seatbelt on modern
    // macOS (remote tcp accepts only * or localhost), so outbound network
    // stays open. See README "Security model" for the residual risk.
    readDenySubpaths: [
      path.join(HOME, '.ssh'),
      path.join(HOME, '.aws'),
      path.join(HOME, '.gnupg'),
      path.join(HOME, '.config'), // gh hosts.yml with token
      path.join(HOME, 'Library'), // Keychains and app data
      path.join(HOME, 'Documents'), // main clone + other repos/worktrees
    ],
    execDenyBinaries: [
      '/usr/bin/security', // keychain CLI (keychain itself is not mach-blockable)
      '/opt/homebrew/bin/gh',
      '/usr/bin/ssh', '/usr/bin/scp', '/usr/bin/sftp',
      '/usr/bin/gpg', '/opt/homebrew/bin/gpg',
      '/usr/bin/sudo',
      '/bin/launchctl', '/usr/bin/launchctl',
      // git credential helpers: the last CLI path into the keychain
      '/usr/libexec/git-core/git-credential-osxkeychain',
      '/usr/bin/git-credential-osxkeychain',
      '/opt/homebrew/bin/git-credential-osxkeychain',
      '/usr/local/bin/git-credential-manager',
    ],
  },

  // Per-check timeouts.
  checkTimeoutMs: int(process.env.AIKIMI_CHECK_TIMEOUT_MS, 10 * 60 * 1000),
  npmCiTimeoutMs: int(process.env.AIKIMI_NPM_CI_TIMEOUT_MS, 10 * 60 * 1000),

  workerHome: WORKER_HOME,
  worktreesDir: path.join(WORKER_HOME, 'worktrees'),
  adminHome: ADMIN_HOME,
  logsDir: path.join(ADMIN_HOME, 'logs'),
  lockPath: path.join(ADMIN_HOME, 'worker.lock'),
  statePath: path.join(ADMIN_HOME, 'state.json'),
  sandboxDir: path.join(ADMIN_HOME, 'sandbox'),

  branchPrefix: 'ai/kimi-',
  dryRun: bool(process.env.AIKIMI_DRY_RUN, false),
  runBuild: !bool(process.env.AIKIMI_SKIP_BUILD, false),
};

module.exports = config;
