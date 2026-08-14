'use strict';

const DEFAULT_PENDING_TASK_CLARIFICATION_TTL_MS = 5 * 60 * 1000;

class MemoryInterface {
  constructor(options = {}) {
    this._entries = options.store || new Map();
    this._pendingTaskClarifications = options.pendingTaskStore || new Map();
    this._clock = options.clock || (() => new Date());
    this._pendingTaskClarificationTtlMs = options.pendingTaskClarificationTtlMs
      ?? DEFAULT_PENDING_TASK_CLARIFICATION_TTL_MS;
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
    const key = this._key(ownerId, conversationId);
    const now = this._now();
    const record = {
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
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this._pendingTaskClarificationTtlMs).toISOString(),
    };
    this._pendingTaskClarifications.set(key, record);
    return { ...record, candidates: record.candidates.map(candidate => ({ ...candidate })) };
  }

  async loadPendingTaskClarification(ownerId, conversationId) {
    const key = this._key(ownerId, conversationId);
    const pending = this._pendingTaskClarifications.get(key);
    if (!pending) return null;
    if (new Date(pending.expiresAt).getTime() <= this._now().getTime()) {
      this._pendingTaskClarifications.delete(key);
      return null;
    }
    return {
      ...pending,
      candidates: pending.candidates.map(candidate => ({ ...candidate })),
      parameters: { ...pending.parameters },
    };
  }

  async clearPendingTaskClarification(ownerId, conversationId) {
    this._pendingTaskClarifications.delete(this._key(ownerId, conversationId));
    return true;
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
  DEFAULT_PENDING_TASK_CLARIFICATION_TTL_MS,
  MemoryInterface,
  createMemoryInterface,
};
