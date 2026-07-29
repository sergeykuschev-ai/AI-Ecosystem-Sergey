'use strict';

const { randomUUID } = require('node:crypto');
const {
  validateProfile,
  validateMemoryRecord,
  validateTask,
  validateDomain
} = require('../shared/validation');
const { assertTaskTransition } = require('../tasks/transitions');
const {
  createPayloadFingerprint,
  verifyPayloadFingerprint
} = require('../confirmations/fingerprint');
const {
  DECISION_STATUSES,
  CONFIRMATION_RISKS,
  CONFIRMATION_STATUSES
} = require('../shared/constants');

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

class ArthurCoreService {
  constructor({ store, clock = () => new Date(), idFactory = randomUUID } = {}) {
    if (!store) throw new TypeError('store is required');
    this.store = store;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  now() {
    return this.clock().toISOString();
  }

  context(input = {}) {
    return {
      actorId: input.actorId || 'system',
      actorType: input.actorType || 'system',
      correlationId: input.correlationId || this.idFactory()
    };
  }

  audit({ context, domain, action, entityType, entityId, before = null, after = null, result = 'success', error = null }) {
    return this.store.appendAudit({
      id: this.idFactory(),
      actorId: context.actorId,
      actorType: context.actorType,
      domain,
      action,
      entityType,
      entityId,
      before,
      after,
      correlationId: context.correlationId,
      result,
      error,
      createdAt: this.now()
    });
  }

  createProfile(input, actorContext) {
    validateProfile(input);
    const context = this.context(actorContext);
    const record = { ...input, createdAt: this.now(), updatedAt: this.now() };
    this.store.put('profiles', record);
    this.audit({ context, domain: 'personal', action: 'profile.create', entityType: 'profile', entityId: record.id, after: record });
    return record;
  }

  getProfile(id) {
    return this.store.get('profiles', id);
  }

  updateProfile(id, patch, actorContext) {
    const before = this.getProfile(id);
    if (!before) throw new Error('Profile not found');
    const after = { ...before, ...patch, id, updatedAt: this.now() };
    validateProfile(after);
    const context = this.context(actorContext);
    this.store.put('profiles', after);
    this.audit({ context, domain: 'personal', action: 'profile.update', entityType: 'profile', entityId: id, before, after });
    return after;
  }

  upsertMemory(input, actorContext) {
    validateMemoryRecord(input);
    const context = this.context(actorContext);
    const active = this.store.list('memory', item => item.ownerId === input.ownerId && item.domain === input.domain && item.key === input.key && item.status === 'active');
    for (const previous of active) {
      this.store.put('memory', { ...previous, status: 'archived', validTo: this.now(), updatedAt: this.now() });
    }
    const record = { ...input, id: input.id || this.idFactory(), status: input.status || 'active', createdAt: this.now(), updatedAt: this.now() };
    this.store.put('memory', record);
    this.audit({ context, domain: input.domain, action: 'memory.upsertVersion', entityType: 'memory', entityId: record.id, before: active, after: record });
    return record;
  }

  getActiveMemory(ownerId, domain, key) {
    validateDomain(domain);
    return this.store.list('memory', item => item.ownerId === ownerId && item.domain === domain && item.key === key && item.status === 'active')[0] || null;
  }

  createTask(input, actorContext) {
    validateTask(input);
    const context = this.context(actorContext);
    const record = { ...input, id: input.id || this.idFactory(), status: input.status || 'new', priority: input.priority || 'normal', createdAt: this.now(), updatedAt: this.now() };
    this.store.put('tasks', record);
    this.audit({ context, domain: input.domain, action: 'task.create', entityType: 'task', entityId: record.id, after: record });
    return record;
  }

  transitionTask(id, nextStatus, patch = {}, actorContext) {
    const before = this.store.get('tasks', id);
    if (!before) throw new Error('Task not found');
    assertTaskTransition(before.status, nextStatus, patch);
    const after = { ...before, ...patch, status: nextStatus, updatedAt: this.now() };
    validateTask(after);
    const context = this.context(actorContext);
    this.store.put('tasks', after);
    this.audit({ context, domain: after.domain, action: 'task.transition', entityType: 'task', entityId: id, before, after });
    return after;
  }

  createDecision(input, actorContext) {
    requireString(input.ownerId, 'decision.ownerId');
    requireString(input.domain, 'decision.domain');
    validateDomain(input.domain);
    requireString(input.statement, 'decision.statement');
    requireString(input.reason, 'decision.reason');
    const context = this.context(actorContext);
    const record = { ...input, id: input.id || this.idFactory(), status: input.status || 'active', createdAt: this.now() };
    if (!DECISION_STATUSES.includes(record.status)) throw new RangeError('Invalid decision status');
    this.store.put('decisions', record);
    this.audit({ context, domain: input.domain, action: 'decision.create', entityType: 'decision', entityId: record.id, after: record });
    return record;
  }

  supersedeDecision(id, replacementInput, actorContext) {
    const before = this.store.get('decisions', id);
    if (!before) throw new Error('Decision not found');
    const context = this.context(actorContext);
    const old = { ...before, status: 'superseded', updatedAt: this.now() };
    this.store.put('decisions', old);
    const replacement = this.createDecision({ ...replacementInput, supersedesDecisionId: id }, context);
    this.audit({ context, domain: before.domain, action: 'decision.supersede', entityType: 'decision', entityId: id, before, after: old });
    return replacement;
  }

  createConfirmation(input, actorContext) {
    requireString(input.ownerId, 'confirmation.ownerId');
    validateDomain(input.domain);
    requireString(input.skillId, 'confirmation.skillId');
    requireString(input.actionType, 'confirmation.actionType');
    if (!CONFIRMATION_RISKS.includes(input.risk)) throw new RangeError('Invalid confirmation risk');
    const context = this.context(actorContext);
    const record = {
      ...input,
      id: input.id || this.idFactory(),
      status: 'pending',
      payloadFingerprint: createPayloadFingerprint(input.payload),
      createdAt: this.now(),
      updatedAt: this.now()
    };
    this.store.put('confirmations', record);
    this.audit({ context, domain: input.domain, action: 'confirmation.create', entityType: 'confirmation', entityId: record.id, after: record });
    return record;
  }

  resolveConfirmation(id, status, payload, actorContext) {
    if (!['approved', 'rejected'].includes(status)) throw new RangeError('Confirmation can only be approved or rejected');
    const before = this.store.get('confirmations', id);
    if (!before) throw new Error('Confirmation not found');
    if (before.status !== 'pending') throw new Error('Confirmation is not pending');
    if (status === 'approved' && !verifyPayloadFingerprint(payload, before.payloadFingerprint)) {
      throw new Error('Confirmation payload fingerprint mismatch');
    }
    const after = { ...before, status, resolvedAt: this.now(), updatedAt: this.now() };
    if (!CONFIRMATION_STATUSES.includes(after.status)) throw new RangeError('Invalid confirmation status');
    const context = this.context(actorContext);
    this.store.put('confirmations', after);
    this.audit({ context, domain: after.domain, action: `confirmation.${status}`, entityType: 'confirmation', entityId: id, before, after });
    return after;
  }

  listAudit(filter = {}) {
    return this.store.listAudit(event => Object.entries(filter).every(([key, value]) => event[key] === value));
  }
}

module.exports = { ArthurCoreService };
