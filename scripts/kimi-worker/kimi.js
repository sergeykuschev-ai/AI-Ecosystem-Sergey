'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const sandbox = require('./sandbox');
const { scrub } = require('./logger');

// agentFilePath MUST be a sandbox-readable copy (see agentFile.js): the
// canonical scripts/kimi-worker/kimi-agent.md lives under ~/Documents and is
// unreadable under the seatbelt profile (issue #37).
function buildKimiArgs(agentFilePath, prompt) {
  return [
    '-p', prompt,
    '--agent-file', agentFilePath,
    '--skills-dir', emptySkillsDir(),
    '--output-format', 'text',
  ];
}

// Runs Kimi Code CLI non-interactively (kimi -p) inside the task worktree,
// wrapped in the macOS seatbelt sandbox so filesystem access is bounded
// DURING execution. Never invokes the interactive TUI.
function runKimi(worktreePath, prompt, transcriptPath, agentFilePath) {
  return new Promise((resolve) => {
    if (!agentFilePath) {
      resolve({ ok: false, code: 'missing-agent-file', transcriptPath });
      return;
    }
    const kimiArgs = buildKimiArgs(agentFilePath, prompt);

    if (!sandbox.isAvailable()) {
      if (config.sandbox.required) {
        resolve({ ok: false, code: 'sandbox-unavailable', transcriptPath });
        return;
      }
      logLine(transcriptPath, '[worker] WARNING: sandbox-exec not found; running WITHOUT OS-level isolation');
    }

    const wrapped = sandbox.isAvailable()
      ? sandbox.wrap(worktreePath, config.kimi.command, kimiArgs)
      : { command: config.kimi.command, args: kimiArgs };
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LANG: process.env.LANG || 'en_US.UTF-8',
      TMPDIR: `/private/tmp/kimi-worker-${process.pid}`,
      npm_config_cache: `/private/tmp/kimi-npm-${process.pid}`,
    };
    fs.mkdirSync(env.TMPDIR, { recursive: true });
    logLine(transcriptPath, `$ ${wrapped.command} ${wrapped.args[0] === '-f' ? '-f <sandbox profile> ' : ''}${config.kimi.command} -p <prompt ${prompt.length} chars> --agent-file <worker agent>`);

    const child = spawn(wrapped.command, wrapped.args, { cwd: worktreePath, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 15 * 1000).unref();
    }, config.kimi.timeoutMs);

    child.stdout.on('data', (d) => logLine(transcriptPath, scrub(d.toString())));
    child.stderr.on('data', (d) => logLine(transcriptPath, `[stderr] ${scrub(d.toString())}`));

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: `spawn-error: ${err.message}`, transcriptPath });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      logLine(transcriptPath, `[worker] kimi exited code=${code} timedOut=${timedOut}`);
      cleanupTmp(env);
      resolve({ ok: !timedOut && code === 0, code: timedOut ? 'timeout' : code, transcriptPath });
    });
  });
}

function emptySkillsDir() {
  const dir = path.join(config.adminHome, 'empty-skills');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupTmp(env) {
  for (const key of ['TMPDIR', 'npm_config_cache']) {
    try {
      fs.rmSync(env[key], { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}

function logLine(transcriptPath, line) {
  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
  fs.appendFileSync(transcriptPath, line.endsWith('\n') ? line : line + '\n');
}

module.exports = { runKimi, buildKimiArgs };
