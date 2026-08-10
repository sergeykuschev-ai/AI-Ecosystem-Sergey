'use strict';

const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createRunResolver,
  PurchasingRunError,
  isValidRunId,
} = require('../skills/purchasing/run_resolver');

const RUN_A = 'eb68a662-0fd4-43c0-b7c4-8aaf2e95f790';
const RUN_B = 'f779b773-1ae5-54d1-a8d5-9bbf3f06f8a1';
const RUN_PROCESSING = 'aabbccdd-1234-5678-90ab-cdef01234567';
const RUN_FAILED = '11223344-5566-7788-99aa-bbccddeeff00';

function writeJson(dir, name, value) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2));
}

function createRunDir(root, runId, status, overrides = {}) {
  const dir = path.join(root, runId);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(dir, 'run.json', {
    run_id: runId,
    status,
    completed_at: overrides.completedAt || null,
    created_at: overrides.createdAt || '2026-08-01T00:00:00.000Z',
    source: overrides.source || { original_name: `${runId}.xlsx` },
  });
  writeJson(dir, 'summary.json', {
    run_id: runId,
    sku_count: overrides.skuCount ?? 0,
    source_rows_count: overrides.sourceRowsCount ?? 0,
    warnings: overrides.warnings || [],
  });
  writeJson(dir, 'owner-review-compact.json', {
    run_id: runId,
    status: { code: 'orange', label: 'требуется проверка' },
    summary: {
      owner_action_required_total: overrides.actionRequired ?? 0,
    },
    owner_decisions: {
      unmatched_active_skus: overrides.unmatched || [],
    },
  });
  return dir;
}

test('isValidRunId accepts UUID v4 and rejects invalid strings', () => {
  assert.equal(isValidRunId(RUN_A), true);
  assert.equal(isValidRunId('not-a-uuid'), false);
  assert.equal(isValidRunId('../etc/passwd'), false);
  assert.equal(isValidRunId('eb68a662-0fd4-43c0-b7c4-8aaf2e95f790.exe'), false);
});

test('empty runs root returns null latest run', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-runs-empty-'));
  try {
    const resolver = createRunResolver({ runsRoot: root });
    assert.equal(resolver.resolveRunId(), null);
    assert.equal(resolver.findLatestCompletedRun(), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing runs root returns null latest run', () => {
  const root = path.join(os.tmpdir(), 'purchasing-runs-missing-' + Date.now());
  const resolver = createRunResolver({ runsRoot: root });
  assert.equal(resolver.resolveRunId(), null);
});

test('processing run is not selected as latest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-runs-processing-'));
  try {
    createRunDir(root, RUN_PROCESSING, 'processing', {
      createdAt: '2026-08-10T00:00:00.000Z',
      skuCount: 100,
    });
    const resolver = createRunResolver({ runsRoot: root });
    assert.equal(resolver.resolveRunId(), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('failed run is not selected as latest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-runs-failed-'));
  try {
    createRunDir(root, RUN_FAILED, 'failed', {
      completedAt: '2026-08-10T00:00:00.000Z',
      skuCount: 100,
    });
    const resolver = createRunResolver({ runsRoot: root });
    assert.equal(resolver.resolveRunId(), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('single completed run is selected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-runs-single-'));
  try {
    createRunDir(root, RUN_A, 'completed', {
      completedAt: '2026-08-04T00:31:58.041Z',
      source: { original_name: 'real-export.xlsx' },
      skuCount: 602,
      sourceRowsCount: 700,
    });
    const resolver = createRunResolver({ runsRoot: root });
    const latest = resolver.findLatestCompletedRun();
    assert.equal(latest.run_id, RUN_A);
    assert.equal(latest.status, 'completed');
    assert.equal(latest.source.original_name, 'real-export.xlsx');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('latest completed run selected by completed_at', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-runs-latest-'));
  try {
    createRunDir(root, RUN_A, 'completed', {
      completedAt: '2026-08-04T00:31:58.041Z',
      skuCount: 602,
    });
    createRunDir(root, RUN_B, 'completed', {
      completedAt: '2026-08-09T12:00:00.000Z',
      skuCount: 150,
    });
    const resolver = createRunResolver({ runsRoot: root });
    const runId = resolver.resolveRunId();
    assert.equal(runId, RUN_B);
    const summary = resolver.getRunSummary(runId);
    assert.equal(summary.sku_count, 150);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('explicit runId overrides latest selection', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-runs-explicit-'));
  try {
    createRunDir(root, RUN_A, 'completed', {
      completedAt: '2026-08-04T00:31:58.041Z',
      skuCount: 602,
    });
    createRunDir(root, RUN_B, 'completed', {
      completedAt: '2026-08-09T12:00:00.000Z',
      skuCount: 150,
    });
    const resolver = createRunResolver({ runsRoot: root });
    const runId = resolver.resolveRunId({ runId: RUN_A });
    assert.equal(runId, RUN_A);
    const summary = resolver.getRunSummary(runId);
    assert.equal(summary.sku_count, 602);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('invalid explicit runId throws', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-runs-invalid-'));
  try {
    const resolver = createRunResolver({ runsRoot: root });
    assert.throws(() => resolver.resolveRunId({ runId: '../etc/passwd' }), PurchasingRunError);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('path traversal runId is rejected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-runs-traversal-'));
  try {
    createRunDir(root, RUN_A, 'completed', { completedAt: '2026-08-04T00:31:58.041Z' });
    const evilRunId = RUN_A + '/../../etc';
    const resolver = createRunResolver({ runsRoot: root });
    assert.throws(() => resolver.getRunMetadata(evilRunId), PurchasingRunError);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolver exposes runsRoot', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-runs-root-'));
  try {
    const resolver = createRunResolver({ runsRoot: root });
    assert.equal(resolver.runsRoot, path.resolve(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
