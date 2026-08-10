'use strict';

const { createFakeAIProvider } = require('./fake_provider');
const { createOmniRouteProvider } = require('./omniroute_provider');

const SUPPORTED_PROVIDERS = Object.freeze({
  FAKE: 'fake',
  OMNIRoute: 'omniroute',
});

function detectProviderName(env = process.env) {
  const name = (env.ARTHUR_AI_PROVIDER || SUPPORTED_PROVIDERS.FAKE).toLowerCase();
  return name;
}

function createAIProviderFromEnv(env = process.env, options = {}) {
  const name = detectProviderName(env);

  if (name === SUPPORTED_PROVIDERS.OMNIRoute) {
    return createOmniRouteProvider({
      baseUrl: env.OMNIROUTE_BASE_URL,
      apiKey: env.OMNIROUTE_API_KEY,
      fastModel: env.OMNIROUTE_FAST_MODEL,
      reasoningModel: env.OMNIROUTE_REASONING_MODEL,
      codeModel: env.OMNIROUTE_CODE_MODEL,
      ...options,
    });
  }

  return createFakeAIProvider(options);
}

function getProviderDiagnostics(env = process.env) {
  const name = detectProviderName(env);
  return {
    provider: name,
    configured: name === SUPPORTED_PROVIDERS.OMNIRoute
      ? Boolean(env.OMNIROUTE_BASE_URL && env.OMNIROUTE_API_KEY)
      : true,
    baseUrl: env.OMNIROUTE_BASE_URL || null,
    models: {
      fast: env.OMNIROUTE_FAST_MODEL || null,
      reasoning: env.OMNIROUTE_REASONING_MODEL || null,
      code: env.OMNIROUTE_CODE_MODEL || null,
    },
  };
}

module.exports = {
  SUPPORTED_PROVIDERS,
  detectProviderName,
  createAIProviderFromEnv,
  getProviderDiagnostics,
};
