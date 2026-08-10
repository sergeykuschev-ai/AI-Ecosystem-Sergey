'use strict';

const { AIProvider } = require('./ai_provider');
const { ArthurError } = require('../errors/arthur_errors');

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_FAST_MODEL = 'arthur-fast';
const DEFAULT_MAX_TOKENS = 2048;

class OmniRouteProvider extends AIProvider {
  constructor(options = {}) {
    super({
      name: 'omniroute',
      capabilities: ['generate', 'synthesize', 'health'],
    });
    this.baseUrl = (options.baseUrl || process.env.OMNIROUTE_BASE_URL || '').replace(/\/+$/, '');
    this.apiKey = options.apiKey || process.env.OMNIROUTE_API_KEY || '';
    this.models = {
      fast: options.fastModel || process.env.OMNIROUTE_FAST_MODEL || DEFAULT_FAST_MODEL,
      reasoning: options.reasoningModel || process.env.OMNIROUTE_REASONING_MODEL || DEFAULT_FAST_MODEL,
      code: options.codeModel || process.env.OMNIROUTE_CODE_MODEL || DEFAULT_FAST_MODEL,
    };
    this.defaultModelPolicy = options.defaultModelPolicy || 'fast';
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.fetchImpl = options.fetchImpl || fetch;
  }

  _resolveModel(options = {}) {
    if (options.model) return options.model;
    const policy = options.policy || this.defaultModelPolicy;
    return this.models[policy] || this.models.fast;
  }

  _validateConfig() {
    if (!this.baseUrl) {
      throw new ArthurError('OMNIROUTE_CONFIG_ERROR', 'OMNIROUTE_BASE_URL is required', { retryable: false });
    }
    if (!this.apiKey) {
      throw new ArthurError('OMNIROUTE_CONFIG_ERROR', 'OMNIROUTE_API_KEY is required', { retryable: false });
    }
  }

  _headers() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };
  }

  _url(path) {
    return `${this.baseUrl}${path}`;
  }

  _isRetryable(status, error) {
    if (error?.name === 'AbortError') return true;
    if (error?.code === 'ETIMEDOUT' || error?.code === 'ECONNRESET' || error?.code === 'FETCH_ERROR') return true;
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
    return false;
  }

  _redactError(error) {
    if (!this.apiKey || !error?.message) {
      return error;
    }
    const safeMessage = error.message.replace(new RegExp(this.apiKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '[REDACTED]');
    const redacted = new Error(safeMessage);
    redacted.code = error.code;
    redacted.status = error.status;
    redacted.retryable = error.retryable;
    return redacted;
  }

  async _request(path, body, options = {}) {
    this._validateConfig();
    const url = this._url(path);
    const timeoutMs = options.timeoutMs || this.timeoutMs;
    const maxRetries = options.maxRetries ?? this.maxRetries;
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);

        const text = await response.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = { raw: text };
        }

        if (!response.ok) {
          const status = response.status;
          let code = `OMNIROUTE_HTTP_${status}`;
          if (status === 401) code = 'OMNIROUTE_UNAUTHORIZED';
          if (status === 429) code = 'OMNIROUTE_RATE_LIMITED';
          throw new ArthurError(
            code,
            data?.error?.message || `OmniRoute HTTP ${status}`,
            { retryable: this._isRetryable(status, null) }
          );
        }

        return data;
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
        const retryable = error?.retryable ?? this._isRetryable(null, error);
        if (!retryable || attempt >= maxRetries) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 250 * Math.pow(2, attempt)));
      }
    }

    const redacted = this._redactError(lastError);
    throw new ArthurError(
      lastError?.code || 'OMNIROUTE_REQUEST_FAILED',
      redacted.message,
      { retryable: false }
    );
  }

  async generate(prompt, options = {}) {
    const body = {
      model: this._resolveModel(options),
      messages: [{ role: 'user', content: prompt }],
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || options.max_tokens || DEFAULT_MAX_TOKENS,
      stream: false,
    };
    const data = await this._request('/chat/completions', body, options);
    return this._extractContent(data);
  }

  async synthesize(input, context) {
    const prompt = this._buildSynthesisPrompt(input);
    const data = await this._request('/chat/completions', {
      model: this._resolveModel(input),
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: DEFAULT_MAX_TOKENS,
      stream: false,
    });
    const text = this._extractContent(data);
    return {
      text,
      markdown: text,
      confidence: input.executionStatus === 'success' ? 'high' : 'medium',
      followUps: [],
      sources: [],
      usage: data?.usage || null,
    };
  }

  async health() {
    try {
      this._validateConfig();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const response = await this.fetchImpl(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: this._headers(),
        signal: controller.signal,
      });
      clearTimeout(timer);
      return {
        healthy: response.ok,
        provider: this.name,
        models: this.models,
        baseUrl: this.baseUrl,
      };
    } catch (error) {
      return {
        healthy: false,
        provider: this.name,
        models: this.models,
        error: this._redactError(error).message,
      };
    }
  }

  _describeResponseShape(data) {
    const choice = data?.choices?.[0];
    const message = choice?.message;
    return {
      hasChoices: Array.isArray(data?.choices),
      choiceCount: data?.choices?.length ?? 0,
      choiceKeys: choice ? Object.keys(choice) : [],
      hasMessage: Boolean(message),
      messageKeys: message ? Object.keys(message) : [],
      contentType: message?.content === null ? 'null' : Array.isArray(message?.content) ? 'array' : typeof message?.content,
      hasReasoningContent: 'reasoning_content' in (message || {}),
    };
  }

  _extractTextFromContentParts(content) {
    if (!Array.isArray(content)) return null;
    const parts = content
      .filter(part => part && (typeof part.text === 'string' || typeof part.content === 'string'))
      .map(part => part.text || part.content);
    if (parts.length === 0) return null;
    return parts.join('').trim();
  }

  _extractContent(data) {
    const message = data?.choices?.[0]?.message;
    if (!message) {
      const shape = this._describeResponseShape(data);
      throw new ArthurError(
        'OMNIROUTE_INVALID_RESPONSE',
        `OmniRoute response missing message: ${JSON.stringify(shape)}`,
        { retryable: false }
      );
    }

    const content = message.content;

    if (typeof content === 'string' && content.length > 0) {
      return content.trim();
    }

    if (Array.isArray(content)) {
      const text = this._extractTextFromContentParts(content);
      if (text && text.length > 0) {
        return text;
      }
    }

    const shape = this._describeResponseShape(data);
    throw new ArthurError(
      'OMNIROUTE_INVALID_RESPONSE',
      `OmniRoute response missing usable content: ${JSON.stringify(shape)}`,
      { retryable: false }
    );
  }

  _buildSynthesisPrompt(input) {
    const { userMessage, intent, skillOutputs, failures, executionStatus, knowledge } = input;
    const safeSkillOutputs = JSON.stringify(skillOutputs || [], null, 2).slice(0, 8000);
    const safeFailures = JSON.stringify(failures || [], null, 2).slice(0, 4000);
    const safeKnowledge = JSON.stringify(knowledge || [], null, 2).slice(0, 4000);

    return `Ты — Артур, AI-ассистент бизнеса. Ответь на запрос пользователя строго на основе предоставленных данных.

ВАЖНЕЙШИЕ ПРАВИЛА:
- НЕ ПРИДУМЫВАЙ данных, которых нет в skillOutputs, failures или knowledge.
- Если данные отсутствуют или источник недоступен, честно скажи об этом.
- Не принимай бизнес-решений и не вычисляй количества заказа — только объясняй и суммируй уже проверенные данные.

Запрос пользователя: "${userMessage || ''}"
Intent: ${intent || 'unknown'}
Статус выполнения: ${executionStatus || 'unknown'}

Результаты навыков:
${safeSkillOutputs}

Ошибки навыков:
${safeFailures}

Знания:
${safeKnowledge}

Сформулируй краткий, деловой ответ на русском языке.`;
  }
}

function createOmniRouteProvider(options = {}) {
  return new OmniRouteProvider(options);
}

module.exports = {
  OmniRouteProvider,
  createOmniRouteProvider,
};
