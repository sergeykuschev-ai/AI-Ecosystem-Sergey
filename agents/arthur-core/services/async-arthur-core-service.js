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

class AsyncArthurCoreService {
  constructor({ store, clock = () => new Date(), idFactory = randomUUID } = {}) {
    if (!store || typeof store.transaction !== 'function') {
      throw new TypeError('transactional async store is required');
    }
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

  async audit(store, { context, domain, action, entityType, entityId, before = null, after = null }) {
    return store.appendAudit({
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
      result: 'success',
      createdAt: this.now()
    });
  }

  async createProfile(input, actorContext) {
    validateProfile(input);
    const context = this.context(actorContext);
    const now = this.now();
    const record = { ...input, active: input.active !== false, createdAt: now, updatedAt: now };
    return this.store.transaction(async store => {
      await store.putProfile(record);
      await this.audit(store, {
        context,
        domain: 'personal',
        action: 'profile.create',
        entityType: 'profile',
        entityId: record.id,
        after: record
      });
      return record;
    });
  }

  async getProfile(id) {
    return this.store.getProfile(id);
  }

  async updateProfile(id, patch, actorContext) {
    const context = this.context(actorContext);
    return this.store.transaction(async store => {
      const before = await store.getProfile(id);
      if (!before) throw new Error('Profile not found');
      const after = { ...before, ...patch, id, updatedAt: this.now() };
      validateProfile(after);
      await store.putProfile(after);
      await this.audit(store, {
        context,
        domain: 'personal',
        action: 'profile.update',
        entityType: 'profile',
        entityId: id,
        before,
        after
      });
      return after;
    });
  }

  async upsertMemory(input, actorContext) {
    validateMemoryRecord(input);
    const context = this.context(actorContext);
    return this.store.transaction(async store => {
      const now = this.now();
      const archived = await store.archiveActiveMemory(input.ownerId, input.domain, input.key, now);
      const record = {
        ...input,
        id: input.id || this.idFactory(),
        status: input.status || 'active',
        validFrom: input.validFrom || now,
        createdAt: now,
        updatedAt: now
      };
      await store.putMemory(record);
      await this.audit(store, {
        context,
        domain: input.domain,
        action: 'memory.upsertVersion',
        entityType: 'memory',
        entityId: record.id,
        before: archived,
        after: record
      });
      return record;
    });
  }

  async getActiveMemory(ownerId, domain, key) {
    validateDomain(domain);
    const record = await this.store.getActiveMemory(ownerId, domain, key);
    return record ? { ...record, ownerId } : null;
  }

  async createTask(input, actorContext) {
    validateTask(input);
    const context = this.context(actorContext);
    const now = this.now();
    const record = {
      ...input,
      id: input.id || this.idFactory(),
      status: input.status || 'new',
      priority: input.priority || 'normal',
      createdAt: now,
      updatedAt: now
    };
    return this.store.transaction(async store => {
      await store.putTask(record);
      await this.audit(store, {
        context,
        domain: record.domain,
        action: 'task.create',
        entityType: 'task',
        entityId: record.id,
        after: record
      });
      return record;
    });
  }

  async getTask(ownerId, id) {
    const record = await this.store.getTask(id);
    return record ? { ...record, ownerId } : null;
  }

  async transitionTask(ownerId, id, nextStatus, patch = {}, actorContext) {
    const context = this.context(actorContext);
    return this.store.transaction(async store => {
      const stored = await store.getTask(id);
      if (!stored) throw new Error('Task not found');
      const before = { ...stored, ownerId };
      assertTaskTransition(before.status, nextStatus, patch);
      const after = { ...before, ...patch, status: nextStatus, updatedAt: this.now() };
      validateTask(after);
      await store.putTask(after);
      await this.audit(store, {
        context,
        domain: after.domain,
        action: 'task.transition',
        entityType: 'task',
        entityId: id,
        before,
        after
      });
      return after;
    });
  }

  async createDecision(input, actorContext) {
    requireString(input.ownerId, 'decision.ownerId');
    requireString(input.domain, 'decision.domain');
    validateDomain(input.domain);
    requireString(input.statement, 'decision.statement');
    requireString(input.reason, 'decision.reason');
    const context = this.context(actorContext);
    const now = this.now();
    const record = {
      ...input,
      id: input.id || this.idFactory(),
      status: input.status || 'active',
      createdAt: now,
      updatedAt: now
    };
    if (!DECISION_STATUSES.includes(record.status)) throw new RangeError('Invalid decision status');
    return this.store.transaction(async store => {
      await store.putDecision(record);
      await this.audit(store, {
        context,
        domain: record.domain,
        action: 'decision.create',
        entityType: 'decision',
        entityId: record.id,
        after: record
      });
      return record;
    });
  }

  async supersedeDecision(ownerId, id, replacementInput, actorContext) {
    const context = this.context(actorContext);
    return this.store.transaction(async store => {
      const stored = await store.getDecision(id);
      if (!stored) throw new Error('Decision not found');
      const before = { ...stored, ownerId };
      const old = { ...before, status: 'superseded', updatedAt: this.now() };
      await store.putDecision(old);

      requireString(replacementInput.statement, 'decision.statement');
      requireString(replacementInput.reason, 'decision.reason');
      const now = this.now();
      const replacement = {
        ...replacementInput,
        ownerId,
        domain: replacementInput.domain || before.domain,
        id: replacementInput.id || this.idFactory(),
        status: 'active',
        supersedesDecisionId: id,
        createdAt: now,
        updatedAt: now
      };
      validateDomain(replacement.domain);
      await store.putDecision(replacement);
      await this.audit(store, {
        context,
        domain: before.domain,
        action: 'decision.supersede',
        entityType: 'decision',
        entityId: id,
        before,
        after: old
      });
      await this.audit(store, {
        context,
        domain: replacement.domain,
        action: 'decision.create',
        entityType: 'decision',
        entityId: replacement.id,
        after: replacement
      });
      return replacement;
    });
  }

  async createConfirmation(input, actorContext) {
    requireString(input.ownerId, 'confirmation.ownerId');
    validateDomain(input.domain);
    requireString(input.skillId, 'confirmation.skillId');
    requireString(input.actionType, 'confirmation.actionType');
    if (!CONFIRMATION_RISKS.includes(input.risk)) throw new RangeError('Invalid confirmation risk');
    const context = this.context(actorContext);
    const now = this.now();
    const record = {
      ...input,
      id: input.id || this.idFactory(),
      status: 'pending',
      payloadFingerprint: createPayloadFingerprint(input.payload),
      createdAt: now,
      updatedAt: now
    };
    return this.store.transaction(async store => {
      await store.putConfirmation(record);
      await this.audit(store, {
        context,
        domain: record.domain,
        action: 'confirmation.create',
        entityType: 'confirmation',
        entityId: record.id,
        after: record
      });
      return record;
    });
  }

  async resolveConfirmation(ownerId, id, status, payload, actorContext) {
    if (!['approved', 'rejected'].includes(status)) {
      throw new RangeError('Confirmation can only be approved or rejected');
    }
    const context = this.context(actorContext);
    return this.store.transaction(async store => {
      const stored = await store.getConfirmation(id);
      if (!stored) throw new Error('Confirmation not found');
      const before = { ...stored, ownerId };
      if (before.status !== 'pending') throw new Error('Confirmation is not pending');
      if (status === 'approved' && !verifyPayloadFingerprint(payload, before.payloadFingerprint)) {
        throw new Error('Confirmation payload fingerprint mismatch');
      }
      const after = { ...before, status, resolvedAt: this.now(), updatedAt: this.now() };
      if (!CONFIRMATION_STATUSES.includes(after.status)) throw new RangeError('Invalid confirmation status');
      await store.putConfirmation(after);
      await this.audit(store, {
        context,
        domain: after.domain,
        action: `confirmation.${status}`,
        entityType: 'confirmation',
        entityId: id,
        before,
        after
      });
      return after;
    });
  }

  async listAudit(filter = {}) {
    return this.store.listAudit(filter);
  }
}

module.exports = { AsyncArthurCoreService };
