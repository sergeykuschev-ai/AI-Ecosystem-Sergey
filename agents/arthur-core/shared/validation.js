'use strict';

const {
  DOMAINS,
  MEMORY_TYPES,
  MEMORY_STATUSES,
  SENSITIVITY_LEVELS,
  TASK_STATUSES,
  TASK_PRIORITIES,
  ACTOR_TYPES,
  AUDIT_RESULTS
} = require('./constants');

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function assertString(value, name, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function assertEnum(value, allowed, name) {
  if (!allowed.includes(value)) {
    throw new RangeError(`${name} must be one of: ${allowed.join(', ')}`);
  }
}

function assertOptionalIsoDate(value, name) {
  if (value == null) return;
  assertString(value, name);
  if (Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${name} must be an ISO date`);
  }
}

function validateDomain(domain) {
  assertEnum(domain, DOMAINS, 'domain');
  return domain;
}

function validateProfile(input) {
  assertObject(input, 'profile');
  assertString(input.id, 'profile.id');
  assertString(input.name, 'profile.name');
  assertString(input.timezone, 'profile.timezone');
  assertString(input.locale, 'profile.locale');
  if (input.preferredChannel != null) assertString(input.preferredChannel, 'profile.preferredChannel');
  if (input.active != null && typeof input.active !== 'boolean') {
    throw new TypeError('profile.active must be boolean');
  }
  return input;
}

function validateMemoryRecord(input) {
  assertObject(input, 'memory');
  assertString(input.ownerId, 'memory.ownerId');
  validateDomain(input.domain);
  assertEnum(input.type, MEMORY_TYPES, 'memory.type');
  assertString(input.key, 'memory.key');
  if (!Object.prototype.hasOwnProperty.call(input, 'value')) {
    throw new TypeError('memory.value is required');
  }
  assertString(input.sourceType, 'memory.sourceType');
  if (input.sourceRef != null) assertString(input.sourceRef, 'memory.sourceRef');
  if (typeof input.confidence !== 'number' || input.confidence < 0 || input.confidence > 1) {
    throw new RangeError('memory.confidence must be between 0 and 1');
  }
  assertOptionalIsoDate(input.validFrom, 'memory.validFrom');
  assertOptionalIsoDate(input.validTo, 'memory.validTo');
  assertEnum(input.status || 'active', MEMORY_STATUSES, 'memory.status');
  assertEnum(input.sensitivity || 'normal', SENSITIVITY_LEVELS, 'memory.sensitivity');
  return input;
}

function validateTask(input) {
  assertObject(input, 'task');
  assertString(input.ownerId, 'task.ownerId');
  assertString(input.title, 'task.title');
  validateDomain(input.domain);
  assertEnum(input.priority || 'normal', TASK_PRIORITIES, 'task.priority');
  assertEnum(input.status || 'new', TASK_STATUSES, 'task.status');
  assertOptionalIsoDate(input.dueAt, 'task.dueAt');
  assertOptionalIsoDate(input.nextCheckAt, 'task.nextCheckAt');

  if ((input.status || 'new') === 'waiting') {
    assertString(input.waitingFor, 'task.waitingFor');
    if (!input.nextCheckAt) throw new TypeError('task.nextCheckAt is required for waiting status');
  }
  return input;
}

function validateAuditEvent(input) {
  assertObject(input, 'audit');
  assertString(input.actorId, 'audit.actorId');
  assertEnum(input.actorType, ACTOR_TYPES, 'audit.actorType');
  validateDomain(input.domain);
  assertString(input.action, 'audit.action');
  assertString(input.entityType, 'audit.entityType');
  assertString(input.entityId, 'audit.entityId');
  assertString(input.correlationId, 'audit.correlationId');
  assertEnum(input.result, AUDIT_RESULTS, 'audit.result');
  return input;
}

module.exports = {
  validateDomain,
  validateProfile,
  validateMemoryRecord,
  validateTask,
  validateAuditEvent
};
