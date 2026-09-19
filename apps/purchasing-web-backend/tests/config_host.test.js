const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  DEFAULT_HTTP_HOST,
  resolveHttpHost,
} = require('../config');

test('purchasing web host defaults to loopback', () => {
  assert.equal(resolveHttpHost(''), DEFAULT_HTTP_HOST);
});

test('purchasing web host accepts explicit container bind address', () => {
  assert.equal(resolveHttpHost('0.0.0.0'), '0.0.0.0');
});

test('purchasing web host rejects malformed values', () => {
  assert.throws(() => resolveHttpHost('bad host'), /PURCHASING_WEB_HOST/);
});
