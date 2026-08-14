'use strict';

const DEFAULT_TIMEOUT_MS = 5000;
const TASK_FILTERS = Object.freeze([
  'status',
  'domain',
  'dueBefore',
  'dueAfter',
  'includeCompleted',
  'limit',
]);
const BRIEF_FILTERS = Object.freeze(['now', 'horizonHours', 'limit']);

class ArthurCoreClientError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = options.statusCode ?? null;
    this.retryable = options.retryable ?? false;
    this.cause = options.cause ?? null;
  }
}

class ArthurCoreConfigError extends ArthurCoreClientError {
  constructor(message) {
    super('ARTHUR_CORE_CONFIG_ERROR', message);
  }
}

class ArthurCoreAuthError extends ArthurCoreClientError {
  constructor(statusCode) {
    super('ARTHUR_CORE_AUTH_ERROR', 'Arthur Core authentication failed', { statusCode });
  }
}

class ArthurCoreNotFoundError extends ArthurCoreClientError {
  constructor() {
    super('ARTHUR_CORE_NOT_FOUND', 'Arthur Core resource was not found', { statusCode: 404 });
  }
}

class ArthurCoreServerError extends ArthurCoreClientError {
  constructor(statusCode) {
    super('ARTHUR_CORE_SERVER_ERROR', 'Arthur Core service failed', {
      statusCode,
      retryable: true,
    });
  }
}

class ArthurCoreHttpError extends ArthurCoreClientError {
  constructor(statusCode) {
    super('ARTHUR_CORE_HTTP_ERROR', `Arthur Core returned HTTP ${statusCode}`, { statusCode });
  }
}

class ArthurCoreTimeoutError extends ArthurCoreClientError {
  constructor(timeoutMs, cause) {
    super('ARTHUR_CORE_TIMEOUT', `Arthur Core request timed out after ${timeoutMs}ms`, {
      retryable: true,
      cause,
    });
  }
}

class ArthurCoreNetworkError extends ArthurCoreClientError {
  constructor(cause) {
    super('ARTHUR_CORE_NETWORK_ERROR', 'Arthur Core network request failed', {
      retryable: true,
      cause,
    });
  }
}

class ArthurCoreInvalidResponseError extends ArthurCoreClientError {
  constructor(cause) {
    super('ARTHUR_CORE_INVALID_RESPONSE', 'Arthur Core returned malformed JSON', { cause });
  }
}

function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ArthurCoreConfigError('ARTHUR_CORE_BASE_URL is required');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new ArthurCoreConfigError('ARTHUR_CORE_BASE_URL must be a valid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ArthurCoreConfigError('ARTHUR_CORE_BASE_URL must use http or https');
  }

  return parsed.toString().replace(/\/$/, '');
}

function validateCoreClientOptions(options = {}) {
  const errors = [];

  try {
    normalizeBaseUrl(options.baseUrl);
  } catch (error) {
    errors.push(error.message);
  }

  if (typeof options.token !== 'string' || options.token.trim() === '') {
    errors.push('ARTHUR_CORE_TOKEN is required');
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) {
    errors.push('ARTHUR_CORE_TIMEOUT_MS must be an integer between 100 and 60000');
  }

  if (options.fetchImpl !== undefined && typeof options.fetchImpl !== 'function') {
    errors.push('Arthur Core fetch implementation must be a function');
  }

  return { valid: errors.length === 0, errors };
}

function appendQuery(url, source, allowedKeys) {
  for (const key of allowedKeys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
}

function statusError(statusCode) {
  if (statusCode === 401 || statusCode === 403) return new ArthurCoreAuthError(statusCode);
  if (statusCode === 404) return new ArthurCoreNotFoundError();
  if (statusCode >= 500) return new ArthurCoreServerError(statusCode);
  return new ArthurCoreHttpError(statusCode);
}

class ArthurCoreClient {
  constructor(options = {}) {
    const validation = validateCoreClientOptions(options);
    if (!validation.valid) {
      throw new ArthurCoreConfigError(validation.errors.join('; '));
    }

    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.token = options.token.trim();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
  }

  async _request(path, options = {}) {
    const url = new URL(path, `${this.baseUrl}/`);
    appendQuery(url, options.query || {}, options.allowedQueryKeys || []);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = { accept: 'application/json' };
    if (options.authenticated !== false) {
      headers.authorization = `Bearer ${this.token}`;
    }
    if (options.correlationId) {
      headers['x-correlation-id'] = options.correlationId;
    }

    let response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ArthurCoreTimeoutError(this.timeoutMs, error);
      }
      throw new ArthurCoreNetworkError(error);
    } finally {
      clearTimeout(timer);
    }

    if (!response || typeof response.ok !== 'boolean' || typeof response.text !== 'function') {
      throw new ArthurCoreInvalidResponseError();
    }

    if (!response.ok) {
      throw statusError(response.status);
    }

    let payload;
    try {
      payload = JSON.parse(await response.text());
    } catch (error) {
      throw new ArthurCoreInvalidResponseError(error);
    }

    if (!payload || typeof payload !== 'object') {
      throw new ArthurCoreInvalidResponseError();
    }

    if (options.expectData === false) return payload;
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new ArthurCoreInvalidResponseError();
    }
    return payload.data;
  }

  async getProfile(profileId, context = {}) {
    return this._request(`/v1/profiles/${encodeURIComponent(profileId)}`, context);
  }

  async listTasks(ownerId, filters = {}, context = {}) {
    return this._request('/v1/tasks', {
      ...context,
      query: { ...filters, ownerId },
      allowedQueryKeys: ['ownerId', ...TASK_FILTERS],
    });
  }

  async getTaskBrief(ownerId, filters = {}, context = {}) {
    return this._request('/v1/tasks/brief', {
      ...context,
      query: { ...filters, ownerId },
      allowedQueryKeys: ['ownerId', ...BRIEF_FILTERS],
    });
  }

  async health() {
    try {
      const payload = await this._request('/health', {
        authenticated: false,
        expectData: false,
      });
      return {
        healthy: payload.ok === true,
        service: payload.service || 'arthur-core',
      };
    } catch (error) {
      return {
        healthy: false,
        service: 'arthur-core',
        errorCode: error.code || 'ARTHUR_CORE_HEALTH_ERROR',
      };
    }
  }
}

function createArthurCoreClient(options = {}) {
  return new ArthurCoreClient(options);
}

module.exports = {
  ArthurCoreClient,
  ArthurCoreClientError,
  ArthurCoreConfigError,
  ArthurCoreAuthError,
  ArthurCoreNotFoundError,
  ArthurCoreServerError,
  ArthurCoreHttpError,
  ArthurCoreTimeoutError,
  ArthurCoreNetworkError,
  ArthurCoreInvalidResponseError,
  createArthurCoreClient,
  validateCoreClientOptions,
  DEFAULT_TIMEOUT_MS,
};
