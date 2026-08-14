'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { canTransitionTask, assertTaskTransition } = require('../tasks/transitions');
const {
  canonicalize,
  createPayloadFingerprint,
  verifyPayloadFingerprint
} = require('../confirmations/fingerprint');
const {
  DECISION_STATUSES,
  CONFIRMATION_RISKS,
  CONFIRMATION_STATUSES
} = require('../shared/constants');

const migrationPath = path.join(
  __dirname,
  '../../../data/arthur/migrations/002_tasks_decisions_confirmations.up.sql'
);
const rollbackPath = path.join(
  __dirname,
  '../../../data/arthur/migrations/002_tasks_decisions_confirmations.down.sql'
);
const sql = fs.readFileSync(migrationPath, 'utf8');
const rollback = fs.readFileSync(rollbackPath, 'utf8');

test('task transitions reject invalid terminal transitions', () => {
  assert.equal(canTransitionTask('new', 'planned'), true);
  assert.equal(canTransitionTask('new', 'done'), true);
  assert.equal(canTransitionTask('planned', 'done'), true);
  assert.equal(canTransitionTask('done', 'in_progress'), false);
  assert.throws(() => assertTaskTransition('cancelled', 'planned'), /Invalid task transition/);
});

test('waiting transition requires waiting target and next check', () => {
  assert.throws(() => assertTaskTransition('in_progress', 'waiting', {}), /waitingFor/);
  assert.throws(
    () => assertTaskTransition('in_progress', 'waiting', { waitingFor: 'поставщик' }),
    /nextCheckAt/
  );
  assert.doesNotThrow(() => assertTaskTransition('in_progress', 'waiting', {
    waitingFor: 'поставщик',
    nextCheckAt: '2026-08-01T09:00:00+10:00'
  }));
});

test('confirmation fingerprint is stable across object key order', () => {
  const first = { amount: 13500, supplier: 'Min/Max', meta: { period: 6, unit: 'months' } };
  const second = { meta: { unit: 'months', period: 6 }, supplier: 'Min/Max', amount: 13500 };
  const fingerprint = createPayloadFingerprint(first);
  assert.equal(fingerprint, createPayloadFingerprint(second));
  assert.equal(verifyPayloadFingerprint(second, fingerprint), true);
  assert.equal(verifyPayloadFingerprint({ ...second, amount: 14000 }, fingerprint), false);
});

test('canonicalize does not mutate source payload', () => {
  const source = { z: 1, a: { y: 2, x: 3 } };
  const canonical = canonicalize(source);
  assert.deepEqual(canonical, { a: { x: 3, y: 2 }, z: 1 });
  assert.deepEqual(source, { z: 1, a: { y: 2, x: 3 } });
});

test('workflow constants expose canonical statuses', () => {
  assert.deepEqual(DECISION_STATUSES, ['active', 'superseded', 'reversed']);
  assert.deepEqual(CONFIRMATION_RISKS, ['low', 'medium', 'high']);
  assert.ok(CONFIRMATION_STATUSES.includes('executed'));
});

test('migration creates workflow tables and constraints idempotently', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS arthur_tasks/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS arthur_decisions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS arthur_confirmations/);
  assert.match(sql, /status <> 'waiting'/);
  assert.match(sql, /payload_fingerprint char\(64\)/);
  assert.match(sql, /arthur_confirmations_one_pending_action/);
});

test('rollback drops workflow tables in dependency-safe order', () => {
  const confirmations = rollback.indexOf('DROP TABLE IF EXISTS arthur_confirmations');
  const decisions = rollback.indexOf('DROP TABLE IF EXISTS arthur_decisions');
  const tasks = rollback.indexOf('DROP TABLE IF EXISTS arthur_tasks');
  assert.ok(confirmations >= 0 && decisions > confirmations && tasks > decisions);
});
