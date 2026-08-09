'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { AIProvider, ModelRouter, MODEL_POLICIES, createModelRouter } = require('../ai/ai_provider');
const { FakeAIProvider, createFakeAIProvider } = require('../ai/fake_provider');
const { ArthurError } = require('../errors/arthur_errors');

test('AIProvider base class throws not implemented', async () => {
  const provider = new AIProvider();
  await assert.rejects(provider.generate('prompt'), ArthurError);
  await assert.rejects(provider.synthesize({}), ArthurError);
});

test('FakeAIProvider synthesizes from skill outputs', async () => {
  const provider = createFakeAIProvider();
  const result = await provider.synthesize({
    skillOutputs: [{ skill: 'kpi', data: { summary: 'Sales down 23%' } }],
    failures: [],
    executionStatus: 'success',
  }, { correlationId: 'c1' });
  assert.ok(result.text.includes('kpi'));
  assert.equal(result.confidence, 'high');
});

test('FakeAIProvider returns low confidence on partial results', async () => {
  const provider = createFakeAIProvider();
  const result = await provider.synthesize({
    skillOutputs: [{ skill: 'kpi', data: {} }],
    failures: [{ skill: 'sales', status: 'error' }],
    executionStatus: 'partial',
  }, { correlationId: 'c1' });
  assert.equal(result.confidence, 'low');
});

test('ModelRouter registers and resolves providers', async () => {
  const router = createModelRouter();
  const fast = createFakeAIProvider({ responses: ['fast answer'] });
  router.register(MODEL_POLICIES.FAST, fast);
  const result = await router.synthesize({ skillOutputs: [], failures: [], executionStatus: 'success' }, {}, MODEL_POLICIES.FAST);
  assert.equal(result.text, 'fast answer');
});

test('ModelRouter throws for unregistered policy', async () => {
  const router = createModelRouter();
  await assert.rejects(
    router.synthesize({ skillOutputs: [], failures: [], executionStatus: 'success' }),
    ArthurError
  );
});

test('FakeAIProvider health returns healthy', async () => {
  const provider = createFakeAIProvider();
  const health = await provider.health();
  assert.equal(health.healthy, true);
});
