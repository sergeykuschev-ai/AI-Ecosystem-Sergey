'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateDomain,
  validateProfile,
  validateMemoryRecord,
  validateTask,
  validateAuditEvent
} = require('../shared/validation');
const { getDatabaseConfig } = require('../shared/database-config');

test('accepts canonical domain and rejects unknown domain', () => {
  assert.equal(validateDomain('personal'), 'personal');
  assert.throws(() => validateDomain('unknown'), /domain must be one of/);
});

test('validates a minimal profile', () => {
  const profile = { id: 'sergey', name: 'Сергей', timezone: 'Europe/Paris', locale: 'ru-RU' };
  assert.equal(validateProfile(profile), profile);
});

test('validates memory confidence and sensitivity', () => {
  const memory = {
    ownerId: 'sergey', domain: 'business', type: 'fact', key: 'store.hours',
    value: { weekdays: '09:00-19:00' }, sourceType: 'user', confidence: 1,
    sensitivity: 'normal'
  };
  assert.equal(validateMemoryRecord(memory), memory);
  assert.throws(() => validateMemoryRecord({ ...memory, confidence: 1.1 }), /between 0 and 1/);
  assert.throws(() => validateMemoryRecord({ ...memory, sensitivity: 'secret' }), /sensitivity must be one of/);
});

test('waiting task requires waitingFor and nextCheckAt', () => {
  const base = { ownerId: 'sergey', title: 'Ждать ответ', domain: 'business', status: 'waiting' };
  assert.throws(() => validateTask(base), /waitingFor/);
  assert.throws(() => validateTask({ ...base, waitingFor: 'поставщик' }), /nextCheckAt/);
  assert.doesNotThrow(() => validateTask({
    ...base,
    waitingFor: 'поставщик',
    nextCheckAt: '2026-08-01T09:00:00+10:00'
  }));
});

test('validates audit event enums', () => {
  const event = {
    actorId: 'sergey', actorType: 'user', domain: 'system', action: 'profile.create',
    entityType: 'profile', entityId: 'sergey', correlationId: '00000000-0000-0000-0000-000000000001',
    result: 'success'
  };
  assert.equal(validateAuditEvent(event), event);
  assert.throws(() => validateAuditEvent({ ...event, actorType: 'admin' }), /actorType must be one of/);
});

test('test database config must point to dedicated test database', () => {
  assert.throws(
    () => getDatabaseConfig({ NODE_ENV: 'test', ARTHUR_DATABASE_URL: 'postgres://localhost/arthur' }),
    /dedicated database URL/
  );
  assert.equal(
    getDatabaseConfig({ NODE_ENV: 'test', ARTHUR_DATABASE_URL: 'postgres://localhost/arthur_test' }).url,
    'postgres://localhost/arthur_test'
  );
});
