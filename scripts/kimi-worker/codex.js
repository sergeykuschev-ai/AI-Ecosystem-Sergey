'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const config = require('./config');
const sandbox = require('./sandbox');
const { scrub } = require('./logger');

function buildCodexArgs() {
  return [
    '-a', 'never',
    '-s', 'workspace-write',
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--color', 'never',
    '-',
  ];
}

function runCodex(worktreePath, prompt, transcriptPath) {
  return new Promise((resolve) => {
    const args = buildCodexArgs();
    if (!sandbox.isAvailable() && config.sandbox.required) {
      resolve({ ok: false, code: 'sandbox-unavailable', transcriptPath });
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
    logLine(transcriptPath, `$ ${wrapped.command} <sandbox> ${config.codex.command} exec <prompt ${prompt.length} chars>`);
    const child = spawn(wrapped.command, wrapped.args, { cwd: worktreePath, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let timedOut = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { fs.rmSync(env.TMPDIR, { recursive: true, force: true }); } catch {}
      resolve(result);
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
  fs.mkdirSync(require('path').dirname(transcriptPath), { recursive: true });
  fs.appendFileSync(transcriptPath, line.endsWith('\n') ? line : line + '\n');
}

module.exports = { runCodex, buildCodexArgs };
