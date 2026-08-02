'use strict';

function required(name, environment) {
  const value = String(environment[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function positiveInteger(name, value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function safeFilter(name, value) {
  const normalized = String(value || '').trim();
  if (!normalized || ['*', '.*'].includes(normalized)) {
    throw new Error(`${name} must not be empty or accept-all.`);
  }
  return normalized;
}

function loadConfig(environment = process.env) {
  const imapUser = required('MINMAX_IMAP_USER', environment);
  const imapPassword = required('MINMAX_IMAP_PASSWORD', environment);
  return Object.freeze({
    buildSha: required('MINMAX_BUILD_SHA', environment),
    allowedSender: safeFilter(
      'MINMAX_ALLOWED_SENDER',
      environment.MINMAX_ALLOWED_SENDER
    ).toLowerCase(),
    subjectPattern: safeFilter(
      'MINMAX_SUBJECT_PATTERN',
      environment.MINMAX_SUBJECT_PATTERN
    ).toLowerCase(),
    imap: Object.freeze({
      host: String(environment.MINMAX_IMAP_HOST || 'imap.yandex.ru').trim(),
      port: positiveInteger('MINMAX_IMAP_PORT', environment.MINMAX_IMAP_PORT, 993),
      user: imapUser,
      password: imapPassword,
      mailbox: String(environment.MINMAX_IMAP_MAILBOX || 'INBOX').trim(),
      pollIntervalMs: positiveInteger(
        'MINMAX_POLL_INTERVAL_MS', environment.MINMAX_POLL_INTERVAL_MS, 10000
      ),
      timeoutMs: positiveInteger(
        'MINMAX_MAIL_TIMEOUT_MS', environment.MINMAX_MAIL_TIMEOUT_MS, 30000
      ),
      recentWindowHours: positiveInteger(
        'MINMAX_RECENT_WINDOW_HOURS', environment.MINMAX_RECENT_WINDOW_HOURS, 48
      ),
      maxMessages: positiveInteger(
        'MINMAX_IMAP_MAX_MESSAGES', environment.MINMAX_IMAP_MAX_MESSAGES, 100
      ),
    }),
    smtp: Object.freeze({
      host: String(environment.MINMAX_SMTP_HOST || 'smtp.yandex.ru').trim(),
      port: positiveInteger('MINMAX_SMTP_PORT', environment.MINMAX_SMTP_PORT, 465),
      user: required('MINMAX_SMTP_USER', environment),
      password: required('MINMAX_SMTP_PASSWORD', environment),
      from: required('MINMAX_SMTP_FROM', environment),
      to: required('MINMAX_NOTIFY_EMAIL', environment),
      timeoutMs: positiveInteger(
        'MINMAX_MAIL_TIMEOUT_MS', environment.MINMAX_MAIL_TIMEOUT_MS, 30000
      ),
    }),
    purchasing: Object.freeze({
      baseUrl: required('MINMAX_PURCHASING_API_BASE_URL', environment)
        .replace(/\/$/, ''),
      apiToken: required('PURCHASING_API_TOKEN', environment),
      requestTimeoutMs: positiveInteger(
        'MINMAX_API_TIMEOUT_MS', environment.MINMAX_API_TIMEOUT_MS, 30000
      ),
      pollIntervalMs: positiveInteger(
        'MINMAX_RUN_POLL_INTERVAL_MS',
        environment.MINMAX_RUN_POLL_INTERVAL_MS,
        5000
      ),
      pollTimeoutMs: positiveInteger(
        'MINMAX_RUN_POLL_TIMEOUT_MS',
        environment.MINMAX_RUN_POLL_TIMEOUT_MS,
        600000
      ),
      retryAttempts: positiveInteger(
        'MINMAX_API_RETRY_ATTEMPTS', environment.MINMAX_API_RETRY_ATTEMPTS, 3
      ),
    }),
    ownerUiBaseUrl: required('MINMAX_OWNER_UI_BASE_URL', environment)
      .replace(/\/$/, ''),
    maxAttachmentBytes: positiveInteger(
      'MINMAX_MAX_ATTACHMENT_BYTES',
      environment.MINMAX_MAX_ATTACHMENT_BYTES,
      20 * 1024 * 1024
    ),
    healthHost: String(environment.MINMAX_HEALTH_HOST || '0.0.0.0').trim(),
    healthPort: positiveInteger(
      'MINMAX_HEALTH_PORT', environment.MINMAX_HEALTH_PORT, 3220
    ),
    reconnectBackoffMs: positiveInteger(
      'MINMAX_RECONNECT_BACKOFF_MS',
      environment.MINMAX_RECONNECT_BACKOFF_MS,
      5000
    ),
  });
}

module.exports = { loadConfig, positiveInteger, required, safeFilter };
