'use strict';

const { AIProvider } = require('./ai_provider');

class FakeAIProvider extends AIProvider {
  constructor(options = {}) {
    super({ name: 'fake-provider', capabilities: ['synthesize', 'health'] });
    this.responses = options.responses || [];
    this.responseIndex = 0;
  }

  async generate(prompt) {
    return `fake-response-${this.responseIndex++}`;
  }

  async synthesize(input, context) {
    const { skillOutputs, failures, executionStatus } = input;
    const lines = [];

    if (executionStatus === 'failed') {
      lines.push('Не удалось получить данные.');
    } else if (executionStatus === 'partial') {
      lines.push('Ответ на основе частичных данных.');
    }

    for (const output of skillOutputs || []) {
      lines.push(`[${output.skill}] ${this._formatData(output.data)}`);
    }

    for (const failure of failures || []) {
      lines.push(`[${failure.skill}] недоступно`);
    }

    const customResponse = this.responses[this.responseIndex++];
    const text = customResponse || lines.join('\n') || 'Нет данных.';

    return {
      text,
      markdown: text,
      confidence: executionStatus === 'success' ? 'high' : 'low',
      followUps: [],
    };
  }

  async health() {
    return { healthy: true, provider: this.name };
  }

  _formatData(data) {
    if (!data) return 'данные получены';
    if (typeof data.summary === 'string') return data.summary;
    if (typeof data.status === 'string') return data.status;
    return JSON.stringify(data).slice(0, 200);
  }
}

function createFakeAIProvider(options = {}) {
  return new FakeAIProvider(options);
}

module.exports = {
  FakeAIProvider,
  createFakeAIProvider,
};
