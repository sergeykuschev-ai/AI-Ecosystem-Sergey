'use strict';

const { randomUUID } = require('node:crypto');

function clone(value) {
  return value == null ? value : structuredClone(value);
}

class InMemoryArthurStore {
  constructor() {
    this.profiles = new Map();
    this.memory = new Map();
    this.tasks = new Map();
    this.decisions = new Map();
    this.confirmations = new Map();
    this.auditEvents = [];
  }

  nextId() {
    return randomUUID();
  }

  get(collection, id) {
    return clone(this[collection].get(id) || null);
  }

  put(collection, record) {
    this[collection].set(record.id, clone(record));
    return clone(record);
  }

  list(collection, predicate = () => true) {
    return [...this[collection].values()].filter(predicate).map(clone);
  }

  appendAudit(event) {
    this.auditEvents.push(clone(event));
    return clone(event);
  }

  listAudit(predicate = () => true) {
    return this.auditEvents.filter(predicate).map(clone);
  }
}

module.exports = { InMemoryArthurStore };
