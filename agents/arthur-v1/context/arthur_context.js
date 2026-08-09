'use strict';

const crypto = require('node:crypto');

function generateCorrelationId(channel = 'unknown') {
  return `arthur-${channel}-${crypto.randomUUID()}`;
}

function generateRequestId() {
  return `req-${crypto.randomUUID()}`;
}

function createArthurContext(input = {}) {
  const channel = input.channel || 'unknown';
  return {
    requestId: input.requestId || generateRequestId(),
    correlationId: input.correlationId || generateCorrelationId(channel),
    userId: input.userId || null,
    channel,
    timestamp: input.timestamp || new Date().toISOString(),
    metadata: input.metadata || {},
  };
}

function withChildContext(parentContext, overrides = {}) {
  if (!parentContext || typeof parentContext !== 'object') {
    throw new TypeError('Parent context must be an object');
  }
  return {
    ...parentContext,
    ...overrides,
    correlationId: parentContext.correlationId,
    userId: overrides.userId ?? parentContext.userId,
    channel: overrides.channel ?? parentContext.channel,
  };
}

function validateContext(context) {
  if (!context || typeof context !== 'object') {
    throw new TypeError('Context must be an object');
  }
  if (!context.correlationId || typeof context.correlationId !== 'string') {
    throw new TypeError('Context must have correlationId');
  }
  if (!context.requestId || typeof context.requestId !== 'string') {
    throw new TypeError('Context must have requestId');
  }
  return context;
}

module.exports = {
  generateCorrelationId,
  generateRequestId,
  createArthurContext,
  withChildContext,
  validateContext,
};
