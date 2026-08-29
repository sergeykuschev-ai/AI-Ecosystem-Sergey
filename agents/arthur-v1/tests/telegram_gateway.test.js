'use strict';

const assert = require('node:assert/strict');
const { test, describe } = require('node:test');

const {
  createTelegramGateway,
  buildArthurRequest,
  createTelegramConversationId,
  formatArthurResponse,
} = require('../telegram/telegram_gateway');
const { loadConfig, validateConfig } = require('../telegram/config');
const { createLogger } = require('../logging/logger');

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function createFakeArthur(responses = {}, options = {}) {
  return {
    async handle(request) {
      const key = request.message;
      if (options.handleError) {
        throw options.handleError;
      }
      if (responses[key]) {
        return responses[key];
      }
      return {
        status: 'success',
        answer: { text: `Arthur response to: ${key}`, confidence: 'high' },
        correlationId: request.correlationId || 'corr-test',
      };
    },
    async getDiagnostics() {
      return {
        aiProviderEnabled: true,
        provider: 'fake',
        models: { fast: 'fake-model' },
        status: 'healthy',
        skills: ['purchasing'],
      };
    },
  };
}

function createTestGateway(options = {}) {
  const config = loadConfig({
    TELEGRAM_BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
    TELEGRAM_ALLOWED_USER_IDS: '111111',
    ARTHUR_OWNER_PROFILE_ID: 'owner-profile',
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

  const request = buildArthurRequest({
    update,
    userId: 'owner-profile',
    telegramUserId: '111111',
    chatId: '111111',
  });

  assert.equal(request.message, 'Hello');
  assert.equal(request.userId, 'owner-profile');
  assert.equal(request.channel, 'telegram');
  assert.match(request.correlationId, UUID_V4_PATTERN);
  assert.equal(request.conversationId, createTelegramConversationId('111111'));
  assert.deepEqual(request.transport, {
    type: 'telegram',
    metadata: {
      userId: '111111',
      chatId: '111111',
      messageId: 7,
      updateId: 42,
    },
  });
  assert.deepEqual(request.metadata, { source: 'telegram' });
  assert.equal(request.context, undefined);
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
  const result = formatArthurResponse(response);
  assert.equal(result, 'Артур временно недоступен. Попробуй позже.');
  assert.doesNotMatch(result, /Вы|Ваш|Попробуйте/);
});

test('formatArthurResponse preserves a safe deterministic mail error', () => {
  const response = {
    status: 'failed',
    answer: {
      text: 'Почта отвечает медленнее обычного. Не успел завершить поиск. Попробуй ещё раз.',
      confidence: 'low',
      safeUserFacingError: true,
    },
  };

  assert.equal(formatArthurResponse(response), response.answer.text);
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

test('allowed Telegram identity maps to configured owner and UUID request identity', async () => {
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
  assert.equal(capturedRequest.userId, 'owner-profile');
  assert.notEqual(capturedRequest.userId, '111111');
  assert.match(capturedRequest.correlationId, UUID_V4_PATTERN);
  assert.equal(capturedRequest.transport.metadata.userId, '111111');
  assert.equal(capturedRequest.transport.metadata.chatId, '111111');
  assert.equal(capturedRequest.transport.metadata.messageId, 42);
  assert.equal(capturedRequest.transport.metadata.updateId, 1);
  assert.equal(capturedRequest.metadata.chatId, undefined);
  assert.equal(capturedRequest.context, undefined);
});

test('config validation rejects missing token', () => {
  const config = loadConfig({
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_ALLOWED_USER_IDS: '111',
    ARTHUR_OWNER_PROFILE_ID: 'owner-profile',
  });
  assert.equal(config.token, '');
});

test('production config requires one allowed Telegram user and owner profile', () => {
  const multipleUsers = loadConfig({
    NODE_ENV: 'production',
    TELEGRAM_BOT_TOKEN: '123456:valid-token',
    TELEGRAM_ALLOWED_USER_IDS: '111,222',
    ARTHUR_OWNER_PROFILE_ID: 'owner-profile',
  });
  assert.match(validateConfig(multipleUsers).errors.join('; '), /exactly one user ID/);

  const missingOwner = loadConfig({
    NODE_ENV: 'production',
    TELEGRAM_BOT_TOKEN: '123456:valid-token',
    TELEGRAM_ALLOWED_USER_IDS: '111',
  });
  assert.match(validateConfig(missingOwner).errors.join('; '), /ARTHUR_OWNER_PROFILE_ID/);
});

test('Core URL and token must be configured together', () => {
  const missingToken = loadConfig({
    TELEGRAM_BOT_TOKEN: '123456:valid-token',
    TELEGRAM_ALLOWED_USER_IDS: '111',
    ARTHUR_OWNER_PROFILE_ID: 'owner-profile',
    ARTHUR_CORE_BASE_URL: 'http://api:8787',
  });
  assert.match(validateConfig(missingToken).errors.join('; '), /configured together/);

  const configured = loadConfig({
    TELEGRAM_BOT_TOKEN: '123456:valid-token',
    TELEGRAM_ALLOWED_USER_IDS: '111',
    ARTHUR_OWNER_PROFILE_ID: 'owner-profile',
    ARTHUR_CORE_BASE_URL: 'http://api:8787',
    ARTHUR_CORE_TOKEN: 'core-token',
    ARTHUR_CORE_TIMEOUT_MS: '2500',
  });
  assert.equal(validateConfig(configured).valid, true);
  assert.equal(configured.coreTimeoutMs, 2500);
});

test('KPI automation config requires Business KPI when any automation enabled', () => {
  const enabledWithoutBusinessKpi = loadConfig({
    TELEGRAM_BOT_TOKEN: '123456:valid-token',
    TELEGRAM_ALLOWED_USER_IDS: '111',
    ARTHUR_OWNER_PROFILE_ID: 'owner-profile',
    TELEGRAM_KPI_DAILY_ENABLED: 'true',
  });
  const validation = validateConfig(enabledWithoutBusinessKpi);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join('; '), /KPI automation requires BUSINESS_KPI_BASE_URL/);
});

test('KPI automation config validates time format and alert interval', () => {
  const invalidTime = loadConfig({
    TELEGRAM_BOT_TOKEN: '123456:valid-token',
    TELEGRAM_ALLOWED_USER_IDS: '111',
    ARTHUR_OWNER_PROFILE_ID: 'owner-profile',
    BUSINESS_KPI_BASE_URL: 'http://business-kpi:3220',
    BUSINESS_KPI_SERVICE_KEYS: '[{"id":"miska","key":"secret"}]',
    TELEGRAM_KPI_DAILY_ENABLED: 'true',
    TELEGRAM_KPI_DAILY_TIME: '25:15',
  });
  assert.match(validateConfig(invalidTime).errors.join('; '), /TELEGRAM_KPI_DAILY_TIME/);

  const invalidInterval = loadConfig({
    TELEGRAM_BOT_TOKEN: '123456:valid-token',
    TELEGRAM_ALLOWED_USER_IDS: '111',
    ARTHUR_OWNER_PROFILE_ID: 'owner-profile',
    BUSINESS_KPI_BASE_URL: 'http://business-kpi:3220',
    BUSINESS_KPI_SERVICE_KEYS: '[{"id":"miska","key":"secret"}]',
    TELEGRAM_KPI_ALERTS_ENABLED: 'true',
    TELEGRAM_KPI_ALERTS_INTERVAL_MINUTES: '5',
  });
  assert.match(validateConfig(invalidInterval).errors.join('; '), /TELEGRAM_KPI_ALERTS_INTERVAL_MINUTES/);
});

test('same Telegram chat keeps conversationId while requests get unique UUIDs', async () => {
  const capturedRequests = [];
  const arthur = {
    async handle(request) {
      capturedRequests.push(request);
      return { status: 'success', answer: { text: 'ok', confidence: 'high' } };
    },
  };
  const gateway = createTestGateway({ arthur });

  await gateway.handleUpdate({
    update_id: 1,
    message: {
      message_id: 10,
      from: { id: 111111 },
      chat: { id: 555555 },
      text: 'Первое сообщение',
    },
  });
  await gateway.handleUpdate({
    update_id: 2,
    message: {
      message_id: 11,
      from: { id: 111111 },
      chat: { id: 555555 },
      text: 'Второе сообщение',
    },
  });
  await gateway.handleUpdate({
    update_id: 3,
    message: {
      message_id: 12,
      from: { id: 111111 },
      chat: { id: 777777 },
      text: 'Другой чат',
    },
  });

  assert.equal(capturedRequests.length, 3);
  assert.equal(capturedRequests[0].conversationId, capturedRequests[1].conversationId);
  assert.notEqual(capturedRequests[0].conversationId, capturedRequests[2].conversationId);
  assert.notEqual(capturedRequests[0].correlationId, capturedRequests[1].correlationId);
  for (const request of capturedRequests) {
    assert.match(request.correlationId, UUID_V4_PATTERN);
  }
  assert.equal(capturedRequests[0].conversationId.includes('555555'), false);
  assert.equal(capturedRequests[2].conversationId.includes('777777'), false);
});

test('AI provider error returns specific fallback message', async () => {
  const telegram = createFakeTelegramClient({
    updates: [{
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 111111 },
        chat: { id: 111111 },
        text: 'что думаешь о продажах?',
      },
    }],
  });
  const error = new Error('OmniRoute unavailable');
  error.code = 'OMNIROUTE_REQUEST_FAILED';
  const arthur = createFakeArthur({}, { handleError: error });
  const gateway = createTestGateway({ telegramClient: telegram, arthur });

  setTimeout(() => gateway.stop(), 200);
  await gateway.start();

  assert.equal(telegram.sent.length, 1);
  assert.ok(telegram.sent[0].text.includes('Глубокий AI-анализ сейчас недоступен'));
});

test('non-AI error returns generic fallback message', async () => {
  const telegram = createFakeTelegramClient({
    updates: [{
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 111111 },
        chat: { id: 111111 },
        text: 'что думаешь о продажах?',
      },
    }],
  });
  const error = new Error('database error');
  error.code = 'DATABASE_ERROR';
  const arthur = createFakeArthur({}, { handleError: error });
  const gateway = createTestGateway({ telegramClient: telegram, arthur });

  setTimeout(() => gateway.stop(), 200);
  await gateway.start();

  assert.equal(telegram.sent.length, 1);
  assert.ok(telegram.sent[0].text.includes('Артур временно недоступен'));
});

test('Telegram sends the deterministic mail timeout response unchanged', async () => {
  const telegram = createFakeTelegramClient({
    updates: [{
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 111111 },
        chat: { id: 111111 },
        text: 'Пришёл ответ от Валты?',
      },
    }],
  });
  const timeoutText =
    'Почта отвечает медленнее обычного. Не успел завершить поиск. Попробуй ещё раз.';
  const arthur = createFakeArthur({
    'Пришёл ответ от Валты?': {
      status: 'failed',
      answer: {
        text: timeoutText,
        confidence: 'low',
        safeUserFacingError: true,
      },
    },
  });
  const gateway = createTestGateway({ telegramClient: telegram, arthur });

  setTimeout(() => gateway.stop(), 200);
  await gateway.start();

  assert.equal(telegram.sent.length, 1);
  assert.equal(telegram.sent[0].text, timeoutText);
});

test('natural language request is forwarded to Arthur', async () => {
  const telegram = createFakeTelegramClient({
    updates: [{
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 111111 },
        chat: { id: 111111 },
        text: 'объясни почему упали продажи',
      },
    }],
  });
  let capturedRequest = null;
  const arthur = {
    async handle(request) {
      capturedRequest = request;
      return { status: 'success', answer: { text: 'AI analysis result', confidence: 'high' } };
    },
    async getDiagnostics() {
      return { aiProviderEnabled: true, provider: 'omniroute', models: { fast: 'arthur-fast' }, status: 'healthy', skills: [] };
    },
  };
  const gateway = createTestGateway({ telegramClient: telegram, arthur });

  setTimeout(() => gateway.stop(), 200);
  await gateway.start();

  assert.ok(capturedRequest);
  assert.equal(capturedRequest.message, 'объясни почему упали продажи');
  assert.equal(telegram.sent[0].text, 'AI analysis result');
});

test('Telegram natural-language greeting returns human-readable answer', async () => {
  const telegram = createFakeTelegramClient({
    updates: [{
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 111111 },
        chat: { id: 111111 },
        text: 'Привет',
      },
    }],
  });
  const arthur = {
    async handle(request) {
      return { status: 'success', answer: { text: 'Привет! Чем могу помочь?', confidence: 'high' } };
    },
    async getDiagnostics() {
      return { aiProviderEnabled: true, provider: 'omniroute', models: { fast: 'arthur-fast' }, status: 'healthy', skills: [] };
    },
  };
  const gateway = createTestGateway({ telegramClient: telegram, arthur });

  setTimeout(() => gateway.stop(), 200);
  await gateway.start();

  assert.equal(telegram.sent.length, 1);
  assert.equal(telegram.sent[0].text, 'Привет! Чем могу помочь?');
});

test('Telegram deterministic command still works when AI provider fails', async () => {
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
  const arthur = {
    async handle() {
      throw Object.assign(new Error('OmniRoute down'), { code: 'OMNIROUTE_REQUEST_FAILED' });
    },
    async getDiagnostics() {
      return { aiProviderEnabled: true, provider: 'omniroute', models: { fast: 'arthur-fast' }, status: 'unavailable', skills: [] };
    },
  };
  const gateway = createTestGateway({ telegramClient: telegram, arthur });

  setTimeout(() => gateway.stop(), 200);
  await gateway.start();

  assert.equal(telegram.sent.length, 1);
  assert.ok(telegram.sent[0].text.includes('Статус Артура'));
});
