'use strict';

class MemoryInterface {
  constructor(options = {}) {
    this._entries = options.store || new Map();
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

  _key(userId, conversationId) {
    return `${userId || 'anonymous'}:${conversationId || 'default'}`;
  }
}

function createMemoryInterface(options = {}) {
  return new MemoryInterface(options);
}

module.exports = {
  MemoryInterface,
  createMemoryInterface,
};
