'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const composePath = path.resolve(__dirname, '..', '..', '..', 'docker', 'arthur', 'compose.yml');

function loadCompose() {
  const content = fs.readFileSync(composePath, 'utf8');
  return yaml.load(content);
}

test('compose file exists and is valid yaml', () => {
  const compose = loadCompose();
  assert.ok(compose.services);
  assert.ok(compose.services.api);
  assert.ok(compose.services['telegram-gateway']);
  assert.ok(compose.services.postgres);
});

test('api service receives OmniRoute env vars', () => {
  const compose = loadCompose();
  const env = compose.services.api.environment;
  assert.equal(env.ARTHUR_AI_PROVIDER, '${ARTHUR_AI_PROVIDER:-fake}');
  assert.equal(env.OMNIROUTE_BASE_URL, '${OMNIROUTE_BASE_URL:-}');
  assert.equal(env.OMNIROUTE_API_KEY, '${OMNIROUTE_API_KEY:-}');
  assert.equal(env.OMNIROUTE_FAST_MODEL, '${OMNIROUTE_FAST_MODEL:-arthur-fast}');
  assert.equal(env.OMNIROUTE_REASONING_MODEL, '${OMNIROUTE_REASONING_MODEL:-arthur-fast}');
  assert.equal(env.OMNIROUTE_CODE_MODEL, '${OMNIROUTE_CODE_MODEL:-arthur-fast}');
});

test('postgres service does not receive OmniRoute env vars', () => {
  const compose = loadCompose();
  const env = compose.services.postgres.environment;
  assert.equal(env.ARTHUR_AI_PROVIDER, undefined);
  assert.equal(env.OMNIROUTE_API_KEY, undefined);
});

test('migrate service does not receive OmniRoute env vars', () => {
  const compose = loadCompose();
  const env = compose.services.migrate.environment;
  assert.equal(env.ARTHUR_AI_PROVIDER, undefined);
  assert.equal(env.OMNIROUTE_API_KEY, undefined);
});

test('telegram-gateway service does not receive OmniRoute env vars', () => {
  const compose = loadCompose();
  const env = compose.services['telegram-gateway'].environment;
  assert.equal(env.ARTHUR_AI_PROVIDER, undefined);
  assert.equal(env.OMNIROUTE_API_KEY, undefined);
});

test('telegram-gateway is attached to outbound network', () => {
  const compose = loadCompose();
  const networks = compose.services['telegram-gateway'].networks;
  assert.ok(networks.includes('arthur_internal') || networks.arthur_internal !== undefined);
  assert.ok(networks.includes('arthur_outbound') || networks.arthur_outbound !== undefined);
});

test('internal network is marked internal', () => {
  const compose = loadCompose();
  assert.equal(compose.networks.arthur_internal.internal, true);
});
