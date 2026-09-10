'use strict';

const { execFile } = require('child_process');
const config = require('./config');

function run(cmd, args, { cwd, timeoutMs, env } = {}) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd, timeout: timeoutMs || config.checkTimeoutMs, maxBuffer: 8 * 1024 * 1024, env },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          code: err ? (err.code === null || err.code === undefined ? 'timeout' : err.code) : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        });
      }
    );
  });
}

function tail(text, maxLines = 40) {
  return text.trim().split('\n').slice(-maxLines).join('\n');
}

async function ensureNodeModules(worktreePath, area, log) {
  const pkgDir = `${worktreePath}/${area.packageDir}`;
  if (await fileExists(`${pkgDir}/node_modules`)) return true;
  log.info(`node_modules missing in ${area.packageDir}, running npm ci ...`);
  const result = await run('npm', ['ci', '--no-audit', '--no-fund'], {
    cwd: pkgDir,
    timeoutMs: config.npmCiTimeoutMs,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      npm_config_cache: `/private/tmp/kimi-npm-ci-${process.pid}`,
    },
  });
  if (!result.ok) {
    log.error(`npm ci failed:\n${tail(result.stderr || result.stdout)}`);
    return false;
  }
  return true;
}

async function fileExists(p) {
  try {
    const { statSync } = require('fs');
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Runs the area's check list. Stops at the first failure. A failed check
// means the worker must NOT commit.
async function runChecks(worktreePath, area, log) {
  const results = [];

  const diffCheck = await run('git', ['diff', '--check'], { cwd: worktreePath, timeoutMs: 60 * 1000 });
  results.push({
    name: 'git diff --check',
    ok: diffCheck.ok,
    output: tail(diffCheck.stderr || diffCheck.stdout),
  });
  if (!diffCheck.ok) return results;

  if (area.checks.some((c) => c.startsWith('npm:'))) {
    if (!(await ensureNodeModules(worktreePath, area, log))) {
      results.push({ name: 'npm ci', ok: false, output: 'npm ci failed; see log' });
      return results;
    }
  }

  for (const check of area.checks) {
    if (check === 'git-diff-check') continue;
    if (check === 'npm:build' && !config.runBuild) {
      log.info('Skipping npm:build (AIKIMI_SKIP_BUILD=1)');
      continue;
    }
    if (!check.startsWith('npm:')) continue;
    const script = check.slice(4);
    log.info(`Running ${check} in ${area.packageDir} ...`);
    const result = await run('npm', ['run', script], {
      cwd: `${worktreePath}/${area.packageDir}`,
    });
    results.push({ name: check, ok: result.ok, output: tail(result.stderr || result.stdout) });
    if (!result.ok) break;
  }

  return results;
}

module.exports = { runChecks, run };
