'use strict';

const DEFAULT_PENDING_TASK_CLARIFICATION_TTL_MS = 5 * 60 * 1000;
const DEFAULT_PENDING_MAIL_ACTION_TTL_MS = 10 * 60 * 1000;
const PENDING_KINDS = Object.freeze({
  MAIL_TASK_CREATION: 'mailTaskCreation',
  TASK_CLARIFICATION: 'taskClarification',
});

class MemoryInterface {
  constructor(options = {}) {
    this._entries = options.store || new Map();
    this._pendingActions = options.pendingActionStore || options.pendingTaskStore || new Map();
    this._clock = options.clock || (() => new Date());
    this._pendingTaskClarificationTtlMs = options.pendingTaskClarificationTtlMs
      ?? DEFAULT_PENDING_TASK_CLARIFICATION_TTL_MS;
    this._pendingMailActionTtlMs = options.pendingMailActionTtlMs
      ?? DEFAULT_PENDING_MAIL_ACTION_TTL_MS;
  }

  async load(userId, conversationId) {
    const key = this._key(userId, conversationId);
    return this._entries.get(key) || [];
  }

  async store(userId, conversationId, entry) {
    const key = this._key(userId, conversationId);
    const existing = this._entries.get(key) || [];
    existing.push(entry);
    this._entries.set(key, existing);
    return true;
  }

  async clear(userId, conversationId) {
    const key = this._key(userId, conversationId);
    this._entries.delete(key);
    return true;
  }

  async storePendingTaskClarification(ownerId, conversationId, pending) {
    return this._storePendingAction(ownerId, conversationId, {
      kind: PENDING_KINDS.TASK_CLARIFICATION,
      ownerId,
      conversationId,
      action: pending.action,
      operation: pending.operation,
      candidates: (pending.candidates || []).map(candidate => ({
        id: candidate.id,
        title: candidate.title,
        status: candidate.status,
        dueAt: candidate.dueAt || null,
      })),
      parameters: { ...(pending.parameters || {}) },
    }, this._pendingTaskClarificationTtlMs);
  }

  async loadPendingTaskClarification(ownerId, conversationId) {
    return this._loadPendingAction(ownerId, conversationId, PENDING_KINDS.TASK_CLARIFICATION);
  }

  async clearPendingTaskClarification(ownerId, conversationId) {
    this._clearPendingAction(ownerId, conversationId, PENDING_KINDS.TASK_CLARIFICATION);
    return true;
  }

  async storePendingMailAction(ownerId, conversationId, pending) {
    const candidates = (pending.candidates || []).map(candidate => ({
      mailboxId: candidate.mailboxId,
      sourceRef: candidate.sourceRef,
      title: candidate.title,
      subject: candidate.subject,
      sender: candidate.sender,
      companyAliasId: candidate.companyAliasId || null,
      companyDisplayName: candidate.companyDisplayName || null,
      ...(candidate.dueAt ? { dueAt: candidate.dueAt } : {}),
      ...(candidate.dueLabel ? { dueLabel: candidate.dueLabel } : {}),
    }));
    return this._storePendingAction(ownerId, conversationId, {
      kind: PENDING_KINDS.MAIL_TASK_CREATION,
      ownerId,
      conversationId,
      action: 'createTaskFromMail',
      candidates,
    }, this._pendingMailActionTtlMs);
  }

  async loadPendingMailAction(ownerId, conversationId) {
    return this._loadPendingAction(
      ownerId,
      conversationId,
      PENDING_KINDS.MAIL_TASK_CREATION,
      { returnExpired: true }
    );
  }

  async clearPendingMailAction(ownerId, conversationId) {
    this._clearPendingAction(ownerId, conversationId, PENDING_KINDS.MAIL_TASK_CREATION);
    return true;
  }

  _storePendingAction(ownerId, conversationId, pending, ttlMs) {
    const now = this._now();
    const record = {
      ...pending,
      ownerId,
      conversationId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };
    this._pendingActions.set(this._key(ownerId, conversationId), record);
    return this._clonePending(record);
  }

  _loadPendingAction(ownerId, conversationId, kind, { returnExpired = false } = {}) {
    const key = this._key(ownerId, conversationId);
    const pending = this._pendingActions.get(key);
    if (!pending || pending.kind !== kind) return null;
    if (new Date(pending.expiresAt).getTime() <= this._now().getTime()) {
      this._pendingActions.delete(key);
      return returnExpired ? { ...this._clonePending(pending), expired: true } : null;
    }
    return { ...this._clonePending(pending), expired: false };
  }

  _clearPendingAction(ownerId, conversationId, kind) {
    const key = this._key(ownerId, conversationId);
    if (this._pendingActions.get(key)?.kind === kind) this._pendingActions.delete(key);
  }

  _clonePending(pending) {
    return {
      ...pending,
      candidates: (pending.candidates || []).map(candidate => ({ ...candidate })),
      ...(pending.parameters ? { parameters: { ...pending.parameters } } : {}),
    };
  }

  _now() {
    const value = this._clock();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new TypeError('Memory clock must return a valid date');
    return date;
  }

  _key(userId, conversationId) {
    return `${userId || 'anonymous'}:${conversationId || 'default'}`;
  }
}

function createMemoryInterface(options = {}) {
  return new MemoryInterface(options);
}

module.exports = {
  DEFAULT_PENDING_MAIL_ACTION_TTL_MS,
  DEFAULT_PENDING_TASK_CLARIFICATION_TTL_MS,
  PENDING_KINDS,
  MemoryInterface,
  createMemoryInterface,
};
