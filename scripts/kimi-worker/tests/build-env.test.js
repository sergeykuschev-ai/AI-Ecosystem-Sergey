'use strict';

// Issue #37 follow-up: `npm run build` in the stores-web validation worktree
// failed with "NEXT_PUBLIC_SITE_URL or SITE_URL must be configured". The
// worktree deliberately has no .env, so the build must receive a hermetic,
// fixed, non-secret test environment. These tests prove that the build env
// consists of ONLY the runtime minimum (PATH/HOME/npm cache) plus the
// allowlisted fixed overrides — nothing from .env, nothing from the process
// environment, no production values, no credentials.

const test = require('node:test');
const assert = require('node:assert');

const config = require('../config');
const { run, npmCheckEnv } = require('../checks');

const STORES_AREA = config.areas['area:stores-web'];

const ALLOWED_OVERRIDES = Object.freeze({
  NEXT_PUBLIC_SITE_URL: 'https://example.invalid',
  CONTENT_SOURCE: 'mock',
});

const BASE_KEYS = ['PATH', 'HOME', 'npm_config_cache'];

// --- 1. The area declares exactly the allowed fixed overrides, frozen

test('stores-web area declares exactly the allowed fixed build test env', () => {
  assert.ok(STORES_AREA.buildTestEnv, 'area must declare buildTestEnv');
  assert.deepEqual({ ...STORES_AREA.buildTestEnv }, { ...ALLOWED_OVERRIDES });
  assert.deepEqual(Object.keys(STORES_AREA.buildTestEnv).sort(), Object.keys(ALLOWED_OVERRIDES).sort());
  assert.ok(Object.isFrozen(STORES_AREA.buildTestEnv), 'buildTestEnv must be frozen');
});

// --- 2. The env handed to the build contains nothing beyond base + allowlist

test('npmCheckEnv contains only base runtime keys plus the allowed overrides', () => {
  const env = npmCheckEnv(STORES_AREA);
  assert.deepEqual(Object.keys(env).sort(), [...BASE_KEYS, ...Object.keys(ALLOWED_OVERRIDES)].sort());
  for (const [key, value] of Object.entries(ALLOWED_OVERRIDES)) {
    assert.equal(env[key], value);
  }
});

test('npmCheckEnv does not inherit the process environment (no secret leakage)', () => {
  const sentinel = 'sentinel-should-not-leak-0123456789abcdef';
  const touched = {
    DIRECTUS_SERVER_TOKEN: process.env.DIRECTUS_SERVER_TOKEN,
    DIRECTUS_ADMIN_TOKEN: process.env.DIRECTUS_ADMIN_TOKEN,
    DIRECTUS_ADMIN_PASSWORD: process.env.DIRECTUS_ADMIN_PASSWORD,
    INDEXNOW_KEY: process.env.INDEXNOW_KEY,
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,
    SITE_URL: process.env.SITE_URL,
    DIRECTUS_URL: process.env.DIRECTUS_URL,
  };
  for (const key of Object.keys(touched)) process.env[key] = sentinel;
  try {
    const env = npmCheckEnv(STORES_AREA);
    assert.ok(!Object.values(env).includes(sentinel), 'process env values must not leak into build env');
    for (const key of Object.keys(touched)) {
      assert.ok(!(key in env), `${key} must not be present in build env`);
    }
  } finally {
    for (const [key, value] of Object.entries(touched)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

// --- 3. The fixed values are non-secret and non-production

test('fixed overrides are non-secret and not production values', () => {
  for (const [key, value] of Object.entries(ALLOWED_OVERRIDES)) {
    assert.doesNotMatch(value, /amurskmarket\.ru/i, `${key} must not be the production origin`);
    assert.doesNotMatch(value, /localhost|127\.0\.0\.1/i, `${key} must be a fixed test value, not a local origin`);
    for (const { name, re } of config.secretPatterns) {
      assert.doesNotMatch(value, re, `${key} matches secret pattern ${name}`);
    }
    assert.ok(!/token|password|secret|credential|api[_-]?key/i.test(value), `${key} must not carry credential semantics`);
  }
});

// --- 4. End-to-end: a child process started with npmCheckEnv sees ONLY the allowed variables

test('child process started with npmCheckEnv sees exactly the allowed variables', async () => {
  const env = npmCheckEnv(STORES_AREA);
  const result = await run('/usr/bin/env', [], { env, timeoutMs: 30 * 1000 });
  assert.ok(result.ok, `/usr/bin/env failed: ${result.stderr}`);
  const childLines = result.stdout.trim().split('\n').filter(Boolean).sort();
  const expected = Object.entries(env).map(([k, v]) => `${k}=${v}`).sort();
  assert.deepEqual(childLines, expected);
  for (const forbidden of ['DIRECTUS_SERVER_TOKEN', 'DIRECTUS_ADMIN_TOKEN', 'DIRECTUS_ADMIN_PASSWORD', 'INDEXNOW_KEY', 'POSTGRES_PASSWORD', 'SITE_URL', 'DIRECTUS_URL']) {
    assert.ok(!childLines.some((l) => l.startsWith(`${forbidden}=`)), `${forbidden} leaked to child`);
  }
});
