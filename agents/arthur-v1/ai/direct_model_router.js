'use strict';

const { AIProvider } = require('./ai_provider');
const { createOmniRouteProvider } = require('./omniroute_provider');
const { ArthurError } = require('../errors/arthur_errors');

const DEFAULT_MODELS = Object.freeze({
  fast: 'deepseek-flash',
  reasoning: 'glm-5.3',
  code: 'glm-5.3',
});

class DirectModelRouter extends AIProvider {
  constructor(options = {}) {
    super({ name: 'deepseek-glm', capabilities: ['generate', 'synthesize', 'health'] });

    const fastModel = options.deepseekModel || DEFAULT_MODELS.fast;
    const strongModel = options.glmModel || DEFAULT_MODELS.code;
    this.models = { fast: fastModel, reasoning: strongModel, code: strongModel };
    this.deepseekConfigured = Boolean(options.deepseekApiKey);
    this.glmConfigured = Boolean(options.glmApiKey);
    this.fastProvider = createOmniRouteProvider({
      useProcessEnv: false,
      baseUrl: 'https://api.deepseek.com',
      apiKey: options.deepseekApiKey || '',
      fastModel,
      maxRetries: options.maxRetries ?? 0,
      fetchImpl: options.deepseekFetchImpl || options.fetchImpl,
      timeoutMs: options.timeoutMs,
    });
    this.strongProvider = createOmniRouteProvider({
      useProcessEnv: false,
      baseUrl: 'https://api.z.ai/api/paas/v4',
      apiKey: options.glmApiKey || '',
      fastModel: strongModel,
      generateTemperature: 1,
      synthesisTemperature: 1,
      maxRetries: options.maxRetries ?? 0,
      fetchImpl: options.glmFetchImpl || options.fetchImpl,
      timeoutMs: options.timeoutMs,
    });
  }

  _select(policy = 'fast') {
    if (policy === 'fast') {
      if (!this.deepseekConfigured) {
        throw new ArthurError('DIRECT_AI_CONFIG_ERROR', 'DEEPSEEK_API_KEY is required');
      }
      return this.fastProvider;
    }
    if (policy === 'reasoning' || policy === 'code') {
      if (!this.glmConfigured) {
        throw new ArthurError('DIRECT_AI_CONFIG_ERROR', 'ZAI_API_KEY is required for strong models');
      }
      return this.strongProvider;
    }
    throw new ArthurError('DIRECT_AI_INVALID_POLICY', 'Unsupported AI model policy');
  }

  async generate(prompt, options = {}) {
    const provider = this._select(options.policy || 'fast');
    return provider.generate(prompt, {
      ...options,
      model: provider.models.fast,
      policy: 'fast',
    });
  }

  async synthesize(input = {}, context) {
    const provider = this._select(input.policy || 'fast');
    return provider.synthesize({
      ...input,
      model: provider.models.fast,
      policy: 'fast',
    }, context);
  }

  async health() {
    const [fast, strong] = await Promise.all([
      this.deepseekConfigured ? this.fastProvider.health() : { healthy: false },
      this.glmConfigured ? this.strongProvider.health() : { healthy: false },
    ]);
    return {
      provider: this.name,
      healthy: Boolean(fast.healthy && strong.healthy),
      models: this.models,
      providers: { deepseek: Boolean(fast.healthy), glm: Boolean(strong.healthy) },
    };
  }
}

function createDirectModelRouter(options = {}) {
  return new DirectModelRouter(options);
}

module.exports = { DirectModelRouter, createDirectModelRouter, DEFAULT_MODELS };
