'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createDirectModelRouter } = require('../ai/direct_model_router');
const { createAIProviderFromEnv, getProviderDiagnostics } = require('../ai/provider_factory');

function mockFetch(calls) {
  return async (url, request) => {
    calls.push({ url, request });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: 'Ответ Артура' } }],
        usage: { prompt_tokens: 12, completion_tokens: 5 },
      }),
    };
  };
}

test('routes ordinary requests to DeepSeek Flash and code to GLM without sharing keys', async () => {
  const calls = [];
  const router = createDirectModelRouter({
    deepseekApiKey: 'deepseek-secret',
    glmApiKey: 'glm-secret',
    fetchImpl: mockFetch(calls),
  });

  assert.equal(await router.generate('Привет'), 'Ответ Артура');
  assert.equal(await router.generate('Проверь код', { policy: 'code' }), 'Ответ Артура');
  assert.equal(await router.generate('Сложный анализ', { policy: 'reasoning' }), 'Ответ Артура');

  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(JSON.parse(calls[0].request.body).model, 'deepseek-flash');
  assert.equal(calls[0].request.headers.Authorization, 'Bearer deepseek-secret');
  assert.equal(calls[1].url, 'https://api.z.ai/api/paas/v4/chat/completions');
  assert.equal(JSON.parse(calls[1].request.body).model, 'glm-5.3');
  assert.equal(JSON.parse(calls[1].request.body).temperature, 1);
  assert.equal(calls[1].request.headers.Authorization, 'Bearer glm-secret');
  assert.equal(calls[2].url, calls[1].url);
  assert.equal(calls[0].request.body.includes('glm-secret'), false);
  assert.equal(calls[1].request.body.includes('deepseek-secret'), false);
});

test('routes synthesis to inexpensive DeepSeek unless explicitly requested otherwise', async () => {
  const calls = [];
  const router = createDirectModelRouter({
    deepseekApiKey: 'ds',
    glmApiKey: 'zai',
    fetchImpl: mockFetch(calls),
  });
  const input = { userMessage: 'Статус?', skillOutputs: [], failures: [], executionStatus: 'success' };
  const cheap = await router.synthesize(input, {});
  const strong = await router.synthesize({ ...input, policy: 'reasoning' }, {});
  assert.equal(cheap.text, 'Ответ Артура');
  assert.equal(strong.text, 'Ответ Артура');
  assert.deepEqual(cheap.usage, { prompt_tokens: 12, completion_tokens: 5 });
  assert.ok(calls[0].url.includes('deepseek.com'));
  assert.ok(calls[1].url.includes('z.ai'));
  assert.equal(JSON.parse(calls[1].request.body).temperature, 1);
});

test('missing API keys fail closed; unknown policy never triggers an API call', async () => {
  const calls = [];
  const router = createDirectModelRouter({ fetchImpl: mockFetch(calls) });
  await assert.rejects(router.generate('hi'), error => error.code === 'DIRECT_AI_CONFIG_ERROR');
  await assert.rejects(router.generate('hi', { policy: 'code' }), error => error.code === 'DIRECT_AI_CONFIG_ERROR');
  await assert.rejects(router.generate('hi', { policy: 'unknown' }), error => error.code === 'DIRECT_AI_INVALID_POLICY');
  assert.equal(calls.length, 0);
});

test('factory opts in only when explicitly configured and never reports keys', async () => {
  const env = {
    ARTHUR_AI_PROVIDER: 'deepseek-glm',
    DEEPSEEK_API_KEY: 'private-ds-key',
    ZAI_API_KEY: 'private-zai-key',
    ARTHUR_AI_BUDGET_DIR: require('node:path').join(require('node:os').tmpdir(), 'arthur-budget-test-not-used'),
  };
  const router = createAIProviderFromEnv(env);
  assert.equal(router.name, 'deepseek-glm');
  const diagnostics = getProviderDiagnostics(env);
  assert.equal(diagnostics.configured, true);
  assert.equal(diagnostics.models.fast, 'deepseek-flash');
  assert.equal(diagnostics.models.code, 'glm-5.3');
  assert.ok(!JSON.stringify(diagnostics).includes('private-ds-key'));
  assert.ok(!JSON.stringify(diagnostics).includes('private-zai-key'));
  assert.equal(getProviderDiagnostics({ ARTHUR_AI_PROVIDER: 'deepseek-glm' }).configured, false);
});

test('health exposes separate DeepSeek and GLM status', async () => {
  const router = createDirectModelRouter({
    deepseekApiKey: 'ds',
    glmApiKey: 'zai',
    fetchImpl: async () => ({ ok: true }),
  });
  const result = await router.health();
  assert.equal(result.healthy, true);
  assert.deepEqual(result.providers, { deepseek: true, glm: true });
});
