'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AsyncArthurCoreService } = require('../services/async-arthur-core-service');

class TransactionalMemoryStore {
  constructor(state) {
    this.state = state || {
      profiles: new Map(), memory: new Map(), tasks: new Map(), decisions: new Map(),
      confirmations: new Map(), audit: [], failAudit: false
    };
  }

  cloneState() {
    return {
      profiles: new Map(this.state.profiles),
      memory: new Map(this.state.memory),
      tasks: new Map(this.state.tasks),
      decisions: new Map(this.state.decisions),
      confirmations: new Map(this.state.confirmations),
      audit: this.state.audit.slice(),
      failAudit: this.state.failAudit
    };
  }

  async transaction(work) {
    const snapshot = this.cloneState();
    const scoped = new TransactionalMemoryStore(this.state);
    try {
      return await work(scoped);
    } catch (error) {
      this.state.profiles = snapshot.profiles;
      this.state.memory = snapshot.memory;
      this.state.tasks = snapshot.tasks;
      this.state.decisions = snapshot.decisions;
      this.state.confirmations = snapshot.confirmations;
      this.state.audit = snapshot.audit;
      this.state.failAudit = snapshot.failAudit;
      throw error;
    }
  }

  async putProfile(record) { this.state.profiles.set(record.id, { ...record }); return record; }
  async getProfile(id) { return this.state.profiles.get(id) || null; }

  async archiveActiveMemory(ownerId, domain, key, validTo) {
    const archived = [];
    for (const [id, item] of this.state.memory) {
      if (item.ownerId === ownerId && item.domain === domain && item.key === key && item.status === 'active') {
        const next = { ...item, status: 'archived', validTo, updatedAt: validTo };
        this.state.memory.set(id, next);
        archived.push(next);
      }
    }
    return archived;
  }

  async putMemory(record) { this.state.memory.set(record.id, { ...record }); return record; }
  async getActiveMemory(ownerId, domain, key) {
    return [...this.state.memory.values()].find(item =>
      item.ownerId === ownerId && item.domain === domain && item.key === key && item.status === 'active') || null;
  }

  async putTask(record) { this.state.tasks.set(record.id, { ...record }); return record; }
  async getTask(id) { return this.state.tasks.get(id) || null; }
  async putDecision(record) { this.state.decisions.set(record.id, { ...record }); return record; }
  async getDecision(id) { return this.state.decisions.get(id) || null; }
  async putConfirmation(record) { this.state.confirmations.set(record.id, { ...record }); return record; }
  async getConfirmation(id) { return this.state.confirmations.get(id) || null; }
  async appendAudit(record) {
    if (this.state.failAudit) throw new Error('audit unavailable');
    this.state.audit.push({ ...record });
    return record;
  }
  async listAudit({ entityId, correlationId } = {}) {
    return this.state.audit.filter(event =>
      (!entityId || event.entityId === entityId) &&
      (!correlationId || event.correlationId === correlationId));
  }
}

function createService() {
  let sequence = 0;
  const store = new TransactionalMemoryStore();
  const service = new AsyncArthurCoreService({
    store,
    clock: () => new Date('2026-07-30T10:00:00.000Z'),
    idFactory: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`
  });
  return { service, store };
}

const actor = { actorId: 'sergey', actorType: 'user', correlationId: 'corr-async-1' };

test('task and audit are committed atomically', async () => {
  const { service, store } = createService();
  const task = await service.createTask({
    ownerId: 'sergey', title: 'Проверить Min/Max', domain: 'business'
  }, actor);

  assert.equal(store.state.tasks.get(task.id).title, 'Проверить Min/Max');
  assert.deepEqual(store.state.audit.map(event => event.action), ['task.create']);
});

test('failed audit rolls back entity write', async () => {
  const { service, store } = createService();
  store.state.failAudit = true;

  await assert.rejects(
    service.createTask({ ownerId: 'sergey', title: 'Не должна сохраниться', domain: 'business' }, actor),
    /audit unavailable/
  );
  assert.equal(store.state.tasks.size, 0);
  assert.equal(store.state.audit.length, 0);
});

test('task transition preserves external owner id and audit history', async () => {
  const { service } = createService();
  const task = await service.createTask({ ownerId: 'sergey', title: 'Ждать ответ', domain: 'business' }, actor);
  await service.transitionTask('sergey', task.id, 'in_progress', {}, actor);
  const waiting = await service.transitionTask('sergey', task.id, 'waiting', {
    waitingFor: 'разработчики Min/Max',
    nextCheckAt: '2026-08-01T09:00:00+02:00'
  }, actor);

  assert.equal(waiting.ownerId, 'sergey');
  assert.equal(waiting.status, 'waiting');
  assert.deepEqual(
    (await service.listAudit({ entityId: task.id })).map(event => event.action),
    ['task.create', 'task.transition', 'task.transition']
  );
});

test('memory upsert archives previous version in the same transaction', async () => {
  const { service, store } = createService();
  const base = {
    ownerId: 'sergey', domain: 'business', type: 'fact', key: 'miska.hours',
    sourceType: 'user', confidence: 1, sensitivity: 'normal'
  };
  await service.upsertMemory({ ...base, value: { weekdays: '09:00-19:00' } }, actor);
  const current = await service.upsertMemory({ ...base, value: { weekdays: '09:00-20:00' } }, actor);

  const records = [...store.state.memory.values()];
  assert.equal(records.filter(item => item.status === 'active').length, 1);
  assert.equal(records.filter(item => item.status === 'archived').length, 1);
  assert.deepEqual((await service.getActiveMemory('sergey', 'business', 'miska.hours')).value, current.value);
});

test('confirmation approval is atomic and rejects changed payload', async () => {
  const { service, store } = createService();
  const payload = { supplier: 'Min/Max', amount: 13500, periodMonths: 6 };
  const confirmation = await service.createConfirmation({
    ownerId: 'sergey', domain: 'finance', skillId: 'purchasing',
    actionType: 'payment.prepare', risk: 'high', payload
  }, actor);

  await assert.rejects(
    service.resolveConfirmation('sergey', confirmation.id, 'approved', { ...payload, amount: 14000 }, actor),
    /fingerprint mismatch/
  );
  assert.equal(store.state.confirmations.get(confirmation.id).status, 'pending');

  const approved = await service.resolveConfirmation('sergey', confirmation.id, 'approved', payload, actor);
  assert.equal(approved.status, 'approved');
});

test('decision superseding writes both decisions and audit events atomically', async () => {
  const { service, store } = createService();
  const first = await service.createDecision({
    ownerId: 'sergey', domain: 'purchasing', statement: 'Заказ не делать', reason: 'Некорректная выгрузка'
  }, actor);
  const replacement = await service.supersedeDecision('sergey', first.id, {
    statement: 'Повторить расчёт', reason: 'Получена корректная выгрузка'
  }, actor);

  assert.equal(store.state.decisions.get(first.id).status, 'superseded');
  assert.equal(replacement.supersedesDecisionId, first.id);
  assert.equal(store.state.audit.filter(event => event.action === 'decision.create').length, 2);
  assert.equal(store.state.audit.filter(event => event.action === 'decision.supersede').length, 1);
});
