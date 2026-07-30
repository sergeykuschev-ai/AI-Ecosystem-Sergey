'use strict';

const http = require('node:http');
const { randomUUID, timingSafeEqual } = require('node:crypto');

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

function extractToken(request) {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice(7).trim();
  }
  const headerToken = request.headers['x-arthur-api-token'];
  return typeof headerToken === 'string' ? headerToken.trim() : '';
}

function tokensMatch(actual, expected) {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function errorStatus(error) {
  if (error.statusCode) return error.statusCode;
  if (error instanceof TypeError || error instanceof RangeError) return 400;
  if (/not found/i.test(error.message)) return 404;
  if (/fingerprint mismatch|not pending|transition/i.test(error.message)) return 409;
  return 500;
}

function queryFilters(requestUrl) {
  return {
    status: requestUrl.searchParams.get('status') || undefined,
    domain: requestUrl.searchParams.get('domain') || undefined,
    dueBefore: requestUrl.searchParams.get('dueBefore') || undefined,
    dueAfter: requestUrl.searchParams.get('dueAfter') || undefined,
    includeCompleted: requestUrl.searchParams.get('includeCompleted') || undefined,
    limit: requestUrl.searchParams.get('limit') || undefined
  };
}

function createArthurHttpHandler({ runtime, bodyLimit = DEFAULT_BODY_LIMIT, apiToken = process.env.ARTHUR_API_TOKEN } = {}) {
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

      if (path.startsWith('/v1/') && apiToken && !tokensMatch(extractToken(request), apiToken)) {
        return sendJson(response, 401, { error: { code: 'unauthorized', message: 'Valid Arthur API token is required' } });
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

      if (request.method === 'GET' && path === '/v1/tasks') {
        const ownerId = requestUrl.searchParams.get('ownerId');
        if (!ownerId) return sendJson(response, 400, { error: { code: 'validation_error', message: 'ownerId query parameter is required' } });
        const tasks = await runtime.service.listTasks(ownerId, queryFilters(requestUrl));
        return sendJson(response, 200, { data: tasks, meta: { count: tasks.length } });
      }

      if (request.method === 'GET' && path === '/v1/tasks/brief') {
        const ownerId = requestUrl.searchParams.get('ownerId');
        if (!ownerId) return sendJson(response, 400, { error: { code: 'validation_error', message: 'ownerId query parameter is required' } });
        const brief = await runtime.service.taskBrief(ownerId, {
          now: requestUrl.searchParams.get('now') || undefined,
          horizonHours: requestUrl.searchParams.get('horizonHours') || undefined,
          limit: requestUrl.searchParams.get('limit') || undefined
        });
        return sendJson(response, 200, { data: brief });
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

module.exports = { createArthurHttpHandler, createArthurHttpServer, readJson, extractToken, tokensMatch, queryFilters };