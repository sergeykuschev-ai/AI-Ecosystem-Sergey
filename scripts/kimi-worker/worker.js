'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const github = require('./github');
const safety = require('./safety');
const { buildPrompt } = require('./prompts');
const { runChecks, run } = require('./checks');
const { runKimi } = require('./kimi');
const { createLogger } = require('./logger');
const { stageAgentFile, removeAgentFile } = require('./agentFile');

// ---------------------------------------------------------------------------
// Git helpers (task-branch only; reset/clean/rebase/force-push never appear)
// ---------------------------------------------------------------------------

async function git(args, cwd, timeoutMs) {
  const result = await run('git', args, { cwd, timeoutMs: timeoutMs || 120 * 1000 });
  if (!result.ok) {
    throw new Error(`git ${args.join(' ')} failed (in ${cwd}): ${(result.stderr || result.stdout).trim().split('\n').slice(0, 5).join(' | ')}`);
  }
  return result.stdout.trim();
}

// The "main" clone (branch main) is the anchor for fetching and worktrees.
// This worktree never gets checked out or modified by the worker.
async function findMainWorktree() {
  const out = await git(['worktree', 'list', '--porcelain'], process.cwd());
  const blocks = out.split('\n\n').filter(Boolean);
  for (const block of blocks) {
    const lines = block.split('\n');
    const worktree = lines.find((l) => l.startsWith('worktree '))?.slice(9);
    const branch = lines.find((l) => l.startsWith('branch '))?.slice(7);
    if (branch === 'refs/heads/main' && worktree) return worktree;
  }
  throw new Error('Could not find the main worktree (no worktree on branch main). Set it up first.');
}

// ---------------------------------------------------------------------------
// State file: local idempotency record
// ---------------------------------------------------------------------------

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(config.statePath, 'utf8'));
  } catch {
    return { processed: {} };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(config.statePath), { recursive: true });
  fs.writeFileSync(config.statePath, JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
// Issue eligibility
// ---------------------------------------------------------------------------

function areaForIssue(issue) {
  const labels = (issue.labels || []).map((l) => l.name);
  const areas = labels.filter((l) => config.areas[l]);
  if (areas.length === 0) return { error: `no allowed area label (${Object.keys(config.areas).join(', ')})` };
  if (areas.length > 1) return { error: `multiple area labels: ${areas.join(', ')}` };
  return { area: config.areas[areas[0]], areaLabel: areas[0] };
}

async function alreadyHandled(issue, branch, state, log) {
  const labels = (issue.labels || []).map((l) => l.name);
  if (labels.includes(config.stateLabels.done)) return `label ${config.stateLabels.done} present`;
  const recorded = state.processed[issue.number];
  if (recorded && recorded.prUrl) return `state file records ${recorded.prUrl}`;
  const pr = await github.findOpenPrForBranch(config.repo, branch).catch(() => null);
  if (pr) return `open PR already exists: ${pr.url}`;
  if (recorded && recorded.terminal) return `state file records terminal outcome: ${recorded.outcome}`;
  return null;
}

// ---------------------------------------------------------------------------
// Worktree management (all worktrees live outside the repo, under ~/.kimi-worker)
// ---------------------------------------------------------------------------

async function prepareWorktree(mainRoot, branch, log) {
  fs.mkdirSync(config.worktreesDir, { recursive: true });
  const dirName = branch.replace(/\//g, '-');
  const wtPath = path.join(config.worktreesDir, dirName);

  await git(['fetch', 'origin', 'main'], mainRoot, 300 * 1000);

  if (fs.existsSync(path.join(wtPath, '.git'))) {
    log.info(`Reusing existing worktree ${wtPath}`);
    await git(['fetch', 'origin', 'main'], wtPath, 300 * 1000);
    const merge = await run('git', ['merge', '--ff-only', 'origin/main'], { cwd: wtPath });
    if (!merge.ok) {
      throw new Error(`Task branch diverged from origin/main and cannot fast-forward. Manual resolution required in ${wtPath}.`);
    }
    return wtPath;
  }

  const branchExists = (await run('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: mainRoot })).ok;
  if (branchExists) {
    log.info(`Branch ${branch} exists; checking it out in a new worktree`);
    await git(['worktree', 'add', wtPath, branch], mainRoot);
    await git(['merge', '--ff-only', 'origin/main'], wtPath);
  } else {
    log.info(`Creating branch ${branch} from origin/main`);
    await git(['worktree', 'add', wtPath, '-b', branch, 'origin/main'], mainRoot);
  }
  return wtPath;
}

// ---------------------------------------------------------------------------
// One issue, end to end
// ---------------------------------------------------------------------------

async function processIssue(issueNumber, log, { dryRun }) {
  const issue = await github.getIssue(config.repo, issueNumber);
  const state = loadState();
  const branch = safety.branchNameForIssue(issue);
  safety.assertSafeBranchName(branch);

  const { area, areaLabel, error: areaError } = areaForIssue(issue);
  if (areaError) {
    log.warn(`Issue #${issueNumber}: ${areaError}. Skipping.`);
    return { status: 'skipped', reason: areaError };
  }

  const handled = await alreadyHandled(issue, branch, state, log);
  if (handled) {
    log.info(`Issue #${issueNumber}: already handled (${handled}). Skipping.`);
    return { status: 'skipped', reason: handled };
  }

  const mainRoot = await findMainWorktree();
  log.info(`Issue #${issueNumber}: "${issue.title}" [${areaLabel}] -> branch ${branch}`);
  log.info(`Main clone: ${mainRoot}`);

  if (dryRun) {
    log.info(`[dry-run] would: mark processing, fetch origin/main, create/reuse worktree, run kimi -p,`);
    log.info(`[dry-run]   validate files against ${area.allowedPaths.join(', ')}, run checks (${area.checks.join(', ')}),`);
    log.info(`[dry-run]   commit, push ${branch}, open PR to main, comment on issue.`);
    return { status: 'dry-run', branch };
  }

  await github.ensureLabel(config.repo, config.stateLabels.processing, 'FBCA04', 'Kimi worker: task is being processed');
  await github.ensureLabel(config.repo, config.stateLabels.done, '0E8A16', 'Kimi worker: PR opened, awaiting owner review');
  await github.addLabel(config.repo, issueNumber, config.stateLabels.processing);

  const wtPath = await prepareWorktree(mainRoot, branch, log);

  try {
    const prompt = buildPrompt(issue, area, area.checks);
    const transcriptPath = path.join(config.logsDir, `kimi-issue-${issueNumber}.log`);
    log.info(`Running kimi non-interactively; transcript: ${transcriptPath}`);
    // The canonical agent file is unreadable under the sandbox (it lives in
    // ~/Documents). Stage a copy inside the worktree — the only read path the
    // profile guarantees — and remove it before git status/commit.
    const agentFileCopy = stageAgentFile(wtPath);
    let kimiResult;
    try {
      kimiResult = await runKimi(wtPath, prompt, transcriptPath, agentFileCopy);
    } finally {
      removeAgentFile(wtPath);
    }
    if (!kimiResult.ok) {
      return finishWithFailure({ issueNumber, branch, state, log, wtPath },
        `Kimi exited with code ${kimiResult.code}. See transcript ${transcriptPath}.`);
    }

    const statusOut = await git(['status', '--porcelain=v1'], wtPath);
    const changedFiles = statusOut ? statusOut.split('\n').map((l) => l.slice(3)) : [];
    if (changedFiles.length === 0) {
      return finishWithFailure({ issueNumber, branch, state, log, wtPath },
        'Kimi finished but produced no changes.', { terminal: true, outcome: 'no-changes' });
    }
    log.info(`Changed files (${changedFiles.length}):\n  ${changedFiles.join('\n  ')}`);

    const violations = safety.validateChangedFiles(changedFiles, area);
    if (violations.length > 0) {
      return finishWithFailure({ issueNumber, branch, state, log, wtPath },
        `Changed files violate area policy:\n${violations.map((v) => '  - ' + v).join('\n')}`, { terminal: true, outcome: 'policy-violation' });
    }

    const symlinkViolations = safety.findSymlinkViolations(wtPath, changedFiles);
    if (symlinkViolations.length > 0) {
      return finishWithFailure({ issueNumber, branch, state, log, wtPath },
        `Symlinks are not allowed:\n${symlinkViolations.map((v) => '  - ' + v).join('\n')}`, { terminal: true, outcome: 'policy-violation' });
    }

    const secretFindings = safety.scanFilesForSecrets(wtPath, changedFiles);
    if (secretFindings.length > 0) {
      return finishWithFailure({ issueNumber, branch, state, log, wtPath },
        `Pre-commit secret scan failed:\n${secretFindings.map((f) => '  - ' + f).join('\n')}`, { terminal: true, outcome: 'secret-scan-failed' });
    }

    log.info('Running validation checks ...');
    const checkResults = await runChecks(wtPath, area, log);
    const failed = checkResults.filter((r) => !r.ok);
    if (failed.length > 0) {
      const summary = checkResults.map((r) => `- ${r.name}: ${r.ok ? 'PASS' : 'FAIL'}`).join('\n');
      return finishWithFailure({ issueNumber, branch, state, log, wtPath },
        `Validation failed, changes NOT committed:\n${summary}\n\n${failed[0].name} output (tail):\n\`\`\`\n${failed[0].output}\n\`\`\``);
    }

    await git(['add', '-A'], wtPath);
    const staged = (await git(['diff', '--cached', '--name-only'], wtPath)).split('\n').filter(Boolean);
    const stagedViolations = safety.validateChangedFiles(staged, area);
    if (stagedViolations.length > 0) {
      throw new Error(`Staged file set drifted from validated set: ${stagedViolations.join('; ')}`);
    }

    const commitTitle = `feat(${area.name}): ${issue.title} (issue #${issueNumber})`;
    await git(['commit', '-m', commitTitle], wtPath);
    log.info(`Committed: ${commitTitle}`);

    await git(['push', '-u', 'origin', branch], wtPath, 300 * 1000);
    log.info(`Pushed ${branch}`);

    const checksSummary = checkResults.map((r) => `- ${r.name}: PASS`).join('\n');
    const prBody = [
      `## Summary`,
      `Automated by Kimi worker for issue #${issueNumber}.`,
      ``,
      `Closes #${issueNumber}`,
      ``,
      `### Changed files`,
      ...changedFiles.map((f) => `- ${f}`),
      ``,
      `### Checks performed`,
      checksSummary,
      `- Pre-commit secret scan: PASS`,
      ``,
      `_Merge and production deploy require separate owner approval._`,
    ].join('\n');

    const prUrl = await github.createPr(config.repo, { branch, title: commitTitle, body: prBody });
    log.info(`PR created: ${prUrl}`);

    await github.comment(config.repo, issueNumber, [
      `🤖 Kimi worker завершил задачу.`,
      ``,
      `PR: ${prUrl}`,
      ``,
      `Изменено файлов: ${changedFiles.length} (только \`${area.allowedPaths.join('`, `')}\`)`,
      `Проверки: ${checkResults.map((r) => r.name).join(', ')} — все PASS`,
      ``,
      `Merge — только после вашего review; production deploy — отдельным ручным approval.`,
    ].join('\n'));

    await github.addLabel(config.repo, issueNumber, config.stateLabels.done);
    await github.removeLabel(config.repo, issueNumber, config.stateLabels.processing).catch(() => {});

    state.processed[issueNumber] = { prUrl, branch, finishedAt: new Date().toISOString(), outcome: 'pr-open' };
    saveState(state);

    return { status: 'done', branch, prUrl };
  } catch (err) {
    await github.removeLabel(config.repo, issueNumber, config.stateLabels.processing).catch(() => {});
    state.processed[issueNumber] = { branch, finishedAt: new Date().toISOString(), terminal: true, outcome: 'worker-error', error: String(err.message).slice(0, 300) };
    saveState(state);
    throw err;
  }
}

async function finishWithFailure(ctx, reason, { terminal = false, outcome = 'failed' } = {}) {
  const { issueNumber, branch, state, log } = ctx;
  log.warn(`Issue #${issueNumber}: ${reason}`);
  await github.comment(config.repo, issueNumber,
    `🤖 Kimi worker НЕ смог завершить задачу (изменения не закоммичены).\n\nПричина: ${reason}\n\nIssue возвращён в очередь${terminal ? ' (повторная автоматическая обработка отключена, требуется вмешательство владельца)' : ''}.`
  ).catch((err) => log.warn(`Could not comment on issue: ${err.message}`));
  await github.removeLabel(config.repo, issueNumber, config.stateLabels.processing).catch(() => {});
  state.processed[issueNumber] = { branch, finishedAt: new Date().toISOString(), terminal, outcome };
  saveState(state);
  return { status: 'failed', reason, terminal };
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

async function setupCheck(log) {
  const report = [];
  const ok = (name, detail) => { report.push(`  ${detail ? '✓' : '✗'} ${name}${detail ? `: ${detail}` : ''}`); return Boolean(detail); };
  let allOk = true;

  const ghAuth = await run('gh', ['auth', 'status'], {});
  allOk &= ok('gh authenticated', ghAuth.ok ? 'yes (account verified, token not printed)' : '');
  if (ghAuth.ok) {
    const kimiVer = await run(config.kimi.command, ['--version'], {});
    allOk &= ok('kimi CLI', kimiVer.ok ? kimiVer.stdout.split('\n')[0] : '');
  }
  const sandbox = require('./sandbox');
  const sandboxOk = sandbox.isAvailable();
  allOk &= ok('sandbox-exec (OS isolation during Kimi runs)', sandboxOk ? 'available' : '');
  allOk &= ok('worker agent file', fs.existsSync(config.kimi.agentFile) ? path.basename(config.kimi.agentFile) : '');
  if (sandboxOk) {
    const canary = require('os').tmpdir() + `/kimi-sandbox-canary-${process.pid}`;
    const wtProbe = path.join(config.worktreesDir, 'setup-probe');
    fs.mkdirSync(wtProbe, { recursive: true });
    const probe = sandbox.wrap(wtProbe, '/usr/bin/touch', [canary]);
    const probeResult = await run(probe.command, probe.args, {});
    fs.rmSync(canary, { force: true });
    fs.rmdirSync(wtProbe);
    allOk &= ok('sandbox denies writes outside worktree', probeResult.ok === false ? 'confirmed (canary refused)' : '');
  }
  try {
    const mainRoot = await findMainWorktree();
    allOk &= ok('main worktree', mainRoot);
  } catch (err) {
    allOk = false; report.push(`  ✗ main worktree: ${err.message}`);
  }
  const labels = await github.listLabels(config.repo).catch(() => '');
  for (const l of [config.requiredLabel, ...Object.keys(config.areas)]) {
    report.push(`  ${labels.includes(l) ? '✓' : '✗'} label "${l}" ${labels.includes(l) ? 'exists' : 'MISSING — create it on GitHub or the worker will find no tasks'}`);
  }
  report.push(`  ${fs.existsSync(config.workerHome) ? '✓' : '✗'} worker home: ${config.workerHome} (created on first real run)`);
  report.push(`  dry-run mode: ${config.dryRun ? 'ON (no GitHub or git mutations)' : 'OFF'}`);
  log.info(`Setup check:\n${report.join('\n')}`);
  return Boolean(allOk);
}

async function runOnce(log, { dryRun } = {}) {
  const effectiveDryRun = dryRun !== undefined ? dryRun : config.dryRun;

  if (!effectiveDryRun) {
    await github.ensureLabel(config.repo, config.stateLabels.processing, 'FBCA04', 'Kimi worker: task is being processed');
    await github.ensureLabel(config.repo, config.stateLabels.done, '0E8A16', 'Kimi worker: PR opened, awaiting owner review');
  }

  const issues = await github.listEligibleIssues(config.repo, config.requiredLabel);
  log.info(`Found ${issues.length} open issue(s) with label "${config.requiredLabel}".`);

  for (const issue of issues.sort((a, b) => a.number - b.number)) {
    const result = await processIssue(issue.number, log, { dryRun: effectiveDryRun }).catch((err) => {
      log.error(`Issue #${issue.number} failed with error: ${err.message}`);
      return { status: 'error', reason: err.message };
    });
    if (result.status === 'done' || result.status === 'dry-run') return result;
  }
  log.info('No eligible issues to process.');
  return { status: 'idle' };
}

module.exports = { runOnce, processIssue, setupCheck };
