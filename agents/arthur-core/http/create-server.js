'use strict';

const http = require('node:http');
const { randomUUID } = require('node:crypto');

const DEFAULT_BODY_LIMIT = 1024 * 1024;

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  response.end(body);
}

async function readJson(request, limit = DEFAULT_BODY_LIMIT) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('Request body is too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON');
    error.statusCode = 400;
    throw error;
  }
}

function actorContext(request) {
  return {
    actorId: request.headers['x-arthur-actor-id'] || 'api',
    actorType: request.headers['x-arthur-actor-type'] || 'system',
    correlationId: request.headers['x-correlation-id'] || randomUUID()
  };
}

function errorStatus(error) {
  if (error.statusCode) return error.statusCode;
  if (error instanceof TypeError || error instanceof RangeError) return 400;
  if (/not found/i.test(error.message)) return 404;
  if (/fingerprint mismatch|not pending|transition/i.test(error.message)) return 409;
  return 500;
}

function createArthurHttpHandler({ runtime, bodyLimit = DEFAULT_BODY_LIMIT } = {}) {
  if (!runtime || !runtime.service || typeof runtime.healthcheck !== 'function') {
    throw new TypeError('Arthur runtime with service and healthcheck is required');
  }

  return async function handler(request, response) {
    const requestUrl = new URL(request.url, 'http://arthur.local');
    const path = requestUrl.pathname;

    try {
      if (request.method === 'GET' && path === '/health') {
        const healthy = await runtime.healthcheck();
        return sendJson(response, healthy ? 200 : 503, { ok: healthy, service: 'arthur-core' });
      }

      if (request.method === 'POST' && path === '/v1/profiles') {
        const profile = await runtime.service.createProfile(await readJson(request, bodyLimit), actorContext(request));
        return sendJson(response, 201, { data: profile });
      }

      const profileMatch = path.match(/^\/v1\/profiles\/([^/]+)$/);
      if (request.method === 'GET' && profileMatch) {
        const profile = await runtime.service.getProfile(decodeURIComponent(profileMatch[1]));
        if (!profile) return sendJson(response, 404, { error: { code: 'not_found', message: 'Profile not found' } });
        return sendJson(response, 200, { data: profile });
      }

      if (request.method === 'POST' && path === '/v1/tasks') {
        const task = await runtime.service.createTask(await readJson(request, bodyLimit), actorContext(request));
        return sendJson(response, 201, { data: task });
      }

      const transitionMatch = path.match(/^\/v1\/tasks\/([^/]+)\/transitions$/);
      if (request.method === 'POST' && transitionMatch) {
        const body = await readJson(request, bodyLimit);
        const task = await runtime.service.transitionTask(
          body.ownerId,
          decodeURIComponent(transitionMatch[1]),
          body.status,
          body.patch || {},
          actorContext(request)
        );
        return sendJson(response, 200, { data: task });
      }

      const taskMatch = path.match(/^\/v1\/tasks\/([^/]+)$/);
      if (request.method === 'GET' && taskMatch) {
        const ownerId = requestUrl.searchParams.get('ownerId');
        if (!ownerId) return sendJson(response, 400, { error: { code: 'validation_error', message: 'ownerId query parameter is required' } });
        const task = await runtime.service.getTask(ownerId, decodeURIComponent(taskMatch[1]));
        if (!task) return sendJson(response, 404, { error: { code: 'not_found', message: 'Task not found' } });
        return sendJson(response, 200, { data: task });
      }

      return sendJson(response, 404, { error: { code: 'route_not_found', message: 'Route not found' } });
    } catch (error) {
      const status = errorStatus(error);
      return sendJson(response, status, {
        error: {
          code: status >= 500 ? 'internal_error' : 'request_error',
          message: status >= 500 ? 'Arthur Core request failed' : error.message
        }
      });
    }
  };
}

function createArthurHttpServer(options) {
  return http.createServer(createArthurHttpHandler(options));
}

module.exports = { createArthurHttpHandler, createArthurHttpServer, readJson };
