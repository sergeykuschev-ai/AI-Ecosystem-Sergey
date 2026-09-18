'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

// The canonical worker agent instructions (config.kimi.agentFile) live inside
// the repo, which is under ~/Documents — a path the seatbelt profile denies
// for reads. Issue #37: kimi failed with EPERM reading --agent-file because
// it pointed at the canonical file OUTSIDE the sandbox-readable worktree.
//
// Fix: stage a per-task copy INSIDE the task worktree (an explicitly allowed
// read path) and point --agent-file ONLY at that copy. The canonical file
// stays the single source of truth; the copy is refreshed on every run and
// removed before git status/commit, so it can never be committed.
//
// The copy lives at a fixed dot-path so a leftover from a crashed run is
// recognizable and is rejected by the area policy instead of being committed
// silently.
const AGENT_FILE_RELATIVE = path.join('.kimi-worker', 'agent.md');

function stagedAgentPath(worktreePath) {
  return path.join(worktreePath, AGENT_FILE_RELATIVE);
}

function stageAgentFile(worktreePath) {
  const dest = stagedAgentPath(worktreePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(config.kimi.agentFile, dest);
  return dest;
}

function removeAgentFile(worktreePath) {
  fs.rmSync(path.join(worktreePath, '.kimi-worker'), { recursive: true, force: true });
}

module.exports = { AGENT_FILE_RELATIVE, stagedAgentPath, stageAgentFile, removeAgentFile };
