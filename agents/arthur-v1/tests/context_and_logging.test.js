'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createArthurContext, withChildContext, validateContext, generateCorrelationId } = require('../context/arthur_context');
const { createLogger } = require('../logging/logger');
const { hasSensitiveKey, sanitizePayload } = require('../logging/logger');

test('createArthurContext generates required fields', () => {
  const ctx = createArthurContext({ userId: 'sergey', channel: 'telegram' });
  assert.equal(ctx.userId, 'sergey');
  assert.equal(ctx.channel, 'telegram');
  assert.ok(ctx.requestId.startsWith('req-'));
  assert.ok(ctx.correlationId.startsWith('arthur-telegram-'));
  assert.ok(ctx.timestamp);
});

test('withChildContext preserves correlationId', () => {
  const parent = createArthurContext({ userId: 'sergey', channel: 'telegram' });
  const child = withChildContext(parent, { requestId: 'child-req' });
  assert.equal(child.correlationId, parent.correlationId);
  assert.equal(child.requestId, 'child-req');
  assert.equal(child.userId, 'sergey');
});

test('validateContext rejects missing correlationId', () => {
  assert.throws(() => validateContext({ requestId: 'x' }), TypeError);
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
