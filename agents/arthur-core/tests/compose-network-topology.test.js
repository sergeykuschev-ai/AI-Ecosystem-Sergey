'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, describe } = require('node:test');

const composePath = path.join(__dirname, '../../../docker/arthur/compose.yml');

function loadCompose() {
  const yaml = require('js-yaml');
  const content = fs.readFileSync(composePath, 'utf8');
  return yaml.load(content);
}

describe('docker/arthur/compose.yml network topology', () => {
  const compose = loadCompose();

  test('arthur_internal network is internal-only', () => {
    assert.ok(compose.networks.arthur_internal, 'arthur_internal network must exist');
    assert.equal(compose.networks.arthur_internal.internal, true, 'arthur_internal must be internal');
  });

  test('arthur_n8n network is preserved', () => {
    assert.ok(compose.networks.arthur_n8n, 'arthur_n8n network must exist');
  });

  test('arthur_outbound network exists and is not internal', () => {
    assert.ok(compose.networks.arthur_outbound, 'arthur_outbound network must exist');
    assert.notEqual(compose.networks.arthur_outbound.internal, true, 'arthur_outbound must allow outbound traffic');
  });

  test('telegram-gateway is attached to internal and outbound networks', () => {
    const gateway = compose.services['telegram-gateway'];
    assert.ok(gateway, 'telegram-gateway service must exist');
    const networks = normalizeNetworks(gateway.networks);
    assert.ok(networks.includes('arthur_internal'), 'telegram-gateway must be on arthur_internal');
    assert.ok(networks.includes('arthur_outbound'), 'telegram-gateway must be on arthur_outbound');
  });

  test('postgres is not attached to outbound network', () => {
    const networks = normalizeNetworks(compose.services.postgres.networks);
    assert.ok(networks.includes('arthur_internal'), 'postgres must be on arthur_internal');
    assert.equal(networks.includes('arthur_outbound'), false, 'postgres must not be on arthur_outbound');
  });

  test('api is not attached to outbound network', () => {
    const networks = normalizeNetworks(compose.services.api.networks);
    assert.ok(networks.includes('arthur_internal'), 'api must be on arthur_internal');
    assert.equal(networks.includes('arthur_outbound'), false, 'api must not be on arthur_outbound');
  });

  test('api exposes no host ports', () => {
    const api = compose.services.api;
    assert.ok(!api.ports || api.ports.length === 0, 'api must not publish host ports');
  });

  test('telegram-gateway has env_file for explicit .env loading', () => {
    const gateway = compose.services['telegram-gateway'];
    assert.ok(gateway.env_file, 'telegram-gateway must declare env_file');
    const files = Array.isArray(gateway.env_file) ? gateway.env_file : [gateway.env_file];
    assert.ok(files.some(entry => {
      const value = typeof entry === 'string' ? entry : entry.path || entry;
      return value === '.env';
    }), 'telegram-gateway env_file must include .env');
  });
});

function normalizeNetworks(networks) {
  if (!networks) return [];
  if (Array.isArray(networks)) return networks.map(String);
  return Object.keys(networks);
}
