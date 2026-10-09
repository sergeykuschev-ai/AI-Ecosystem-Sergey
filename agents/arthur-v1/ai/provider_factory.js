'use strict';

const { createFakeAIProvider } = require('./fake_provider');
const { createOmniRouteProvider } = require('./omniroute_provider');
const { createDirectModelRouter, DEFAULT_MODELS } = require('./direct_model_router');
const { guardedFetch, limitsFromEnv } = require('./paid_ai_budget');
const { LocalOllamaProvider, AuthFallbackProvider } = require('./local_fallback_provider');

const SUPPORTED_PROVIDERS = Object.freeze({
  FAKE: 'fake',
  OMNIRoute: 'omniroute',
  DIRECT: 'deepseek-glm',
});

function detectProviderName(env = process.env) {
  const name = (env.ARTHUR_AI_PROVIDER || SUPPORTED_PROVIDERS.FAKE).toLowerCase();
  return name;
}

function createAIProviderFromEnv(env = process.env, options = {}) {
  const name = detectProviderName(env);

  if (name === SUPPORTED_PROVIDERS.OMNIRoute) {
    const primary = createOmniRouteProvider({
      baseUrl: env.OMNIROUTE_BASE_URL,
      apiKey: env.OMNIROUTE_API_KEY,
      fastModel: env.OMNIROUTE_FAST_MODEL,
      reasoningModel: env.OMNIROUTE_REASONING_MODEL,
      codeModel: env.OMNIROUTE_CODE_MODEL,
      ...options,
    });
    if (env.ARTHUR_OLLAMA_FALLBACK_ENABLED !== 'true') return primary;
    const fallback = new LocalOllamaProvider({
      baseUrl: env.ARTHUR_OLLAMA_URL,
      model: env.ARTHUR_OLLAMA_MODEL || 'qwen2.5:3b',
      timeoutMs: Number(env.ARTHUR_OLLAMA_TIMEOUT_MS || 80000),
      logger: options.logger,
    });
    return new AuthFallbackProvider({primary,fallback,logger:options.logger});
  }

  if (name === SUPPORTED_PROVIDERS.DIRECT) {
    // Direct API is fail-closed if the persistent budget ledger is not mounted.
    if (!env.ARTHUR_AI_BUDGET_DIR) {
      throw new Error('ARTHUR_AI_BUDGET_DIR is mandatory for paid AI');
    }
    const limits = limitsFromEnv(env);
    const paidFetch = (provided) => guardedFetch({
      directory: env.ARTHUR_AI_BUDGET_DIR, limits, fetchImpl: provided || fetch,
    });
    const primary = createDirectModelRouter({
      deepseekApiKey: env.DEEPSEEK_API_KEY,
      glmApiKey: env.ZAI_API_KEY,
      deepseekModel: env.DEEPSEEK_MODEL,
      glmModel: env.ZAI_MODEL,
      ...options,
      deepseekFetchImpl: paidFetch(options.deepseekFetchImpl || options.fetchImpl),
      glmFetchImpl: paidFetch(options.glmFetchImpl || options.fetchImpl),
    });
    if (env.ARTHUR_OLLAMA_FALLBACK_ENABLED !== 'true') return primary;
    const fallback = new LocalOllamaProvider({
      baseUrl: env.ARTHUR_OLLAMA_URL,
      model: env.ARTHUR_OLLAMA_MODEL || 'qwen2.5:3b',
      timeoutMs: Number(env.ARTHUR_OLLAMA_TIMEOUT_MS || 80000),
      logger: options.logger,
    });
    return new AuthFallbackProvider({primary,fallback,logger:options.logger});
  }
  return createFakeAIProvider(options);
}

function getProviderDiagnostics(env = process.env) {
  const name = detectProviderName(env);
  if (name === SUPPORTED_PROVIDERS.DIRECT) {
    return {
      provider: name,
      configured: Boolean(env.DEEPSEEK_API_KEY && env.ZAI_API_KEY),
      baseUrl: null,
      models: {
        fast: env.DEEPSEEK_MODEL || DEFAULT_MODELS.fast,
        reasoning: env.ZAI_MODEL || DEFAULT_MODELS.reasoning,
        code: env.ZAI_MODEL || DEFAULT_MODELS.code,
      },
    };
  }
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
