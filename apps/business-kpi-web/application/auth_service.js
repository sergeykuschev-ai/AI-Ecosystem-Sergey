'use strict';

const crypto = require('node:crypto');
const { ApplicationError } = require('./application_error');

const SCRYPT_PARAMS = Object.freeze({
  N: 32768,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
});
const SALT_LEN = 32;
const KEY_LEN = 64;
const SESSION_TOKEN_LEN = 32;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(SALT_LEN);
    crypto.scrypt(password, salt, KEY_LEN, SCRYPT_PARAMS, (err, derived) => {
      if (err) return reject(err);
      const hash = Buffer.concat([salt, derived]).toString('base64');
      resolve(hash);
    });
  });
}

function verifyPassword(password, hash) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(hash, 'base64');
    if (buf.length < SALT_LEN + KEY_LEN) return resolve(false);
    const salt = buf.subarray(0, SALT_LEN);
    const expected = buf.subarray(SALT_LEN, SALT_LEN + KEY_LEN);
    crypto.scrypt(password, salt, KEY_LEN, SCRYPT_PARAMS, (err, derived) => {
      if (err) return reject(err);
      resolve(crypto.timingSafeEqual(expected, derived));
    });
  });
}

function generateSessionToken() {
  return crypto.randomBytes(SESSION_TOKEN_LEN).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('base64');
}

class AuthService {
  constructor({ store, now = () => new Date() }) {
    this.store = store;
    this.now = now;
  }

  async createUser({ externalId, displayName, role, storeId, password }) {
    const passwordHash = await hashPassword(password);
    return this.store.createUser({
      externalId,
      displayName,
      role,
      storeId,
      passwordHash,
    });
  }

  async setPassword(userId, password) {
    const passwordHash = await hashPassword(password);
    return this.store.updateUserPasswordHash(userId, passwordHash);
  }

  async authenticate({ externalId, password, ipAddress, userAgent }) {
    const user = await this.store.getUserByExternalId(externalId);
    if (!user || !user.active) {
      throw new ApplicationError('AUTH_INVALID_CREDENTIALS', 'Неверный логин или пароль.', 401);
    }
    if (user.lockedUntil && new Date(user.lockedUntil) > this.now()) {
      throw new ApplicationError('AUTH_ACCOUNT_LOCKED', 'Учётная запись временно заблокирована.', 423);
    }
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      await this.store.incrementFailedLogins(user.id, MAX_FAILED_ATTEMPTS, LOCKOUT_MS);
      throw new ApplicationError('AUTH_INVALID_CREDENTIALS', 'Неверный логин или пароль.', 401);
    }
    await this.store.resetFailedLogins(user.id);
    const token = generateSessionToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(this.now().getTime() + SESSION_TTL_MS);
    await this.store.createSession({
      userId: user.id,
      tokenHash,
      expiresAt,
      ipAddress,
      userAgent,
    });
    await this.store.updateUserLastLogin(user.id, this.now());
    return { token, user: publicUser(user) };
  }

  async resolveSession(token, { ipAddress, userAgent } = {}) {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const session = await this.store.getSessionByTokenHash(tokenHash);
    if (!session || new Date(session.expiresAt) <= this.now()) return null;
    const user = await this.store.getUserById(session.userId);
    if (!user || !user.active) return null;
    await this.store.touchSession(session.id, this.now());
    return { session, user: publicUser(user) };
  }

  async logout(token) {
    if (!token) return;
    await this.store.deleteSessionByTokenHash(hashToken(token));
  }

  async logoutAll(userId) {
    await this.store.deleteUserSessions(userId);
  }
}

function publicUser(user) {
  return {
    id: user.id,
    externalId: user.externalId,
    displayName: user.displayName,
    role: user.role,
    storeId: user.storeId,
    active: user.active,
    lastLoginAt: user.lastLoginAt,
  };
}

module.exports = {
  AuthService,
  SESSION_TTL_MS,
  hashPassword,
  verifyPassword,
  hashToken,
};
