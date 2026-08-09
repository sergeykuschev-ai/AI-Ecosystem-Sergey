'use strict';

const { ArthurError } = require('../errors/arthur_errors');

const MODEL_POLICIES = Object.freeze({
  FAST: 'fast',
  STRONG: 'strong',
  LOCAL: 'local',
});

class AIProvider {
  constructor(options = {}) {
    this.name = options.name || 'base-provider';
    this.capabilities = options.capabilities || [];
  }

  async generate(prompt, options = {}) {
    throw new ArthurError(
      'NOT_IMPLEMENTED',
      `generate() not implemented for ${this.name}`
    );
  }

  async synthesize(input, context) {
    throw new ArthurError(
      'NOT_IMPLEMENTED',
      `synthesize() not implemented for ${this.name}`
    );
  }

  async health() {
    return { healthy: false, provider: this.name };
  }

  getCapabilities() {
    return [...this.capabilities];
  }
}

class ModelRouter {
  constructor(options = {}) {
    this.providers = new Map();
    this.defaultPolicy = options.defaultPolicy || MODEL_POLICIES.FAST;
  }

  register(policy, provider) {
    if (!Object.values(MODEL_POLICIES).includes(policy)) {
      throw new ArthurError('INVALID_POLICY', `Unknown policy: ${policy}`);
    }
    if (!(provider instanceof AIProvider)) {
      throw new ArthurError('INVALID_PROVIDER', 'Provider must extend AIProvider');
    }
    this.providers.set(policy, provider);
  }

  resolve(policy) {
    const resolved = policy || this.defaultPolicy;
    const provider = this.providers.get(resolved);
    if (!provider) {
      throw new ArthurError(
        'PROVIDER_NOT_FOUND',
        `No provider registered for policy: ${resolved}`
      );
    }
    return provider;
  }

  async synthesize(input, context, policy) {
    const provider = this.resolve(policy);
    return provider.synthesize(input, context);
  }
}

function createAIProvider(options = {}) {
  return new AIProvider(options);
}

function createModelRouter(options = {}) {
  return new ModelRouter(options);
}

module.exports = {
  AIProvider,
  ModelRouter,
  MODEL_POLICIES,
  createAIProvider,
  createModelRouter,
};
