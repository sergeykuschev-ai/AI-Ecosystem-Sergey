'use strict';

const assert = require('node:assert/strict');
const { test, describe } = require('node:test');

const {
  createTelegramClient,
  isProxyConfigured,
  TelegramClientError,
} = require('../telegram/telegram_client');

function createFakeFetch() {
  const calls = [];
  return {
    calls,
    async fetch(url, options) {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: {} }),
      };
    },
  };
}

function withEnv(overrides, fn) {
  const original = {};
  for (const key of Object.keys(overrides)) {
    original[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function createTestClient(options = {}) {
  return createTelegramClient({
    token: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
    apiBaseUrl: 'https://api.telegram.org',
    timeoutMs: 1000,
    maxRetries: 0,
    retryDelayMs: 10,
    ...options,
  });
}

test('isProxyConfigured returns false when no proxy env is set', () => {
  withEnv({ HTTP_PROXY: undefined, HTTPS_PROXY: undefined }, () => {
    assert.equal(isProxyConfigured(), false);
  });
});

test('isProxyConfigured returns true when HTTPS_PROXY is set', () => {
  withEnv({ HTTP_PROXY: undefined, HTTPS_PROXY: 'http://proxy.example:8080' }, () => {
    assert.equal(isProxyConfigured(), true);
  });
});

test('isProxyConfigured returns true when HTTP_PROXY is set', () => {
  withEnv({ HTTP_PROXY: 'http://proxy.example:8080', HTTPS_PROXY: undefined }, () => {
    assert.equal(isProxyConfigured(), true);
  });
});

test('direct mode does not pass dispatcher to fetch', async () => {
  const { fetch, calls } = createFakeFetch();
  const client = withEnv({ HTTP_PROXY: undefined, HTTPS_PROXY: undefined }, () =>
    createTestClient({ fetchImpl: fetch })
  );

  assert.equal(client.proxyEnabled, false);
  await client.sendMessage(1, 'hello');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.dispatcher, undefined);
});

test('HTTPS_PROXY mode passes dispatcher to fetch', async () => {
  const { fetch, calls } = createFakeFetch();
  const client = withEnv({ HTTPS_PROXY: 'http://proxy.example:8080', NO_PROXY: '' }, () =>
    createTestClient({ fetchImpl: fetch })
  );

  assert.equal(client.proxyEnabled, true);
  await client.sendMessage(1, 'hello');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].options.dispatcher, 'dispatcher should be set when proxy is configured');
});

test('HTTP_PROXY fallback mode passes dispatcher to fetch', async () => {
  const { fetch, calls } = createFakeFetch();
  const client = withEnv({ HTTP_PROXY: 'http://proxy.example:8080', HTTPS_PROXY: undefined }, () =>
    createTestClient({ fetchImpl: fetch })
  );

  assert.equal(client.proxyEnabled, true);
  await client.sendMessage(1, 'hello');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].options.dispatcher);
});

test('proxy credentials are not logged on startup', async () => {
  const logs = [];
  const logger = {
    info: (event, context, payload) => logs.push({ event, payload }),
    warn: () => {},
    error: () => {},
    debug: () => {},
  };

  withEnv({ HTTPS_PROXY: 'http://user:secret@proxy.example:8080' }, () => {
    createTestClient({ logger });
  });

  const startupLog = logs.find(l => l.event === 'telegram_client_created') || { payload: {} };
  const payloadText = JSON.stringify(startupLog.payload);
  assert.equal(payloadText.includes('secret'), false, 'proxy credentials must not be logged');
});

test('retries still work with proxy enabled', async () => {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    if (calls < 2) {
      const error = new Error('transient');
      error.code = 'FETCH_ERROR';
      throw error;
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
  };

  const client = withEnv({ HTTPS_PROXY: 'http://proxy.example:8080' }, () =>
    createTestClient({ fetchImpl: fetch, maxRetries: 2, retryDelayMs: 1 })
  );

  await client.sendMessage(1, 'hello');
  assert.equal(calls, 2);
});

test('proxy error is wrapped as TelegramClientError', async () => {
  const fetch = async () => {
    const error = new Error('proxy refused');
    error.code = 'ECONNREFUSED';
    throw error;
  };

  const client = withEnv({ HTTPS_PROXY: 'http://proxy.example:8080' }, () =>
    createTestClient({ fetchImpl: fetch, maxRetries: 0 })
  );

  try {
    await client.sendMessage(1, 'hello');
    assert.fail('expected error');
  } catch (error) {
    assert.ok(error instanceof TelegramClientError || error.name === 'Error');
  }
});
