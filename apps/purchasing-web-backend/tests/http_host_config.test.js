'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  DEFAULT_HTTP_HOST,
  resolveHttpHost,
} = require('../config');

test('HTTP host defaults to loopback for local safety', () => {
  assert.equal(resolveHttpHost(undefined), DEFAULT_HTTP_HOST);
  assert.equal(resolveHttpHost(''), DEFAULT_HTTP_HOST);
});

test('HTTP host accepts explicit Docker bind address', () => {
  assert.equal(resolveHttpHost('0.0.0.0'), '0.0.0.0');
  assert.equal(resolveHttpHost(' 0.0.0.0 '), '0.0.0.0');
});

test('HTTP host rejects malformed values', () => {
  assert.throws(() => resolveHttpHost('bad host'), TypeError);
  assert.throws(() => resolveHttpHost('host/path'), TypeError);
  assert.throws(() => resolveHttpHost('   '), TypeError);
});
