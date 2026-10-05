'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DeliveryQueueModel } = require('./delivery_queue_model');

test('temporary API outage preserves exact batch and recovery delivers once', async () => {
  let time = new Date('2026-10-04T20:00:00Z');
  const queue = new DeliveryQueueModel({
    now: () => time,
    makeId: () => 'stable-batch-id',
  });
  const item = queue.enqueue({
    sourceInstance: 'ut-test',
    record: { recordId: 'amper:2026-10-04', cash: 100 },
  });
  let calls = 0;
  await queue.process(async request => {
    calls += 1;
    assert.equal(request.path, '/api/integration/1c/v1/daily-sales/shadow');
    assert.equal(request.idempotencyKey, item.batchId);
    assert.deepEqual(request.payload, item.payload);
    throw new Error('network unavailable');
  });
  assert.equal(calls, 1);
  assert.equal(queue.pending[0].attempts, 1);
  await queue.process(async () => { calls += 1; });
  assert.equal(calls, 1);
  time = new Date('2026-10-04T20:00:31Z');
  await queue.process(async request => {
    calls += 1;
    assert.equal(request.idempotencyKey, item.batchId);
    assert.deepEqual(request.payload, item.payload);
  });
  assert.equal(calls, 2);
  assert.equal(queue.pending.length, 0);
  assert.equal(queue.delivered.length, 1);
});

test('changed document creates a new batch while record identity stays stable', () => {
  let number = 0;
  const queue = new DeliveryQueueModel({ makeId: () => `batch-${++number}` });
  const original = queue.enqueue({
    sourceInstance: 'ut-test',
    record: { recordId: 'amper:2026-10-04', cash: 100 },
  });
  const changed = queue.enqueue({
    sourceInstance: 'ut-test',
    record: { recordId: 'amper:2026-10-04', cash: 150 },
  });
  assert.notEqual(original.batchId, changed.batchId);
  assert.equal(original.payload.records[0].recordId, changed.payload.records[0].recordId);
  assert.equal(original.payload.records[0].cash, 100);
});

test('draft queue cannot send apply', () => {
  const queue = new DeliveryQueueModel();
  assert.throws(() => queue.enqueue({
    sourceInstance: 'ut-test',
    record: { recordId: 'amper:2026-10-04' },
    mode: 'apply',
  }));
});
