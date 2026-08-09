'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { PurchasingSkill, DEFAULT_FIXTURE_PATH } = require('../skills/purchasing/purchasing_skill');
const { UnsupportedOperationError } = require('../errors/arthur_errors');

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

test('getStatus returns structured status', async () => {
  const result = await PurchasingSkill.execute({
    operation: 'getStatus',
    parameters: { filePath: DEFAULT_FIXTURE_PATH },
  });
  assert.equal(result.status, 'success');
  assert.equal(typeof result.data.summary, 'string');
  assert.equal(typeof result.data.productCount, 'number');
});

test('getSummary returns structured summary', async () => {
  const result = await PurchasingSkill.execute({
    operation: 'getSummary',
    parameters: { filePath: DEFAULT_FIXTURE_PATH },
  });
  assert.equal(result.status, 'success');
  assert.equal(typeof result.data.summary, 'string');
  assert.ok(Array.isArray(result.data.warnings));
});

test('getOwnerReview returns review items', async () => {
  const result = await PurchasingSkill.execute({
    operation: 'getOwnerReview',
    parameters: { filePath: DEFAULT_FIXTURE_PATH },
  });
  assert.equal(result.status, 'success');
  assert.equal(typeof result.data.count, 'number');
  assert.ok(Array.isArray(result.data.items));
});

test('getFinalOrder returns NOT_AVAILABLE in read-only mode', async () => {
  const result = await PurchasingSkill.execute({
    operation: 'getFinalOrder',
    parameters: { filePath: DEFAULT_FIXTURE_PATH },
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
