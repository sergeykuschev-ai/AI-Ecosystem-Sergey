'use strict';

function parseAllowedUserIds(value) {
  if (!value) return new Set();
  return new Set(
    value
      .split(',')
      .map(id => id.trim())
      .filter(Boolean)
  );
}

function parseEnabled(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function parseServiceKeys(value) {
  if (!value) return [];
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new TypeError(`BUSINESS_KPI_SERVICE_KEYS must be a JSON array: ${error.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new TypeError('BUSINESS_KPI_SERVICE_KEYS must be a JSON array');
  }
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TypeError(`BUSINESS_KPI_SERVICE_KEYS[${index}] must be an object`);
    }
    if (typeof entry.id !== 'string' || !entry.id.trim()) {
      throw new TypeError(`BUSINESS_KPI_SERVICE_KEYS[${index}].id is required`);
    }
    if (typeof entry.key !== 'string' || !entry.key.trim()) {
      throw new TypeError(`BUSINESS_KPI_SERVICE_KEYS[${index}].key is required`);
    }
    return {
      id: entry.id.trim(),
      name: typeof entry.name === 'string' && entry.name.trim()
        ? entry.name.trim()
        : entry.id.trim(),
      key: entry.key.trim(),
    };
  });
}

function loadBusinessKpiConfig(env = process.env) {
  const baseUrl = (env.BUSINESS_KPI_BASE_URL || '').trim();
  const serviceKeys = parseServiceKeys(env.BUSINESS_KPI_SERVICE_KEYS);
  return {
    enabled: Boolean(baseUrl) && serviceKeys.length > 0,
    baseUrl,
    serviceKeys,
    serviceId: (env.BUSINESS_KPI_SERVICE_ID || 'arthur.analytics').trim(),
    timeoutMs: Number(env.BUSINESS_KPI_REQUEST_TIMEOUT_MS) || 10000,
  };
}

function parseCronTime(value, defaultValue) {
  const trimmed = String(value || '').trim();
  return trimmed || defaultValue;
}

function parseCronDay(value, defaultValue) {
  const num = Number(value);
  return Number.isInteger(num) && num >= 0 && num <= 6 ? num : defaultValue;
}

function loadKpiAutomationConfig(env = process.env) {
  return {
    timezone: (env.TELEGRAM_KPI_TIMEZONE || 'Asia/Vladivostok').trim(),
    daily: {
      enabled: parseEnabled(env.TELEGRAM_KPI_DAILY_ENABLED),
      time: parseCronTime(env.TELEGRAM_KPI_DAILY_TIME, '20:15'),
    },
    weekly: {
      enabled: parseEnabled(env.TELEGRAM_KPI_WEEKLY_ENABLED),
      time: parseCronTime(env.TELEGRAM_KPI_WEEKLY_TIME, '20:30'),
      day: parseCronDay(env.TELEGRAM_KPI_WEEKLY_DAY, 0),
    },
    alerts: {
      enabled: parseEnabled(env.TELEGRAM_KPI_ALERTS_ENABLED),
      intervalMinutes: Number(env.TELEGRAM_KPI_ALERTS_INTERVAL_MINUTES) || 60,
    },
  };
}

function loadYandexMailConfig(env = process.env) {
  return {
    enabled: parseEnabled(env.ARTHUR_MAILBOX_MISKA_YANDEX_ENABLED),
    mailboxId: env.ARTHUR_MAILBOX_MISKA_YANDEX_ID || 'miska-yandex',
    provider: env.ARTHUR_MAILBOX_MISKA_YANDEX_PROVIDER || 'yandex',
    accountType: env.ARTHUR_MAILBOX_MISKA_YANDEX_ACCOUNT_TYPE || 'work',
    businessContext: env.ARTHUR_MAILBOX_MISKA_YANDEX_BUSINESS_CONTEXT || 'miska',
    displayName: env.ARTHUR_MAILBOX_MISKA_YANDEX_DISPLAY_NAME || 'Почта Миски',
    host: env.ARTHUR_MAILBOX_MISKA_YANDEX_IMAP_HOST || 'imap.yandex.ru',
    port: Number(env.ARTHUR_MAILBOX_MISKA_YANDEX_IMAP_PORT || 993),
    tls: String(env.ARTHUR_MAILBOX_MISKA_YANDEX_IMAP_TLS || 'true').trim().toLowerCase() === 'true',
    folder: env.ARTHUR_MAILBOX_MISKA_YANDEX_IMAP_FOLDER || 'INBOX',
    connectionTimeoutMs: Number(
      env.ARTHUR_MAILBOX_MISKA_YANDEX_CONNECTION_TIMEOUT_MS || 10000
    ),
    socketTimeoutMs: Number(env.ARTHUR_MAILBOX_MISKA_YANDEX_SOCKET_TIMEOUT_MS || 30000),
    maxMessageBytes: Number(env.ARTHUR_MAILBOX_MISKA_YANDEX_MAX_MESSAGE_BYTES || 131072),
    usernameSecretFile: env.ARTHUR_MAILBOX_MISKA_YANDEX_USERNAME_SECRET_FILE || '',
    appPasswordSecretFile: env.ARTHUR_MAILBOX_MISKA_YANDEX_APP_PASSWORD_SECRET_FILE || '',
  };
}

function loadConfig(env = process.env) {
  const token = env.TELEGRAM_BOT_TOKEN || '';
  const allowedUserIds = parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS);
  const ownerProfileId = (env.ARTHUR_OWNER_PROFILE_ID || '').trim();
  const coreBaseUrl = (env.ARTHUR_CORE_BASE_URL || '').trim();
  const coreToken = (env.ARTHUR_CORE_TOKEN || '').trim();

  return {
    token,
    allowedUserIds,
    ownerProfileId,
    coreBaseUrl,
    coreToken,
    coreTimeoutMs: Number(env.ARTHUR_CORE_TIMEOUT_MS) || 5000,
    apiBaseUrl: env.TELEGRAM_API_BASE_URL || 'https://api.telegram.org',
    pollTimeoutMs: Number(env.TELEGRAM_POLL_TIMEOUT_MS) || 30000,
    requestTimeoutMs: Number(env.TELEGRAM_API_TIMEOUT_MS) || 10000,
    maxRetries: Number(env.TELEGRAM_API_RETRY_ATTEMPTS) || 3,
    retryDelayMs: Number(env.TELEGRAM_API_RETRY_DELAY_MS) || 1000,
    healthPort: Number(env.TELEGRAM_GATEWAY_HEALTH_PORT) || 8788,
    logLevel: env.TELEGRAM_GATEWAY_LOG_LEVEL || 'info',
    yandexMail: loadYandexMailConfig(env),
    businessKpi: loadBusinessKpiConfig(env),
    kpiAutomation: loadKpiAutomationConfig(env),
    isProduction: env.NODE_ENV === 'production',
  };
}

function validateConfig(config) {
  const errors = [];

  if (!config.token) {
    errors.push('TELEGRAM_BOT_TOKEN is required');
  } else if (!/^\d+:[A-Za-z0-9_-]+$/.test(config.token)) {
    errors.push('TELEGRAM_BOT_TOKEN format is invalid');
  }

  if (config.allowedUserIds.size === 0) {
    errors.push('TELEGRAM_ALLOWED_USER_IDS is required');
  }

  if (config.isProduction && config.allowedUserIds.size !== 1) {
    errors.push('TELEGRAM_ALLOWED_USER_IDS must contain exactly one user ID in production');
  }

  if (!config.ownerProfileId) {
    errors.push('ARTHUR_OWNER_PROFILE_ID is required');
  }

  const hasCoreBaseUrl = Boolean(config.coreBaseUrl);
  const hasCoreToken = Boolean(config.coreToken);
  if (hasCoreBaseUrl !== hasCoreToken) {
    errors.push('ARTHUR_CORE_BASE_URL and ARTHUR_CORE_TOKEN must be configured together');
  }

  if (hasCoreBaseUrl) {
    try {
      const parsedCoreUrl = new URL(config.coreBaseUrl);
      if (!['http:', 'https:'].includes(parsedCoreUrl.protocol)) {
        errors.push('ARTHUR_CORE_BASE_URL must use http or https');
      }
    } catch {
      errors.push('ARTHUR_CORE_BASE_URL must be a valid URL');
    }
  }

  if (!Number.isInteger(config.coreTimeoutMs) || config.coreTimeoutMs < 100 || config.coreTimeoutMs > 60000) {
    errors.push('ARTHUR_CORE_TIMEOUT_MS must be between 100 and 60000');
  }

  if (config.pollTimeoutMs < 1000 || config.pollTimeoutMs > 120000) {
    errors.push('TELEGRAM_POLL_TIMEOUT_MS must be between 1000 and 120000');
  }

  if (config.requestTimeoutMs < 1000 || config.requestTimeoutMs > 60000) {
    errors.push('TELEGRAM_API_TIMEOUT_MS must be between 1000 and 60000');
  }

  if (config.maxRetries < 0 || config.maxRetries > 10) {
    errors.push('TELEGRAM_API_RETRY_ATTEMPTS must be between 0 and 10');
  }

  if (config.businessKpi.enabled) {
    try {
      const parsed = new URL(config.businessKpi.baseUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.push('BUSINESS_KPI_BASE_URL must use http or https');
      }
    } catch {
      errors.push('BUSINESS_KPI_BASE_URL must be a valid URL');
    }
    if (!config.businessKpi.serviceKeys.some(k => k.id === config.businessKpi.serviceId)) {
      errors.push(`BUSINESS_KPI_SERVICE_ID ${config.businessKpi.serviceId} not found in BUSINESS_KPI_SERVICE_KEYS`);
    }
  }

  const kpi = config.kpiAutomation;
  const anyAutomationEnabled = kpi.daily.enabled || kpi.weekly.enabled || kpi.alerts.enabled;
  if (anyAutomationEnabled && !config.businessKpi.enabled) {
    errors.push('KPI automation requires BUSINESS_KPI_BASE_URL and BUSINESS_KPI_SERVICE_KEYS');
  }
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (kpi.daily.enabled && !timeRegex.test(kpi.daily.time)) {
    errors.push('TELEGRAM_KPI_DAILY_TIME must be HH:MM');
  }
  if (kpi.weekly.enabled && !timeRegex.test(kpi.weekly.time)) {
    errors.push('TELEGRAM_KPI_WEEKLY_TIME must be HH:MM');
  }
  if (kpi.alerts.enabled && (!Number.isInteger(kpi.alerts.intervalMinutes) || kpi.alerts.intervalMinutes < 15 || kpi.alerts.intervalMinutes > 1440)) {
    errors.push('TELEGRAM_KPI_ALERTS_INTERVAL_MINUTES must be between 15 and 1440');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  loadConfig,
  loadYandexMailConfig,
  loadBusinessKpiConfig,
  loadKpiAutomationConfig,
  validateConfig,
  parseAllowedUserIds,
  parseEnabled,
  parseServiceKeys,
};
