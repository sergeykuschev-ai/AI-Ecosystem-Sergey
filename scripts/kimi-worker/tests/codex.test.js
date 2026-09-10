'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildCodexArgs } = require('../codex');

test('Codex worker invocation is non-interactive, ephemeral and sandboxed', () => {
  const args = buildCodexArgs();
  assert.deepEqual(args.slice(0, 5), ['-a', 'never', '-s', 'workspace-write', 'exec']);
  assert.ok(args.includes('--ephemeral'));
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('--ignore-rules'));
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.equal(args.at(-1), '-');
});
