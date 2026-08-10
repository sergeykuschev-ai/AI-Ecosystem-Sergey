'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createOmniRouteProvider, OmniRouteProvider } = require('../ai/omniroute_provider');
const { ArthurError } = require('../errors/arthur_errors');

function createFakeFetch(responseSequence) {
  const calls = [];
  let index = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const response = responseSequence[index];
    index += 1;
    if (response instanceof Error) {
      throw response;
    }
    return response;
  };
  return { fetchImpl, calls };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function errorResponse(status, body = { error: { message: 'error' } }) {
  return jsonResponse(body, status);
}

test('OmniRouteProvider config requires baseUrl and apiKey', async () => {
  const provider = createOmniRouteProvider({ baseUrl: '', apiKey: '' });
  await assert.rejects(provider.generate('hi'), ArthurError);
});

test('OmniRouteProvider missing baseUrl throws config error', async () => {
  const provider = createOmniRouteProvider({ apiKey: 'key' });
  await assert.rejects(provider.generate('hi'), (error) => {
    assert.equal(error.code, 'OMNIROUTE_CONFIG_ERROR');
    assert.ok(error.message.includes('BASE_URL'));
    return true;
  });
});

test('OmniRouteProvider missing apiKey throws config error', async () => {
  const provider = createOmniRouteProvider({ baseUrl: 'http://omniroute:20128/v1' });
  await assert.rejects(provider.generate('hi'), (error) => {
    assert.equal(error.code, 'OMNIROUTE_CONFIG_ERROR');
    assert.ok(error.message.includes('API_KEY'));
    return true;
  });
});

test('OmniRouteProvider generate returns content', async () => {
  const { fetchImpl, calls } = createFakeFetch([
    jsonResponse({
      choices: [{ message: { content: '  generated text  ' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
  ]);
  const provider = createOmniRouteProvider({
    baseUrl: 'http://omniroute:20128/v1',
    apiKey: 'test-key',
    fetchImpl,
  });
  const result = await provider.generate('prompt');
  assert.equal(result, 'generated text');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.includes('/chat/completions'));
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'arthur-fast');
  assert.equal(body.messages[0].content, 'prompt');
});

test('OmniRouteProvider synthesize returns structured answer', async () => {
  const { fetchImpl } = createFakeFetch([
    jsonResponse({
      choices: [{ message: { content: 'Synthesized answer' } }],
      usage: { prompt_tokens: 20, completion_tokens: 10 },
    }),
  ]);
  const provider = createOmniRouteProvider({
    baseUrl: 'http://omniroute:20128/v1',
    apiKey: 'test-key',
    fetchImpl,
  });
  const result = await provider.synthesize({
    userMessage: 'Что с закупками?',
    skillOutputs: [{ skill: 'purchasing', data: { summary: 'ok' } }],
    failures: [],
    executionStatus: 'success',
  }, { correlationId: 'c1' });
  assert.equal(result.text, 'Synthesized answer');
  assert.equal(result.confidence, 'high');
  assert.deepEqual(result.usage, { prompt_tokens: 20, completion_tokens: 10 });
});

test('OmniRouteProvider extracts text from content parts array', async () => {
  const { fetchImpl } = createFakeFetch([
    jsonResponse({
      choices: [{
        message: {
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'world' },
          ],
        },
      }],
    }),
  ]);
  const provider = createOmniRouteProvider({
    baseUrl: 'http://omniroute:20128/v1',
    apiKey: 'test-key',
    fetchImpl,
  });
  const result = await provider.generate('prompt');
  assert.equal(result, 'Hello world');
});

test('OmniRouteProvider rejects empty content', async () => {
  const { fetchImpl } = createFakeFetch([
    jsonResponse({
      choices: [{ message: { content: '' } }],
    }),
  ]);
  const provider = createOmniRouteProvider({
    baseUrl: 'http://omniroute:20128/v1',
    apiKey: 'test-key',
    fetchImpl,
  });
  await assert.rejects(provider.generate('prompt'), (error) => {
    assert.equal(error.code, 'OMNIROUTE_INVALID_RESPONSE');
    return true;
  });
});

test('OmniRouteProvider health returns healthy on OK response', async () => {
  const { fetchImpl } = createFakeFetch([
    { ok: true, status: 200, text: async () => JSON.stringify({ data: [] }) },
  ]);
  const provider = createOmniRouteProvider({
    baseUrl: 'http://omniroute:20128/v1',
    apiKey: 'test-key',
    fetchImpl,
  });
  const health = await provider.health();
  assert.equal(health.healthy, true);
  assert.equal(health.provider, 'omniroute');
  assert.equal(health.models.fast, 'arthur-fast');
});

test('OmniRouteProvider health returns unhealthy on error', async () => {
  const { fetchImpl } = createFakeFetch([
    new Error('Connection refused'),
  ]);
  const provider = createOmniRouteProvider({
    baseUrl: 'http://omniroute:20128/v1',
    apiKey: 'test-key',
    fetchImpl,
  });
  const health = await provider.health();
  assert.equal(health.healthy, false);
  assert.ok(health.error);
});

test('OmniRouteProvider retries on 5xx then succeeds', async () => {
  const { fetchImpl, calls } = createFakeFetch([
    errorResponse(503),
    jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
  ]);
  const provider = createOmniRouteProvider({
    baseUrl: 'http://omniroute:20128/v1',
    apiKey: 'test-key',
    fetchImpl,
    maxRetries: 2,
  });
  const result = await provider.generate('prompt');
  assert.equal(result, 'ok');
  assert.equal(calls.length, 2);
});

test('OmniRouteProvider retries on 429', async () => {
  const { fetchImpl, calls } = createFakeFetch([
    errorResponse(429),
    jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
  ]);
  const provider = createOmniRouteProvider({
    baseUrl: 'http://omniroute:20128/v1',
    apiKey: 'test-key',
    fetchImpl,
    maxRetries: 2,
  });
  await provider.generate('prompt');
  assert.equal(calls.length, 2);
});

test('OmniRouteProvider 401 is not retryable', async () => {
  const { fetchImpl, calls } = createFakeFetch([
    errorResponse(401, { error: { message: 'Unauthorized' } }),
  ]);
  const provider = createOmniRouteProvider({
    baseUrl: 'http://omniroute:20128/v1',
    apiKey: 'test-key',
    fetchImpl,
    maxRetries: 2,
  });
  await assert.rejects(provider.generate('prompt'), (error) => {
    assert.equal(error.code, 'OMNIROUTE_UNAUTHORIZED');
    return true;
  });
  assert.equal(calls.length, 1);
});

test('OmniRouteProvider timeout is retryable', async () => {
  const error = new Error('timeout');
  error.name = 'AbortError';
  const { fetchImpl, calls } = createFakeFetch([
    error,
    jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
  ]);
  const provider = createOmniRouteProvider({
    baseUrl: 'http://omniroute:20128/v1',
    apiKey: 'test-key',
    fetchImpl,
    maxRetries: 2,
    timeoutMs: 100,
  });
  const result = await provider.generate('prompt');
  assert.equal(result, 'ok');
  assert.equal(calls.length, 2);
});

test('OmniRouteProvider redacts apiKey from error messages', async () => {
  const secretKey = 'super-secret-key-123';
  const { fetchImpl } = createFakeFetch([
    new Error(`Failed with key ${secretKey}`),
  ]);
  const provider = createOmniRouteProvider({
    baseUrl: 'http://omniroute:20128/v1',
    apiKey: secretKey,
    fetchImpl,
    maxRetries: 0,
  });
  await assert.rejects(provider.generate('prompt'), (error) => {
    assert.ok(!error.message.includes(secretKey));
    assert.ok(error.message.includes('[REDACTED]'));
    return true;
  });
});

test('OmniRouteProvider invalid response throws', async () => {
  const { fetchImpl } = createFakeFetch([
    jsonResponse({ choices: [] }),
  ]);
  const provider = createOmniRouteProvider({
    baseUrl: 'http://omniroute:20128/v1',
    apiKey: 'test-key',
    fetchImpl,
  });
  await assert.rejects(provider.generate('prompt'), (error) => {
    assert.equal(error.code, 'OMNIROUTE_INVALID_RESPONSE');
    return true;
  });
});

test('OmniRouteProvider uses fast model by default', async () => {
  const { fetchImpl, calls } = createFakeFetch([
    jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
  ]);
  const provider = createOmniRouteProvider({
    baseUrl: 'http://omniroute:20128/v1',
    apiKey: 'test-key',
    fastModel: 'arthur-fast',
    fetchImpl,
  });
  await provider.generate('prompt');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'arthur-fast');
});

test('OmniRouteProvider uses reasoning model for policy', async () => {
  const { fetchImpl, calls } = createFakeFetch([
    jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
  ]);
  const provider = createOmniRouteProvider({
    baseUrl: 'http://omniroute:20128/v1',
    apiKey: 'test-key',
    fastModel: 'fast-model',
    reasoningModel: 'reasoning-model',
    fetchImpl,
  });
  await provider.generate('prompt', { policy: 'reasoning' });
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'reasoning-model');
});

test('OmniRouteProvider uses code model for policy', async () => {
  const { fetchImpl, calls } = createFakeFetch([
    jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
  ]);
  const provider = createOmniRouteProvider({
    baseUrl: 'http://omniroute:20128/v1',
    apiKey: 'test-key',
    codeModel: 'code-model',
    fetchImpl,
  });
  await provider.generate('prompt', { policy: 'code' });
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'code-model');
});

test('OmniRouteProvider explicit model overrides policy', async () => {
  const { fetchImpl, calls } = createFakeFetch([
    jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
  ]);
  const provider = createOmniRouteProvider({
    baseUrl: 'http://omniroute:20128/v1',
    apiKey: 'test-key',
    fastModel: 'fast-model',
    fetchImpl,
  });
  await provider.generate('prompt', { model: 'explicit-model' });
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'explicit-model');
});

test('OmniRouteProvider reads config from environment', async () => {
  const originalEnv = process.env;
  process.env = {
    OMNIROUTE_BASE_URL: 'http://env-omniroute/v1',
    OMNIROUTE_API_KEY: 'env-key',
    OMNIROUTE_FAST_MODEL: 'env-fast',
    OMNIROUTE_REASONING_MODEL: 'env-reasoning',
    OMNIROUTE_CODE_MODEL: 'env-code',
  };
  try {
    const provider = createOmniRouteProvider();
    assert.equal(provider.baseUrl, 'http://env-omniroute/v1');
    assert.equal(provider.apiKey, 'env-key');
    assert.equal(provider.models.fast, 'env-fast');
    assert.equal(provider.models.reasoning, 'env-reasoning');
    assert.equal(provider.models.code, 'env-code');
  } finally {
    process.env = originalEnv;
  }
});
