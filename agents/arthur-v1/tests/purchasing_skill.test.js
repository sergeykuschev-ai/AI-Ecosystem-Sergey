'use strict';

const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PurchasingSkill } = require('../skills/purchasing/purchasing_skill');
const { UnsupportedOperationError } = require('../errors/arthur_errors');

const RUN_A = 'eb68a662-0fd4-43c0-b7c4-8aaf2e95f790';
const RUN_B = 'f779b773-1ae5-54d1-a8d5-9bbf3f06f8a1';

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
    amounts: overrides.amounts || {},
    phase2: overrides.phase2 || {},
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

test('purchasing skill has read-only capabilities', () => {
  assert.equal(PurchasingSkill.id, 'purchasing');
  assert.equal(PurchasingSkill.readOnly, true);
  assert.ok(PurchasingSkill.capabilities.every(c => c.readOnly === true));
});

test('health returns healthy', async () => {
  const health = await PurchasingSkill.health();
  assert.equal(health.healthy, true);
  assert.equal(health.skill, 'purchasing');
});

test('getStatus returns structured status and metadata', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-skill-status-'));
  try {
    createRunDir(root, RUN_A, 'completed', {
      completedAt: '2026-08-04T00:31:58.041Z',
      source: { original_name: 'Оникиенко Зооград 04.08.2026.xlsx' },
      skuCount: 602,
      sourceRowsCount: 700,
      warnings: ['warning-1'],
    });

    const result = await PurchasingSkill.execute({
      operation: 'getStatus',
      parameters: { runsRoot: root },
    });

    assert.equal(result.status, 'success');
    assert.equal(result.data.productCount, 602);
    assert.equal(result.data.sourceRowsCount, 700);
    assert.equal(result.data.reportWarnings, 1);
    assert.equal(result.data.run.run_id, RUN_A);
    assert.equal(result.data.run.status, 'completed');
    assert.equal(result.data.run.source_filename, 'Оникиенко Зооград 04.08.2026.xlsx');
    assert.equal(result.data.run.completed_at, '2026-08-04T00:31:58.041Z');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('getSummary returns real summary values', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-skill-summary-'));
  try {
    createRunDir(root, RUN_A, 'completed', {
      completedAt: '2026-08-04T00:31:58.041Z',
      skuCount: 602,
      sourceRowsCount: 700,
      amounts: {
        analyzer_order_sum: 121841.6,
        auto_approved_sum: 0,
      },
      phase2: {
        must_buy: 0,
        recommended: 0,
        manual_review: 602,
        postpone: 0,
        do_not_buy: 0,
      },
      warnings: ['w1'],
    });

    const result = await PurchasingSkill.execute({
      operation: 'getSummary',
      parameters: { runsRoot: root },
    });

    assert.equal(result.status, 'success');
    assert.equal(result.data.productCount, 602);
    assert.equal(result.data.analyzerOrderSum, 121841.6);
    assert.equal(result.data.workingOrderSum, 0);
    assert.equal(result.data.pendingReviewCount, 602);
    assert.equal(result.data.mustBuyCount, 0);
    assert.equal(result.data.run.run_id, RUN_A);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('getOwnerReview returns review summary and metadata', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-skill-owner-'));
  try {
    createRunDir(root, RUN_A, 'completed', {
      completedAt: '2026-08-04T00:31:58.041Z',
      actionRequired: 63,
      unmatched: ['SKU-1', 'SKU-2', 'SKU-3'],
    });

    const result = await PurchasingSkill.execute({
      operation: 'getOwnerReview',
      parameters: { runsRoot: root },
    });

    assert.equal(result.status, 'success');
    assert.equal(result.data.count, 63);
    assert.equal(result.data.items.length, 3);
    assert.equal(result.data.items[0].sku, 'SKU-1');
    assert.equal(result.data.run.run_id, RUN_A);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('getOwnerReview caps items at 20', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-skill-owner-cap-'));
  try {
    createRunDir(root, RUN_A, 'completed', {
      completedAt: '2026-08-04T00:31:58.041Z',
      actionRequired: 100,
      unmatched: Array.from({ length: 30 }, (_, i) => `SKU-${i}`),
    });

    const result = await PurchasingSkill.execute({
      operation: 'getOwnerReview',
      parameters: { runsRoot: root },
    });

    assert.equal(result.data.items.length, 20);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('explicit runId selects specified run', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-skill-explicit-'));
  try {
    createRunDir(root, RUN_A, 'completed', {
      completedAt: '2026-08-04T00:31:58.041Z',
      skuCount: 602,
    });
    createRunDir(root, RUN_B, 'completed', {
      completedAt: '2026-08-09T12:00:00.000Z',
      skuCount: 150,
    });

    const result = await PurchasingSkill.execute({
      operation: 'getStatus',
      parameters: { runsRoot: root, runId: RUN_A },
    });

    assert.equal(result.data.productCount, 602);
    assert.equal(result.data.run.run_id, RUN_A);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('no completed run returns explicit no-data state', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-skill-empty-'));
  try {
    const result = await PurchasingSkill.execute({
      operation: 'getStatus',
      parameters: { runsRoot: root },
    });

    assert.equal(result.status, 'success');
    assert.equal(result.data.summary, 'Нет доступной завершённой закупки.');
    assert.equal(result.data.productCount, 0);
    assert.equal(result.data.sourceRowsCount, 0);
    assert.equal(result.data.run, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('processing-only runs return no-data state', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-skill-processing-'));
  try {
    createRunDir(root, RUN_A, 'processing', { skuCount: 100 });
    const result = await PurchasingSkill.execute({
      operation: 'getStatus',
      parameters: { runsRoot: root },
    });

    assert.equal(result.data.run, null);
    assert.equal(result.data.productCount, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('getFinalOrder returns NOT_AVAILABLE in read-only mode', async () => {
  const result = await PurchasingSkill.execute({
    operation: 'getFinalOrder',
    parameters: {},
  });
  assert.equal(result.status, 'success');
  assert.equal(result.data.status, 'NOT_AVAILABLE');
  assert.equal(result.data.reason, 'REQUIRES_OWNER_REVIEW');
});

test('unsupported operation throws', async () => {
  await assert.rejects(
    async () => PurchasingSkill.execute({ operation: 'sendOrder', parameters: {} }),
    UnsupportedOperationError
  );
});

test('adapter does not write to runs root', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-skill-readonly-'));
  try {
    createRunDir(root, RUN_A, 'completed', { completedAt: '2026-08-04T00:31:58.041Z', skuCount: 10 });
    const before = fs.readdirSync(root);
    await PurchasingSkill.execute({ operation: 'getStatus', parameters: { runsRoot: root } });
    await PurchasingSkill.execute({ operation: 'getSummary', parameters: { runsRoot: root } });
    await PurchasingSkill.execute({ operation: 'getOwnerReview', parameters: { runsRoot: root } });
    const after = fs.readdirSync(root);
    assert.deepEqual(after, before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
