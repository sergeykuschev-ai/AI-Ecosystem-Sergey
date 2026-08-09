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

function loadConfig(env = process.env) {
  const token = env.TELEGRAM_BOT_TOKEN || '';
  const allowedUserIds = parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS);

  return {
    token,
    allowedUserIds,
    apiBaseUrl: env.TELEGRAM_API_BASE_URL || 'https://api.telegram.org',
    pollTimeoutMs: Number(env.TELEGRAM_POLL_TIMEOUT_MS) || 30000,
    requestTimeoutMs: Number(env.TELEGRAM_API_TIMEOUT_MS) || 10000,
    maxRetries: Number(env.TELEGRAM_API_RETRY_ATTEMPTS) || 3,
    retryDelayMs: Number(env.TELEGRAM_API_RETRY_DELAY_MS) || 1000,
    healthPort: Number(env.TELEGRAM_GATEWAY_HEALTH_PORT) || 8788,
    logLevel: env.TELEGRAM_GATEWAY_LOG_LEVEL || 'info',
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

  if (config.pollTimeoutMs < 1000 || config.pollTimeoutMs > 120000) {
    errors.push('TELEGRAM_POLL_TIMEOUT_MS must be between 1000 and 120000');
  }

  if (config.requestTimeoutMs < 1000 || config.requestTimeoutMs > 60000) {
    errors.push('TELEGRAM_API_TIMEOUT_MS must be between 1000 and 60000');
  }

  if (config.maxRetries < 0 || config.maxRetries > 10) {
    errors.push('TELEGRAM_API_RETRY_ATTEMPTS must be between 0 and 10');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  loadConfig,
  validateConfig,
  parseAllowedUserIds,
};
