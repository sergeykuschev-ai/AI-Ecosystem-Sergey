'use strict';

// Regression tests for issue #37: `--agent-file` pointed at the canonical
// scripts/kimi-worker/kimi-agent.md, which lives under ~/Documents and is
// unreadable under the seatbelt profile, so kimi failed with EPERM before
// doing any work. The fix stages a copy inside the task worktree (a
// guaranteed-allowed read path) and points --agent-file only at that copy.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const sandbox = require('../sandbox');
const { buildKimiArgs } = require('../kimi');
const { AGENT_FILE_RELATIVE, stagedAgentPath, stageAgentFile, removeAgentFile } = require('../agentFile');

function makeWorktree() {
  fs.mkdirSync(config.worktreesDir, { recursive: true });
  return fs.mkdtempSync(path.join(config.worktreesDir, 'agent-probe-'));
}

// --- Staging: copy lives inside the worktree, mirrors the canonical file

test('staged agent file is a byte-identical copy inside the worktree', () => {
  const wt = makeWorktree();
  try {
    const staged = stageAgentFile(wt);
    assert.equal(staged, path.join(wt, AGENT_FILE_RELATIVE));
    assert.ok(staged.startsWith(wt + path.sep), 'staged copy must live inside the worktree');
    assert.equal(fs.readFileSync(staged, 'utf8'), fs.readFileSync(config.kimi.agentFile, 'utf8'));
  } finally {
    removeAgentFile(wt);
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('removeAgentFile leaves no trace in the worktree', () => {
  const wt = makeWorktree();
  stageAgentFile(wt);
  removeAgentFile(wt);
  assert.ok(!fs.existsSync(path.join(wt, '.kimi-worker')));
  assert.equal(fs.readdirSync(wt).length, 0);
});

test('re-staging overwrites a leftover copy from a crashed run', () => {
  const wt = makeWorktree();
  try {
    stageAgentFile(wt);
    const staged = stageAgentFile(wt); // must not throw on existing copy
    assert.equal(fs.readFileSync(staged, 'utf8'), fs.readFileSync(config.kimi.agentFile, 'utf8'));
  } finally {
    removeAgentFile(wt);
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

// --- The regression itself: under the sandbox, the staged copy is readable
//     and the canonical path is NOT (this is exactly the issue #37 failure).

test('sandbox can read the staged copy inside the worktree', { skip: !sandbox.isAvailable() }, () => {
  const wt = makeWorktree();
  const { execFileSync } = require('child_process');
  try {
    const staged = stageAgentFile(wt);
    const wrapped = sandbox.wrap(wt, '/bin/cat', [staged]);
    const out = execFileSync(wrapped.command, wrapped.args, { stdio: 'pipe' }).toString();
    assert.equal(out, fs.readFileSync(config.kimi.agentFile, 'utf8'));
  } finally {
    removeAgentFile(wt);
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('sandbox denies reading the canonical agent file outside the worktree (issue #37)', { skip: !sandbox.isAvailable() }, () => {
  const wt = makeWorktree();
  const { execFileSync } = require('child_process');
  try {
    const wrapped = sandbox.wrap(wt, '/bin/cat', [config.kimi.agentFile]);
    let out = '';
    try {
      out = execFileSync(wrapped.command, wrapped.args, { stdio: 'pipe' }).toString();
    } catch {
      out = '';
    }
    assert.equal(out, '', 'canonical agent file must stay unreadable under the sandbox');
  } finally {
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

// --- kimi argv: --agent-file only ever points at the staged worktree copy

test('buildKimiArgs points --agent-file at the given sandbox-readable path', () => {
  const wt = makeWorktree();
  try {
    const staged = stageAgentFile(wt);
    const args = buildKimiArgs(staged, 'prompt text');
    const idx = args.indexOf('--agent-file');
    assert.notEqual(idx, -1);
    assert.equal(args[idx + 1], staged);
    assert.ok(args[idx + 1].startsWith(wt + path.sep), '--agent-file must stay inside the worktree');
    assert.notEqual(args[idx + 1], config.kimi.agentFile, '--agent-file must never point at the canonical file');
  } finally {
    removeAgentFile(wt);
    fs.rmSync(wt, { recursive: true, force: true });
  }
});
