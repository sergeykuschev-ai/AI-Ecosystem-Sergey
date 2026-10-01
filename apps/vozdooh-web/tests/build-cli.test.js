'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BUILD_SCRIPT = path.join(ROOT, 'scripts', 'build-dataset.js');
const FIXTURE_SNAPSHOT = path.join(ROOT, 'tests', 'fixtures', '1c-snapshot.synthetic.json');
const FIXTURE_EVIDENCE = path.join(ROOT, 'tests', 'fixtures', 'evidence.synthetic.json');
const TMP_ROOT = path.join(ROOT, 'tmp');

/**
 * Create a scratch directory inside the package (gitignored via root tmp/).
 * @returns {string}
 */
function makeScratchDir() {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(TMP_ROOT, 'build-test-'));
}

/**
 * @param {string[]} extraArgs
 * @returns {{ stdout: string, dir: string, outPath: string, auditPath: string }}
 */
function runBuild(extraArgs) {
  const dir = makeScratchDir();
  const outPath = path.join(dir, 'dataset.json');
  const auditPath = path.join(dir, 'audit.md');
  const args = [
    BUILD_SCRIPT,
    '--snapshot', FIXTURE_SNAPSHOT,
    '--evidence', FIXTURE_EVIDENCE,
    '--out', outPath,
    '--audit-out', auditPath,
    '--date', '2026-10-01',
    ...extraArgs,
  ];
  const stdout = execFileSync(process.execPath, args, { encoding: 'utf8' });
  return { stdout, dir, outPath, auditPath };
}

test('build-dataset CLI writes dataset JSON and audit markdown from fixtures', () => {
  const { stdout, outPath, auditPath } = runBuild([]);

  assert.ok(stdout.includes('5 eligible SKUs'), `unexpected stdout: ${stdout}`);
  const dataset = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(dataset.dataset_schema_version, 'v1');
  assert.equal(dataset.generated_at, '2026-10-01');
  assert.equal(dataset.summary.total_eligible, 5);
  assert.equal(dataset.summary.verified, 2);
  assert.equal(dataset.summary.conflict, 1);

  const audit = fs.readFileSync(auditPath, 'utf8');
  assert.ok(audit.includes('# VOZDOOH Task 8 — Logistics dimensions/weight audit'));
  assert.ok(audit.includes('Generated: 2026-10-01'));
});

test('build-dataset CLI succeeds with a warning when the snapshot is missing', () => {
  const dir = makeScratchDir();
  const outPath = path.join(dir, 'dataset.json');
  const auditPath = path.join(dir, 'audit.md');

  const stdout = execFileSync(
    process.execPath,
    [
      BUILD_SCRIPT,
      '--snapshot', path.join(dir, 'no-such-snapshot.json'),
      '--evidence', FIXTURE_EVIDENCE,
      '--out', outPath,
      '--audit-out', auditPath,
      '--date', '2026-10-01',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );

  assert.ok(stdout.includes('0 eligible SKUs'), `unexpected stdout: ${stdout}`);
  const dataset = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(dataset.source_set.snapshot_present, false);
  assert.equal(dataset.summary.total_eligible, 0);
  const audit = fs.readFileSync(auditPath, 'utf8');
  assert.ok(audit.includes('1C snapshot present: **false**'));
});

test('build-dataset CLI fails with an actionable error on malformed evidence JSONL', () => {
  const dir = makeScratchDir();
  const badEvidence = path.join(dir, 'evidence.jsonl');
  fs.writeFileSync(badEvidence, '{"sku":"X"}\nnot-json\n', 'utf8');

  assert.throws(
    () =>
      execFileSync(process.execPath, [
        BUILD_SCRIPT,
        '--snapshot', FIXTURE_SNAPSHOT,
        '--evidence', badEvidence,
        '--out', path.join(dir, 'dataset.json'),
        '--audit-out', path.join(dir, 'audit.md'),
      ], { stdio: ['ignore', 'pipe', 'pipe'] }),
    /line 2 is not valid JSON/,
  );
});
