'use strict';

function sendJson(response, statusCode, body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': payload.length,
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(payload);
}

function sendApiError(response, statusCode, code, message, details = null) {
  sendJson(response, statusCode, {
    api_version: 'v1',
    error: { code, message, details },
  });
}

module.exports = {
  sendApiError,
  sendJson,
};
