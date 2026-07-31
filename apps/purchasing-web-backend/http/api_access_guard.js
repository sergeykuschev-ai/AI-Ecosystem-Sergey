'use strict';

const { HttpError } = require('./responses');

const LOOPBACK_IPV4 = '127.0.0.1';
const LOOPBACK_IPV6 = '::1';
const LOOPBACK_IPV4_MAPPED = '::ffff:127.0.0.1';

function isLoopbackAddress(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === LOOPBACK_IPV4 || normalized === LOOPBACK_IPV6) {
    return true;
  }
  if (normalized.startsWith('::ffff:')) {
    return normalized.slice('::ffff:'.length) === LOOPBACK_IPV4;
  }
  return false;
}

function isLoopbackRequest(request) {
  return isLoopbackAddress(request?.socket?.remoteAddress ?? '');
}

function extractApiKey(request) {
  const raw = request?.headers?.['x-api-key'];
  if (Array.isArray(raw)) {
    return raw.length === 1 ? String(raw[0]) : null;
  }
  return typeof raw === 'string' ? raw : null;
}

function enforceApiAccess(request, options = {}) {
  const apiToken = options.apiToken ?? null;
  const checkLoopback = options.isLoopbackRequest ?? isLoopbackRequest;

  if (!apiToken) {
    return;
  }
  if (checkLoopback(request)) {
    return;
  }

  const provided = extractApiKey(request);
  if (!provided) {
    // The expected value is never echoed back or logged.
    throw new HttpError(
      'API_TOKEN_REQUIRED',
      'API token is required for this request. Provide the x-api-key header.',
    );
  }
  if (provided !== apiToken) {
    throw new HttpError('API_TOKEN_INVALID', 'Invalid API token.');
  }
}

module.exports = {
  enforceApiAccess,
  isLoopbackAddress,
  isLoopbackRequest,
  LOOPBACK_IPV4,
  LOOPBACK_IPV6,
  LOOPBACK_IPV4_MAPPED,
};
