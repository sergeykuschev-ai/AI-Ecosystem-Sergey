'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const {
  buildCodexArgs,
  stashGitPointer,
  restoreGitPointer,
  recoverGitPointer,
  gitPointerBackupPath,
} = require('../codex');

test('Codex worker invocation uses the outer sandbox and skips git discovery', () => {
  const args = buildCodexArgs();
  assert.deepEqual(args.slice(0, 5), ['-a', 'never', '-s', 'danger-full-access', 'exec']);
  assert.ok(args.includes('--skip-git-repo-check'));
  assert.ok(args.includes('--ephemeral'));
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('--ignore-rules'));
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.equal(args.at(-1), '-');
});

test('Codex hides and restores a git worktree pointer', () => {
  fs.mkdirSync(config.worktreesDir, { recursive: true });
  const wt = fs.mkdtempSync(path.join(config.worktreesDir, 'codex-git-pointer-'));
  const gitPath = path.join(wt, '.git');
  const pointer = 'gitdir: /denied/main/.git/worktrees/example\n';
  fs.writeFileSync(gitPath, pointer);
  try {
    const stash = stashGitPointer(wt);
    assert.ok(stash);
    assert.ok(!fs.existsSync(gitPath));
    assert.ok(fs.existsSync(gitPointerBackupPath(wt)));
    restoreGitPointer(stash);
    assert.equal(fs.readFileSync(gitPath, 'utf8'), pointer);
    assert.ok(!fs.existsSync(gitPointerBackupPath(wt)));
  } finally {
    fs.rmSync(gitPointerBackupPath(wt), { force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('stale git pointer backup is recovered after worker interruption', () => {
  fs.mkdirSync(config.worktreesDir, { recursive: true });
  const wt = fs.mkdtempSync(path.join(config.worktreesDir, 'codex-git-recover-'));
  const gitPath = path.join(wt, '.git');
  fs.writeFileSync(gitPath, 'gitdir: /denied/example\n');
  try {
    const stash = stashGitPointer(wt);
    assert.ok(!fs.existsSync(gitPath));
    assert.equal(recoverGitPointer(wt), true);
    assert.ok(fs.existsSync(gitPath));
    assert.ok(!fs.existsSync(stash.backupPath));
  } finally {
    fs.rmSync(gitPointerBackupPath(wt), { force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});
