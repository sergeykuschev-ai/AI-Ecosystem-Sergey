'use strict';

const { ArthurError } = require('../../errors/arthur_errors');

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RETRIES = 2;

class BusinessKpiClientError extends ArthurError {
  constructor(code, message, options = {}) {
    super(code, message, options);
    this.name = 'BusinessKpiClientError';
    this.statusCode = options.statusCode ?? null;
  }
}

class BusinessKpiConfigError extends BusinessKpiClientError {
  constructor(message) {
    super('BUSINESS_KPI_CONFIG_ERROR', message, { retryable: false });
  }
}

class BusinessKpiAuthError extends BusinessKpiClientError {
  constructor(statusCode) {
    super('BUSINESS_KPI_AUTH_ERROR', 'Business KPI authentication failed', {
      statusCode,
      retryable: false,
    });
  }
}

class BusinessKpiNotFoundError extends BusinessKpiClientError {
  constructor() {
    super('BUSINESS_KPI_NOT_FOUND', 'Business KPI resource was not found', {
      statusCode: 404,
      retryable: false,
    });
  }
}

class BusinessKpiServerError extends BusinessKpiClientError {
  constructor(statusCode) {
    super('BUSINESS_KPI_SERVER_ERROR', 'Business KPI service failed', {
      statusCode,
      retryable: true,
    });
  }
}

class BusinessKpiHttpError extends BusinessKpiClientError {
  constructor(statusCode, message) {
    super('BUSINESS_KPI_HTTP_ERROR', message || `Business KPI returned HTTP ${statusCode}`, {
      statusCode,
      retryable: false,
    });
  }
}

class BusinessKpiTimeoutError extends BusinessKpiClientError {
  constructor(timeoutMs, cause) {
    super('BUSINESS_KPI_TIMEOUT', `Business KPI request timed out after ${timeoutMs}ms`, {
      retryable: true,
      cause,
    });
  }
}

class BusinessKpiNetworkError extends BusinessKpiClientError {
  constructor(cause) {
    super('BUSINESS_KPI_NETWORK_ERROR', 'Business KPI network request failed', {
      retryable: true,
      cause,
    });
  }
}

function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BusinessKpiConfigError('BUSINESS_KPI_BASE_URL is required');
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new BusinessKpiConfigError('BUSINESS_KPI_BASE_URL must be a valid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new BusinessKpiConfigError('BUSINESS_KPI_BASE_URL must use http or https');
  }
  return parsed.toString().replace(/\/+$/, '');
}

function selectServiceKey(serviceKeys, serviceId) {
  if (!Array.isArray(serviceKeys) || serviceKeys.length === 0) {
    throw new BusinessKpiConfigError('BUSINESS_KPI_SERVICE_KEYS is required');
  }
  const key = serviceKeys.find(entry => entry.id === serviceId);
  if (!key) {
    throw new BusinessKpiConfigError(`Service key ${serviceId} not found in BUSINESS_KPI_SERVICE_KEYS`);
  }
  return key;
}

function statusError(statusCode, message) {
  if (statusCode === 401 || statusCode === 403) return new BusinessKpiAuthError(statusCode);
  if (statusCode === 404) return new BusinessKpiNotFoundError();
  if (statusCode >= 500) return new BusinessKpiServerError(statusCode);
  return new BusinessKpiHttpError(statusCode, message);
}

function isRetryable(status, error) {
  if (error?.name === 'AbortError') return true;
  if (error?.code === 'ETIMEDOUT' || error?.code === 'ECONNRESET' || error?.code === 'FETCH_ERROR') return true;
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

class BusinessKpiClient {
  constructor(options = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl || process.env.BUSINESS_KPI_BASE_URL);
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;

    const serviceKeys = options.serviceKeys || [];
    const serviceId = options.serviceId || process.env.BUSINESS_KPI_SERVICE_ID || 'arthur.analytics';
    const service = selectServiceKey(serviceKeys, serviceId);
    this.serviceId = service.id;
    this.serviceName = service.name;
    this.apiKey = service.key;
  }

  _headers() {
    return {
      accept: 'application/json',
      authorization: `Bearer ${this.apiKey}`,
    };
  }

  async _request(path, options = {}) {
    const url = new URL(path, `${this.baseUrl}/`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const method = options.method || 'GET';
    const headers = { ...this._headers(), ...(options.headers || {}) };
    const body = options.body !== undefined ? JSON.stringify(options.body) : undefined;
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }

    let lastError = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          method,
          headers,
          body,
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
          throw statusError(
            response.status,
            data?.error?.message || data?.message
          );
        }

        return data?.data ?? data;
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
        const retryable = error?.retryable ?? isRetryable(null, error);
        if (!retryable || attempt >= this.maxRetries) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 250 * Math.pow(2, attempt)));
      }
    }

    if (lastError instanceof BusinessKpiClientError) {
      throw lastError;
    }
    if (lastError?.name === 'AbortError') {
      throw new BusinessKpiTimeoutError(this.timeoutMs, lastError);
    }
    throw new BusinessKpiNetworkError(lastError);
  }

  async health() {
    return this._request('/health', { expectData: false });
  }

  async getDashboard({ storeId, year, month }) {
    return this._request('/api/business-kpi/dashboard', {
      query: { store: storeId, year, month },
    });
  }

  async getToday({ storeId }) {
    return this._request('/api/business-kpi/today', {
      query: { store: storeId },
    });
  }

  async getSellers({ storeId, year, month }) {
    return this._request('/api/business-kpi/sellers', {
      query: { store: storeId, year, month },
    });
  }

  async getSellerPerformance({ storeId, year, month, mode = 'shifts' }) {
    return this._request('/api/business-kpi/seller-performance', {
      query: { store: storeId, year, month, mode },
    });
  }

  async getShifts({ storeId, employeeId, year, month, dateFrom, dateTo }) {
    return this._request('/api/business-kpi/shifts', {
      query: {
        store: storeId,
        employee: employeeId,
        year,
        month,
        date_from: dateFrom,
        date_to: dateTo,
      },
    });
  }

  async getShift(shiftId) {
    return this._request(`/api/business-kpi/shifts/${shiftId}`);
  }

  async getBonuses({ storeId, year, month }) {
    return this._request('/api/business-kpi/bonuses', {
      query: { store: storeId, year, month },
    });
  }

  async getMonths({ storeId, year }) {
    return this._request('/api/business-kpi/months', {
      query: { store: storeId, year },
    });
  }

  async getYear({ storeId, year }) {
    return this._request('/api/business-kpi/year', {
      query: { store: storeId, year },
    });
  }

  async getSettings({ storeId, date }) {
    return this._request('/api/business-kpi/settings', {
      query: { store: storeId, date },
    });
  }

  async getReferenceData(storeId) {
    return this._request('/api/business-kpi/reference-data', {
      query: storeId ? { store: storeId } : {},
    });
  }

  async getImports(storeId) {
    return this._request('/api/business-kpi/imports', {
      query: storeId ? { store: storeId } : {},
    });
  }
}

function createBusinessKpiClient(options = {}) {
  return new BusinessKpiClient(options);
}

module.exports = {
  BusinessKpiClient,
  createBusinessKpiClient,
  BusinessKpiClientError,
  BusinessKpiConfigError,
  BusinessKpiAuthError,
  BusinessKpiNotFoundError,
  BusinessKpiServerError,
  BusinessKpiHttpError,
  BusinessKpiTimeoutError,
  BusinessKpiNetworkError,
};
