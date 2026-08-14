'use strict';

const crypto = require('node:crypto');

function generateCorrelationId() {
  return crypto.randomUUID();
}

function generateRequestId() {
  return `req-${crypto.randomUUID()}`;
}

function generateConversationId() {
  return `conversation-${crypto.randomUUID()}`;
}

function createArthurContext(input = {}) {
  const channel = input.channel || 'unknown';
  const metadata = { ...(input.metadata || {}) };
  const transport = input.transport || metadata.transport || {};
  delete metadata.transport;

  return {
    requestId: input.requestId || generateRequestId(),
    correlationId: input.correlationId || generateCorrelationId(),
    conversationId: input.conversationId || generateConversationId(),
    userId: input.userId || null,
    channel,
    timestamp: input.timestamp || new Date().toISOString(),
    transport,
    metadata,
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
    conversationId: overrides.conversationId ?? parentContext.conversationId,
    userId: overrides.userId ?? parentContext.userId,
    channel: overrides.channel ?? parentContext.channel,
    transport: overrides.transport ?? parentContext.transport,
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
  if (!context.conversationId || typeof context.conversationId !== 'string') {
    throw new TypeError('Context must have conversationId');
  }
  return context;
}

module.exports = {
  generateCorrelationId,
  generateConversationId,
  generateRequestId,
  createArthurContext,
  withChildContext,
  validateContext,
};
