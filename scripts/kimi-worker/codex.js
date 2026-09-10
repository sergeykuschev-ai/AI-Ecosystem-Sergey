'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const sandbox = require('./sandbox');
const { scrub } = require('./logger');

function buildCodexArgs() {
  return [
    '-a', 'never',
    // Codex's own macOS workspace sandbox cannot be nested inside our Seatbelt
    // profile. The worker supplies the stronger outer sandbox instead.
    '-s', 'danger-full-access',
    'exec',
    '--skip-git-repo-check',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--color', 'never',
    '-',
  ];
}

function gitPointerBackupPath(worktreePath) {
  return path.join(config.adminHome, 'git-pointers', `${path.basename(worktreePath)}.git`);
}

function recoverGitPointer(worktreePath) {
  const gitPath = path.join(worktreePath, '.git');
  const backupPath = gitPointerBackupPath(worktreePath);
  if (!fs.existsSync(gitPath) && fs.existsSync(backupPath)) {
    fs.mkdirSync(path.dirname(gitPath), { recursive: true });
    fs.renameSync(backupPath, gitPath);
    return true;
  }
  return false;
}

function stashGitPointer(worktreePath) {
  recoverGitPointer(worktreePath);
  const gitPath = path.join(worktreePath, '.git');
  if (!fs.existsSync(gitPath)) return null;
  const stat = fs.lstatSync(gitPath);
  if (!stat.isFile()) throw new Error(`Expected worktree .git pointer file at ${gitPath}`);
  const backupPath = gitPointerBackupPath(worktreePath);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  if (fs.existsSync(backupPath)) throw new Error(`Stale Codex git-pointer backup exists: ${backupPath}`);
  fs.renameSync(gitPath, backupPath);
  return { gitPath, backupPath };
}

function restoreGitPointer(stash) {
  if (!stash) return;
  // Any .git created by the agent while the real pointer was hidden is
  // unauthorized task output. Remove it before restoring the known pointer.
  if (fs.existsSync(stash.gitPath)) fs.rmSync(stash.gitPath, { recursive: true, force: true });
  if (!fs.existsSync(stash.backupPath)) throw new Error(`Codex git-pointer backup missing: ${stash.backupPath}`);
  fs.renameSync(stash.backupPath, stash.gitPath);
}

function runCodex(worktreePath, prompt, transcriptPath) {
  return new Promise((resolve) => {
    const args = buildCodexArgs();
    if (!sandbox.isAvailable() && config.sandbox.required) {
      resolve({ ok: false, code: 'sandbox-unavailable', transcriptPath });
      return;
    }

    let pointerStash;
    try {
      pointerStash = stashGitPointer(worktreePath);
    } catch (err) {
      resolve({ ok: false, code: `git-pointer-stash-error: ${err.message}`, transcriptPath });
      return;
    }

    const wrapped = sandbox.isAvailable()
      ? sandbox.wrap(worktreePath, config.codex.command, args)
      : { command: config.codex.command, args };
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LANG: process.env.LANG || 'en_US.UTF-8',
      TMPDIR: `/private/tmp/codex-worker-${process.pid}`,
    };
    fs.mkdirSync(env.TMPDIR, { recursive: true });
    logLine(transcriptPath, `$ ${wrapped.command} <outer sandbox> ${config.codex.command} exec <prompt ${prompt.length} chars>`);
    const child = spawn(wrapped.command, wrapped.args, { cwd: worktreePath, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let timedOut = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      let restoreError = null;
      try { restoreGitPointer(pointerStash); } catch (err) { restoreError = err; }
      try { fs.rmSync(env.TMPDIR, { recursive: true, force: true }); } catch {}
      if (restoreError) {
        resolve({ ok: false, code: `git-pointer-restore-error: ${restoreError.message}`, transcriptPath });
      } else {
        resolve(result);
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 15 * 1000).unref();
    }, config.codex.timeoutMs);
    child.stdout.on('data', (d) => logLine(transcriptPath, scrub(d.toString())));
    child.stderr.on('data', (d) => logLine(transcriptPath, `[stderr] ${scrub(d.toString())}`));
    child.on('error', (err) => {
      clearTimeout(timer);
      finish({ ok: false, code: `spawn-error: ${err.message}`, transcriptPath });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      logLine(transcriptPath, `[worker] codex exited code=${code} timedOut=${timedOut}`);
      finish({ ok: !timedOut && code === 0, code: timedOut ? 'timeout' : code, transcriptPath });
    });
    child.stdin.end(prompt);
  });
}

function logLine(transcriptPath, line) {
  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
  fs.appendFileSync(transcriptPath, line.endsWith('\n') ? line : line + '\n');
}

module.exports = {
  runCodex,
  buildCodexArgs,
  recoverGitPointer,
  stashGitPointer,
  restoreGitPointer,
  gitPointerBackupPath,
};
