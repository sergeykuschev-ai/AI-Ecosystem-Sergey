const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createLogger } = require('../../../shared/logging/logger');

function captureConsole(method, log) {
  const original = console[method];
  const entries = [];
  console[method] = (...args) => entries.push(args);
  try {
    log();
  } finally {
    console[method] = original;
  }
  return entries;
}

function parsedEntry(method, log) {
  const entries = captureConsole(method, log);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].length, 1);
  return JSON.parse(entries[0][0]);
}

test('logger.info writes an info record through console.info', () => {
  const logger = createLogger('test-component');

  const entry = parsedEntry('info', () => logger.info('Информация'));

  assert.equal(entry.component, 'test-component');
  assert.equal(entry.level, 'info');
  assert.equal(entry.message, 'Информация');
});

test('logger.warn writes a warning record through console.warn', () => {
  const logger = createLogger('test-component');

  const entry = parsedEntry('warn', () => logger.warn('Предупреждение'));

  assert.equal(entry.component, 'test-component');
  assert.equal(entry.level, 'warn');
  assert.equal(entry.message, 'Предупреждение');
});

test('logger.error writes an error record through console.error', () => {
  const logger = createLogger('test-component');

  const entry = parsedEntry('error', () => logger.error('Ошибка'));

  assert.equal(entry.component, 'test-component');
  assert.equal(entry.level, 'error');
  assert.equal(entry.message, 'Ошибка');
});

test('logger.debug writes a debug record through console.debug', () => {
  const logger = createLogger('test-component');

  const entry = parsedEntry('debug', () => logger.debug('Диагностика'));

  assert.equal(entry.component, 'test-component');
  assert.equal(entry.level, 'debug');
  assert.equal(entry.message, 'Диагностика');
});

test('logger writes the complete record in the stable JSON format', () => {
  const logger = createLogger(' purchasing-agent ');
  const before = Date.now();

  const entry = parsedEntry('info', () => logger.info('Запуск'));
  const after = Date.now();

  assert.deepEqual(Object.keys(entry), [
    'timestamp',
    'component',
    'level',
    'message',
  ]);
  assert.equal(entry.component, 'purchasing-agent');
  assert.equal(entry.level, 'info');
  assert.equal(entry.message, 'Запуск');
  assert.match(entry.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(Date.parse(entry.timestamp) >= before);
  assert.ok(Date.parse(entry.timestamp) <= after);
});
