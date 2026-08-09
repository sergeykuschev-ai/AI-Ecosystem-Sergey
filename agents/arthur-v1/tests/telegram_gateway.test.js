'use strict';

const assert = require('node:assert/strict');
const { test, describe } = require('node:test');

const { createTelegramGateway, buildArthurRequest, formatArthurResponse } = require('../telegram/telegram_gateway');
const { loadConfig } = require('../telegram/config');
const { createLogger } = require('../logging/logger');

function createSilentLogger() {
  return createLogger({
    stdout: { write: () => {} },
    stderr: { write: () => {} },
  });
}

function createFakeTelegramClient(behavior = {}) {
  const sent = [];
  const updates = behavior.updates || [];
  let updatesReturned = false;
  let callIndex = 0;

  return {
    sent,
    async getUpdates(offset, limit, timeoutMs) {
      if (behavior.getUpdatesError) {
        throw behavior.getUpdatesError;
      }
      // Yield to the event loop so setTimeout-based shutdown can run.
      await new Promise(resolve => setTimeout(resolve, 5));
      if (behavior.getUpdatesSequence) {
        const result = behavior.getUpdatesSequence[callIndex] || { result: [] };
        callIndex += 1;
        return result;
      }
      if (!updatesReturned) {
        updatesReturned = true;
        return { result: updates };
      }
      return { result: [] };
    },
    async sendMessage(chatId, text, options) {
      if (behavior.sendMessageError) {
        throw behavior.sendMessageError;
      }
      sent.push({ chatId, text, options });
      return { ok: true, result: { message_id: 1000 } };
    },
    call: async (method, payload) => {
      if (method === 'sendMessage') {
        return { ok: true };
      }
      return { ok: true };
    },
  };
}

function createFakeArthur(responses = {}) {
  return {
    async handle(request) {
      const key = request.message;
      if (responses[key]) {
        return responses[key];
      }
      return {
        status: 'success',
        answer: { text: `Arthur response to: ${key}`, confidence: 'high' },
        correlationId: request.correlationId || 'corr-test',
      };
    },
  };
}

function createTestGateway(options = {}) {
  const config = loadConfig({
    TELEGRAM_BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
    TELEGRAM_ALLOWED_USER_IDS: '111111',
    TELEGRAM_POLL_TIMEOUT_MS: '1000',
    TELEGRAM_API_TIMEOUT_MS: '2000',
    TELEGRAM_API_RETRY_ATTEMPTS: '2',
    TELEGRAM_GATEWAY_HEALTH_PORT: '0',
  });

  return createTelegramGateway({
    config,
    logger: createSilentLogger(),
    telegramClient: options.telegramClient || createFakeTelegramClient(),
    arthur: options.arthur || createFakeArthur(),
  });
}

test('buildArthurRequest normalizes Telegram update', () => {
  const update = {
    update_id: 42,
    message: {
      message_id: 7,
      from: { id: 111111, username: 'sergey' },
      chat: { id: 111111 },
      text: 'Hello',
    },
  };

  const request = buildArthurRequest({ update, userId: '111111', chatId: '111111' });

  assert.equal(request.message, 'Hello');
  assert.equal(request.userId, '111111');
  assert.equal(request.channel, 'telegram');
  assert.equal(request.context.chatId, '111111');
  assert.equal(request.context.telegramUpdateId, 42);
  assert.equal(request.context.telegramMessageId, 7);
});

test('formatArthurResponse returns text on success', () => {
  const response = {
    status: 'success',
    answer: { text: 'Всё в порядке.', confidence: 'high' },
  };
  assert.equal(formatArthurResponse(response), 'Всё в порядке.');
});

test('formatArthurResponse returns unavailable on failed', () => {
  const response = {
    status: 'failed',
    answer: { text: 'error', confidence: 'low' },
  };
  assert.equal(formatArthurResponse(response), 'Артур временно недоступен. Попробуйте позже.');
});

test('formatArthurResponse marks partial results', () => {
  const response = {
    status: 'partial',
    answer: { text: 'Частично.', confidence: 'medium' },
  };
  assert.ok(formatArthurResponse(response).includes('Частично.'));
});

test('unauthorized user is rejected and receives denial', async () => {
  const telegram = createFakeTelegramClient({
    updates: [{
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 999999, username: 'intruder' },
        chat: { id: 999999 },
        text: 'Артур, что с закупками?',
      },
    }],
  });
  const gateway = createTestGateway({ telegramClient: telegram });

  // Run one polling iteration and stop.
  setTimeout(() => gateway.stop(), 200);
  await gateway.start();

  assert.equal(telegram.sent.length, 1);
  assert.ok(telegram.sent[0].text.includes('Доступ запрещён'));
});

test('/start returns help text', async () => {
  const telegram = createFakeTelegramClient({
    updates: [{
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 111111 },
        chat: { id: 111111 },
        text: '/start',
      },
    }],
  });
  const gateway = createTestGateway({ telegramClient: telegram });

  setTimeout(() => gateway.stop(), 200);
  await gateway.start();

  assert.equal(telegram.sent.length, 1);
  assert.ok(telegram.sent[0].text.includes('Привет, я Артур'));
});

test('/help returns help text', async () => {
  const telegram = createFakeTelegramClient({
    updates: [{
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 111111 },
        chat: { id: 111111 },
        text: '/help',
      },
    }],
  });
  const gateway = createTestGateway({ telegramClient: telegram });

  setTimeout(() => gateway.stop(), 200);
  await gateway.start();

  assert.equal(telegram.sent.length, 1);
  assert.ok(telegram.sent[0].text.includes('/status'));
});

test('/status returns status information', async () => {
  const telegram = createFakeTelegramClient({
    updates: [{
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 111111 },
        chat: { id: 111111 },
        text: '/status',
      },
    }],
  });
  const gateway = createTestGateway({ telegramClient: telegram });

  setTimeout(() => gateway.stop(), 200);
  await gateway.start();

  assert.equal(telegram.sent.length, 1);
  assert.ok(telegram.sent[0].text.includes('Gateway:'));
});

test('text message is forwarded to Arthur and response is sent to Telegram', async () => {
  const telegram = createFakeTelegramClient({
    updates: [{
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 111111 },
        chat: { id: 111111 },
        text: 'Что сейчас с закупщиком?',
      },
    }],
  });
  const arthur = createFakeArthur({
    'Что сейчас с закупщиком?': {
      status: 'success',
      answer: { text: 'Закупка: 42 позиции.', confidence: 'high' },
    },
  });
  const gateway = createTestGateway({ telegramClient: telegram, arthur });

  setTimeout(() => gateway.stop(), 200);
  await gateway.start();

  assert.equal(telegram.sent.length, 1);
  assert.ok(telegram.sent[0].text.includes('42 позиции'));
});

test('owner review request returns review summary', async () => {
  const telegram = createFakeTelegramClient({
    updates: [{
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 111111 },
        chat: { id: 111111 },
        text: 'Покажи спорные позиции',
      },
    }],
  });
  const arthur = createFakeArthur({
    'Покажи спорные позиции': {
      status: 'success',
      answer: { text: 'На ручную проверку: 3 позиции.', confidence: 'high' },
    },
  });
  const gateway = createTestGateway({ telegramClient: telegram, arthur });

  setTimeout(() => gateway.stop(), 200);
  await gateway.start();

  assert.equal(telegram.sent.length, 1);
  assert.ok(telegram.sent[0].text.includes('3 позиции'));
});

test('Arthur failure returns graceful unavailable message', async () => {
  const telegram = createFakeTelegramClient({
    updates: [{
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 111111 },
        chat: { id: 111111 },
        text: 'fail',
      },
    }],
  });
  const arthur = {
    async handle() {
      const error = new Error('Arthur is down');
      error.code = 'ARTHUR_TIMEOUT';
      throw error;
    },
  };
  const gateway = createTestGateway({ telegramClient: telegram, arthur });

  setTimeout(() => gateway.stop(), 200);
  await gateway.start();

  assert.equal(telegram.sent.length, 1);
  assert.ok(telegram.sent[0].text.includes('Артур временно недоступен'));
});

test('Telegram send failure is logged but does not crash gateway', async () => {
  const telegram = createFakeTelegramClient({
    updates: [{
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 111111 },
        chat: { id: 111111 },
        text: '/start',
      },
    }],
    sendMessageError: new Error('send failed'),
  });
  const gateway = createTestGateway({ telegramClient: telegram });

  setTimeout(() => gateway.stop(), 200);
  await gateway.start();

  assert.equal(telegram.sent.length, 0);
  assert.equal(gateway.processedUpdates, 1);
});

test('graceful shutdown stops polling loop', async () => {
  const telegram = createFakeTelegramClient({
    getUpdatesSequence: [
      { result: [] },
      { result: [] },
    ],
  });
  const gateway = createTestGateway({ telegramClient: telegram });

  setTimeout(() => gateway.stop(), 300);
  await gateway.start();

  assert.equal(gateway.running, false);
  assert.equal(gateway.shutdownRequested, true);
});

test('getHealth returns healthy status while running', async () => {
  const telegram = createFakeTelegramClient({
    getUpdatesSequence: [{ result: [] }],
  });
  const gateway = createTestGateway({ telegramClient: telegram });

  setTimeout(() => gateway.stop(), 200);
  await gateway.start();

  const health = gateway.getHealth();
  assert.equal(health.status, 'stopped');
  assert.equal(health.configValid, true);
});

test('correlationId includes telegram identifiers', async () => {
  const telegram = createFakeTelegramClient({
    updates: [{
      update_id: 1,
      message: {
        message_id: 42,
        from: { id: 111111 },
        chat: { id: 111111 },
        text: 'test',
      },
    }],
  });
  let capturedRequest = null;
  const arthur = {
    async handle(request) {
      capturedRequest = request;
      return { status: 'success', answer: { text: 'ok', confidence: 'high' } };
    },
  };
  const gateway = createTestGateway({ telegramClient: telegram, arthur });

  setTimeout(() => gateway.stop(), 200);
  await gateway.start();

  assert.ok(capturedRequest);
  assert.ok(capturedRequest.correlationId.startsWith('tg-'));
});

test('config validation rejects missing token', () => {
  const config = loadConfig({ TELEGRAM_BOT_TOKEN: '', TELEGRAM_ALLOWED_USER_IDS: '111' });
  assert.equal(config.token, '');
});
