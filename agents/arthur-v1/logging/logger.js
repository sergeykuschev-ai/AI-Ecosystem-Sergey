'use strict';

const SENSITIVE_PATTERNS = [
  /token/i,
  /password/i,
  /secret/i,
  /api[-_]?key/i,
  /credential/i,
  /authorization/i,
  /private[-_]?key/i,
];

function hasSensitiveKey(key) {
  if (typeof key !== 'string') return false;
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(key));
}

function sanitizeValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.length > 200) return value.slice(0, 200) + '...[truncated]';
    return value;
  }
  return value;
}

function sanitizePayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) {
    return payload.map(item => sanitizePayload(item));
  }
  const result = {};
  for (const [key, value] of Object.entries(payload)) {
    if (hasSensitiveKey(key)) {
      result[key] = '[REDACTED]';
    } else if (value && typeof value === 'object') {
      result[key] = sanitizePayload(value);
    } else {
      result[key] = sanitizeValue(value);
    }
  }
  return result;
}

function createLogRecord(level, event, context, payload = {}) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    correlationId: context?.correlationId || null,
    requestId: context?.requestId || null,
    userId: context?.userId || null,
    channel: context?.channel || null,
    ...sanitizePayload(payload),
  });
}

class ArthurLogger {
  constructor(options = {}) {
    this.stdout = options.stdout || process.stdout;
    this.stderr = options.stderr || process.stderr;
    this.sink = options.sink || null;
  }

  info(event, context, payload) {
    this._write('info', event, context, payload, this.stdout);
  }

  warn(event, context, payload) {
    this._write('warn', event, context, payload, this.stderr);
  }

  error(event, context, payload) {
    this._write('error', event, context, payload, this.stderr);
  }

  debug(event, context, payload) {
    this._write('debug', event, context, payload, this.stdout);
  }

  _write(level, event, context, payload, stream) {
    const record = createLogRecord(level, event, context, payload);
    if (this.sink && typeof this.sink.write === 'function') {
      this.sink.write(record, level);
    } else {
      stream.write(record + '\n');
    }
  }
}

function createLogger(options = {}) {
  return new ArthurLogger(options);
}

module.exports = {
  ArthurLogger,
  createLogger,
  sanitizePayload,
  hasSensitiveKey,
};
