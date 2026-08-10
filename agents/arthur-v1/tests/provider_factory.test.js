'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  createAIProviderFromEnv,
  getProviderDiagnostics,
  SUPPORTED_PROVIDERS,
} = require('../ai/provider_factory');
const { FakeAIProvider } = require('../ai/fake_provider');
const { OmniRouteProvider } = require('../ai/omniroute_provider');

test('factory returns fake provider by default', () => {
  const provider = createAIProviderFromEnv({});
  assert.ok(provider instanceof FakeAIProvider);
});

test('factory returns fake provider for explicit fake', () => {
  const provider = createAIProviderFromEnv({ ARTHUR_AI_PROVIDER: 'fake' });
  assert.ok(provider instanceof FakeAIProvider);
});

test('factory returns OmniRouteProvider for omniroute', () => {
  const provider = createAIProviderFromEnv({
    ARTHUR_AI_PROVIDER: 'omniroute',
    OMNIROUTE_BASE_URL: 'http://omniroute:20128/v1',
    OMNIROUTE_API_KEY: 'key',
    OMNIROUTE_FAST_MODEL: 'arthur-fast',
  });
  assert.ok(provider instanceof OmniRouteProvider);
  assert.equal(provider.baseUrl, 'http://omniroute:20128/v1');
  assert.equal(provider.models.fast, 'arthur-fast');
});

test('factory passes options override', () => {
  const provider = createAIProviderFromEnv({
    ARTHUR_AI_PROVIDER: 'omniroute',
    OMNIROUTE_BASE_URL: 'http://omniroute:20128/v1',
    OMNIROUTE_API_KEY: 'key',
  }, { fastModel: 'override-fast', reasoningModel: 'override-reasoning' });
  assert.equal(provider.models.fast, 'override-fast');
  assert.equal(provider.models.reasoning, 'override-reasoning');
});

test('diagnostics reports fake provider', () => {
  const diag = getProviderDiagnostics({});
  assert.equal(diag.provider, SUPPORTED_PROVIDERS.FAKE);
  assert.equal(diag.configured, true);
  assert.equal(diag.baseUrl, null);
  assert.equal(diag.models.fast, null);
});

test('diagnostics reports omniroute configured', () => {
  const diag = getProviderDiagnostics({
    ARTHUR_AI_PROVIDER: 'omniroute',
    OMNIROUTE_BASE_URL: 'http://omniroute:20128/v1',
    OMNIROUTE_API_KEY: 'key',
    OMNIROUTE_FAST_MODEL: 'arthur-fast',
    OMNIROUTE_REASONING_MODEL: 'arthur-fast',
    OMNIROUTE_CODE_MODEL: 'arthur-fast',
  });
  assert.equal(diag.provider, SUPPORTED_PROVIDERS.OMNIRoute);
  assert.equal(diag.configured, true);
  assert.equal(diag.baseUrl, 'http://omniroute:20128/v1');
  assert.equal(diag.models.fast, 'arthur-fast');
  assert.equal(diag.models.reasoning, 'arthur-fast');
  assert.equal(diag.models.code, 'arthur-fast');
});

test('diagnostics reports omniroute not configured when missing key', () => {
  const diag = getProviderDiagnostics({
    ARTHUR_AI_PROVIDER: 'omniroute',
    OMNIROUTE_BASE_URL: 'http://omniroute:20128/v1',
  });
  assert.equal(diag.configured, false);
});
