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

  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  loadConfig,
  loadYandexMailConfig,
  validateConfig,
  parseAllowedUserIds,
  parseEnabled,
};
