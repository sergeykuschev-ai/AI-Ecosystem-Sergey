'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ArthurCoreService } = require('../services/arthur-core-service');
const { InMemoryArthurStore } = require('../services/in-memory-store');

function createService() {
  let sequence = 0;
  const store = new InMemoryArthurStore();
  const service = new ArthurCoreService({
    store,
    clock: () => new Date('2026-07-30T10:00:00.000Z'),
    idFactory: () => `id-${++sequence}`
  });
  return { service, store };
}

const actor = { actorId: 'sergey', actorType: 'user', correlationId: 'corr-1' };

test('profile writes create audit events', () => {
  const { service } = createService();
  service.createProfile({ id: 'sergey', name: 'Сергей', timezone: 'Europe/Paris', locale: 'ru-RU' }, actor);
  service.updateProfile('sergey', { preferredChannel: 'telegram' }, actor);
  assert.equal(service.getProfile('sergey').preferredChannel, 'telegram');
  assert.deepEqual(service.listAudit().map(event => event.action), ['profile.create', 'profile.update']);
});

test('memory upsert versions active records instead of deleting history', () => {
  const { service, store } = createService();
  const base = {
    ownerId: 'sergey', domain: 'business', type: 'fact', key: 'miska.hours',
    sourceType: 'user', confidence: 1, value: { weekdays: '09:00-19:00' }
  };
  service.upsertMemory(base, actor);
  const current = service.upsertMemory({ ...base, value: { weekdays: '09:00-20:00' } }, actor);
  assert.deepEqual(service.getActiveMemory('sergey', 'business', 'miska.hours').value, current.value);
  const history = store.list('memory', item => item.key === 'miska.hours');
  assert.equal(history.length, 2);
  assert.equal(history.filter(item => item.status === 'active').length, 1);
  assert.equal(history.filter(item => item.status === 'archived').length, 1);
});

test('task transition enforces workflow rules and audits success', () => {
  const { service } = createService();
  const task = service.createTask({ ownerId: 'sergey', title: 'Ждать Min/Max', domain: 'business' }, actor);
  assert.throws(() => service.transitionTask(task.id, 'waiting', {}, actor), /waitingFor/);
  const waiting = service.transitionTask(task.id, 'waiting', {
    waitingFor: 'разработчики Min/Max',
    nextCheckAt: '2026-08-01T09:00:00+02:00'
  }, actor);
  assert.equal(waiting.status, 'waiting');
  assert.equal(service.listAudit({ entityId: task.id }).length, 2);
});

test('decision superseding preserves old decision and links replacement', () => {
  const { service, store } = createService();
  const first = service.createDecision({
    ownerId: 'sergey', domain: 'purchasing', statement: 'Заказ не делать', reason: 'Некорректная выгрузка'
  }, actor);
  const second = service.supersedeDecision(first.id, {
    ownerId: 'sergey', domain: 'purchasing', statement: 'Повторить расчёт', reason: 'Получена новая выгрузка'
  }, actor);
  assert.equal(store.get('decisions', first.id).status, 'superseded');
  assert.equal(second.supersedesDecisionId, first.id);
});

test('confirmation approval rejects changed payload and audits valid approval', () => {
  const { service } = createService();
  const payload = { supplier: 'Min/Max', amount: 13500, periodMonths: 6 };
  const confirmation = service.createConfirmation({
    ownerId: 'sergey', domain: 'finance', skillId: 'purchasing',
    actionType: 'payment.prepare', risk: 'high', payload
  }, actor);
  assert.throws(
    () => service.resolveConfirmation(confirmation.id, 'approved', { ...payload, amount: 14000 }, actor),
    /fingerprint mismatch/
  );
  const approved = service.resolveConfirmation(confirmation.id, 'approved', payload, actor);
  assert.equal(approved.status, 'approved');
  assert.deepEqual(
    service.listAudit({ entityId: confirmation.id }).map(event => event.action),
    ['confirmation.create', 'confirmation.approved']
  );
});
