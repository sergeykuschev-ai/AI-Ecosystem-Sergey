'use strict';

// Regression tests for the issue #37 follow-up: `git status --porcelain=v1`
// lines are "XY PATH" (3 chars of prefix). The worker's trim()ing git() helper
// ate the leading space of unstaged lines (" M apps/..."), shifting the path
// left so slice(3) dropped its first letter: "apps/stores-web/README.md"
// became "pps/stores-web/README.md" and was rejected by the area policy even
// though Kimi changed exactly the allowed file.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const safety = require('../safety');
const { run } = require('../checks');

const STORES_AREA = config.areas['area:stores-web'];

// --- 1. The exact issue #37 scenario: unstaged change, leading status space

test('unstaged " M" line keeps the first letter of the path (issue #37 regression)', () => {
  // raw stdout of `git status --porcelain=v1` for one unstaged file, with the
  // trailing newline git actually emits
  const out = ' M apps/stores-web/README.md\n';
  assert.deepEqual(safety.parsePorcelainPaths(out), ['apps/stores-web/README.md']);
});

test('single letter of "apps" prefix is never lost for any status combination', () => {
  const cases = [
    [' M apps/stores-web/README.md', 'apps/stores-web/README.md'],
    ['M  apps/stores-web/README.md', 'apps/stores-web/README.md'],
    ['A  apps/stores-web/README.md', 'apps/stores-web/README.md'],
    ['?? apps/stores-web/README.md', 'apps/stores-web/README.md'],
    ['MM apps/stores-web/README.md', 'apps/stores-web/README.md'],
    [' D apps/stores-web/README.md', 'apps/stores-web/README.md'],
  ];
  for (const [line, expected] of cases) {
    const parsed = safety.parsePorcelainPaths(line + '\n');
    assert.deepEqual(parsed, [expected], `line ${JSON.stringify(line)}`);
    assert.ok(parsed[0].startsWith('apps/'), `first letter lost in ${parsed[0]}`);
  }
});

// --- 2. Required stores-web paths parse intact

test('required stores-web paths keep their first letter', () => {
  const out = [
    ' M apps/stores-web/README.md',
    ' M apps/stores-web/app/page.tsx',
    '?? apps/stores-web/app/metiz-market/page.tsx',
    '',
  ].join('\n');
  assert.deepEqual(safety.parsePorcelainPaths(out), [
    'apps/stores-web/README.md',
    'apps/stores-web/app/page.tsx',
    'apps/stores-web/app/metiz-market/page.tsx',
  ]);
});

// --- 3. Multiple changed files at once, mixed statuses

test('multiple files with mixed statuses all parse correctly', () => {
  const out = [
    ' M apps/stores-web/README.md',
    'M  apps/stores-web/app/page.tsx',
    'A  apps/stores-web/app/metiz-market/page.tsx',
    '?? apps/stores-web/lib/new-util.ts',
    ' D apps/stores-web/app/old.tsx',
    '',
  ].join('\n');
  const files = safety.parsePorcelainPaths(out);
  assert.equal(files.length, 5);
  assert.deepEqual(files, [
    'apps/stores-web/README.md',
    'apps/stores-web/app/page.tsx',
    'apps/stores-web/app/metiz-market/page.tsx',
    'apps/stores-web/lib/new-util.ts',
    'apps/stores-web/app/old.tsx',
  ]);
  for (const f of files) assert.ok(f.startsWith('apps/'), `first letter lost in ${f}`);
  assert.deepEqual(safety.validateChangedFiles(files, STORES_AREA), []);
});

// --- 4. Rename/copy lines yield the NEW path

test('rename line "R  old -> new" yields the new path', () => {
  const out = 'R  apps/stores-web/app/old.tsx -> apps/stores-web/app/page.tsx\n';
  assert.deepEqual(safety.parsePorcelainPaths(out), ['apps/stores-web/app/page.tsx']);
});

// --- 5. Edge cases

test('empty output and blank lines produce no files', () => {
  assert.deepEqual(safety.parsePorcelainPaths(''), []);
  assert.deepEqual(safety.parsePorcelainPaths(undefined), []);
  assert.deepEqual(safety.parsePorcelainPaths('\n'), []);
});

// --- 6. End-to-end against a real git repo: exact issue #37 reproduction

test('real git repo: unstaged first file parses and passes area policy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-porcelain-'));
  try {
    await run('git', ['init', '-q', '.'], { cwd: dir, timeoutMs: 30 * 1000 });
    await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, timeoutMs: 30 * 1000 });
    await run('git', ['config', 'user.name', 'Test'], { cwd: dir, timeoutMs: 30 * 1000 });
    await run('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir, timeoutMs: 30 * 1000 });

    // layout matching the real repo: tracked dirs, then an UNSTAGED modification
    // (X = space) as the first status line — the exact issue #37 failure mode
    fs.mkdirSync(path.join(dir, 'apps/stores-web/app/metiz-market'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'apps/stores-web/README.md'), '# readme\n');
    fs.writeFileSync(path.join(dir, 'apps/stores-web/app/page.tsx'), 'export default function Page() {}\n');
    fs.writeFileSync(path.join(dir, 'apps/stores-web/app/metiz-market/page.tsx'), 'export default function Page() {}\n');
    await run('git', ['add', '-A'], { cwd: dir, timeoutMs: 30 * 1000 });
    await run('git', ['commit', '-q', '-m', 'base'], { cwd: dir, timeoutMs: 30 * 1000 });

    fs.appendFileSync(path.join(dir, 'apps/stores-web/README.md'), 'update\n'); // unstaged: " M ..."
    fs.appendFileSync(path.join(dir, 'apps/stores-web/app/page.tsx'), '// tweak\n'); // unstaged
    fs.writeFileSync(path.join(dir, 'apps/stores-web/app/metiz-market/new.tsx'), 'new\n'); // untracked: "?? ..."

    const status = await run('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: dir, timeoutMs: 30 * 1000 });
    assert.ok(status.ok, `git status failed: ${status.stderr}`);
    // sanity: git really does emit a leading space for the unstaged lines
    assert.ok(status.stdout.split('\n').some((l) => l.startsWith(' M apps/')), 'expected unstaged " M" lines');

    const files = safety.parsePorcelainPaths(status.stdout);
    assert.deepEqual(files.sort(), [
      'apps/stores-web/README.md',
      'apps/stores-web/app/metiz-market/new.tsx',
      'apps/stores-web/app/page.tsx',
    ]);
    for (const f of files) assert.ok(f.startsWith('apps/'), `first letter lost in ${f}`);
    assert.deepEqual(safety.validateChangedFiles(files, STORES_AREA), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- 7. Fail-closed guarantees stay intact (area policy not weakened)

test('fail-closed: purchasing, traversal, absolute paths and other apps are rejected', () => {
  const hostile = [
    'agents/purchasing/order_agent.js',
    'apps/purchasing-web-backend/server.js',
    '../escape.txt',
    'apps/stores-web/../../agents/purchasing/order_agent.js',
    '/etc/passwd',
    '/abs/apps/stores-web/README.md',
    'apps/business-kpi-web/package.json',
    'apps/stores-web-evil/page.tsx',
  ];
  const violations = safety.validateChangedFiles(hostile, STORES_AREA);
  assert.equal(violations.length, hostile.length,
    `every hostile path must be rejected, got: ${violations.join('; ')}`);
});

test('fail-closed: parsing never invents an allowed path from hostile porcelain lines', () => {
  // even if a path literally started after the prefix, validation is what
  // enforces the boundary — parsing must hand it through unchanged
  const out = ' M pps/stores-web/README.md\n'; // what the OLD bug produced
  const files = safety.parsePorcelainPaths(out);
  assert.deepEqual(files, ['pps/stores-web/README.md']); // parsed verbatim ...
  assert.equal(safety.validateChangedFiles(files, STORES_AREA).length, 1); // ... and rejected
});
