'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createArthurContext, withChildContext, validateContext, generateCorrelationId } = require('../context/arthur_context');
const { createLogger } = require('../logging/logger');
const { hasSensitiveKey, sanitizePayload } = require('../logging/logger');

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test('createArthurContext generates required fields', () => {
  const ctx = createArthurContext({
    userId: 'sergey',
    channel: 'telegram',
    transport: { type: 'telegram', metadata: { userId: '111111' } },
  });
  assert.equal(ctx.userId, 'sergey');
  assert.equal(ctx.channel, 'telegram');
  assert.ok(ctx.requestId.startsWith('req-'));
  assert.match(ctx.correlationId, UUID_V4_PATTERN);
  assert.ok(ctx.conversationId.startsWith('conversation-'));
  assert.notEqual(ctx.conversationId, ctx.correlationId);
  assert.deepEqual(ctx.transport, { type: 'telegram', metadata: { userId: '111111' } });
  assert.ok(ctx.timestamp);
});

test('withChildContext preserves request, conversation and transport identity', () => {
  const parent = createArthurContext({ userId: 'sergey', channel: 'telegram' });
  const child = withChildContext(parent, { requestId: 'child-req' });
  assert.equal(child.correlationId, parent.correlationId);
  assert.equal(child.conversationId, parent.conversationId);
  assert.equal(child.transport, parent.transport);
  assert.equal(child.requestId, 'child-req');
  assert.equal(child.userId, 'sergey');
});

test('validateContext rejects missing correlationId', () => {
  assert.throws(() => validateContext({ requestId: 'x' }), TypeError);
});

test('validateContext rejects missing conversationId', () => {
  assert.throws(() => validateContext({ requestId: 'x', correlationId: 'corr' }), TypeError);
});

test('hasSensitiveKey detects secret-like keys', () => {
  assert.equal(hasSensitiveKey('apiKey'), true);
  assert.equal(hasSensitiveKey('password'), true);
  assert.equal(hasSensitiveKey('userName'), false);
});

test('sanitizePayload redacts secrets', () => {
  const payload = { user: 'sergey', apiKey: 'secret123', nested: { token: 'abc' } };
  const sanitized = sanitizePayload(payload);
  assert.equal(sanitized.user, 'sergey');
  assert.equal(sanitized.apiKey, '[REDACTED]');
  assert.equal(sanitized.nested.token, '[REDACTED]');
});

test('logger writes structured JSON records', () => {
  const lines = [];
  const logger = createLogger({
    stdout: { write: (line) => lines.push(line) },
  });
  const ctx = createArthurContext({ userId: 'sergey', channel: 'test' });
  logger.info('test_event', ctx, { skill: 'purchasing' });

  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.level, 'info');
  assert.equal(record.event, 'test_event');
  assert.equal(record.correlationId, ctx.correlationId);
  assert.equal(record.skill, 'purchasing');
});
