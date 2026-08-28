'use strict';

const crypto = require('node:crypto');
const { ApplicationError } = require('../application/application_error');
const { PERMISSIONS, requirePermission } = require('../application/permissions');

const SESSION_COOKIE = 'business_kpi_session';
const CSRF_COOKIE = 'business_kpi_csrf';
const CSRF_HEADER = 'x-csrf-token';

function parseCookies(header) {
  const cookies = Object.create(null);
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name) cookies[name] = decodeURIComponent(rest.join('='));
  }
  return cookies;
}

function setCookie(response, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.maxAge != null) parts.push(`Max-Age=${options.maxAge}`);
  if (options.secure) parts.push('Secure');
  const existing = response.getHeader('Set-Cookie') || [];
  const normalized = Array.isArray(existing) ? existing : [existing];
  response.setHeader('Set-Cookie', [...normalized, parts.join('; ')]);
}

function clearCookie(response, name, options = {}) {
  setCookie(response, name, '', { ...options, maxAge: 0 });
}

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function createAuthMiddleware(options) {
  const {
    authService,
    devMode = false,
    cookieSecure = false,
    serviceKeys = [],
  } = options;

  const serviceKeyByValue = new Map(serviceKeys.map(entry => [entry.key, entry]));

  function resolveServiceActor(request) {
    const authorization = request.headers.authorization || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return null;
    const token = match[1];
    const service = serviceKeyByValue.get(token);
    if (!service) return null;
    return {
      id: service.id,
      displayName: service.name,
      role: 'SERVICE',
      type: 'service',
    };
  }

  async function resolveActor(request) {
    const serviceActor = resolveServiceActor(request);
    if (serviceActor) return serviceActor;

    const cookies = parseCookies(request.headers.cookie);
    const sessionToken = cookies[SESSION_COOKIE];
    if (sessionToken) {
      const sessionInfo = await authService.resolveSession(sessionToken, {
        ipAddress: request.socket?.remoteAddress,
        userAgent: request.headers['user-agent'],
      });
      if (sessionInfo) {
        const employee = await authService.store.getEmployeeByUserId(sessionInfo.user.id);
        return buildActor(sessionInfo.user, sessionInfo.session, employee);
      }
    }

    if (devMode) {
      const devActorId = request.headers['x-business-kpi-actor-id'];
      const devRole = request.headers['x-business-kpi-role'];
      if (devActorId && devRole) {
        return {
          id: String(devActorId),
          role: String(devRole).toUpperCase(),
          type: 'dev-header',
        };
      }
    }

    return null;
  }

  async function requireActor(request) {
    const actor = await resolveActor(request);
    if (!actor) {
      throw new ApplicationError('AUTH_REQUIRED', 'Требуется аутентификация.', 401);
    }
    return actor;
  }

  function validateCsrf(request) {
    if (devMode) return;
    // Service API-key authentication is not cookie-based and does not require CSRF.
    if (resolveServiceActor(request)) return;
    const cookies = parseCookies(request.headers.cookie);
    const csrfCookie = cookies[CSRF_COOKIE];
    const csrfHeader = request.headers[CSRF_HEADER];
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      throw new ApplicationError('CSRF_INVALID', 'Недействительный CSRF-токен.', 403);
    }
  }

  function setSessionCookies(response, sessionToken, csrfToken, maxAgeMs) {
    const maxAgeSeconds = Math.floor(maxAgeMs / 1000);
    const cookieOptions = {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: maxAgeSeconds,
      secure: cookieSecure,
    };
    setCookie(response, SESSION_COOKIE, sessionToken, cookieOptions);
    setCookie(response, CSRF_COOKIE, csrfToken, {
      sameSite: 'Lax',
      path: '/',
      maxAge: maxAgeSeconds,
      secure: cookieSecure,
    });
  }

  function clearSessionCookies(response) {
    clearCookie(response, SESSION_COOKIE, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      secure: cookieSecure,
    });
    clearCookie(response, CSRF_COOKIE, {
      sameSite: 'Lax',
      path: '/',
      secure: cookieSecure,
    });
  }

  return {
    CSRF_COOKIE,
    CSRF_HEADER,
    SESSION_COOKIE,
    clearSessionCookies,
    generateCsrfToken,
    parseCookies,
    requireActor,
    requirePermission: (actor, permission) => requirePermission(actor, permission),
    resolveActor,
    setSessionCookies,
    validateCsrf,
  };
}

function buildActor(user, session, employee) {
  return {
    id: user.id,
    externalId: user.externalId,
    displayName: user.displayName,
    role: user.role,
    storeId: user.storeId,
    active: user.active,
    sessionId: session?.id,
    employeeId: employee?.id || null,
    type: 'session',
  };
}

function isReadOperation(method) {
  return method === 'GET' || method === 'HEAD';
}

module.exports = {
  CSRF_COOKIE,
  CSRF_HEADER,
  SESSION_COOKIE,
  createAuthMiddleware,
  isReadOperation,
};
