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

  test('telegram proxy is outbound-only and publishes no host ports', () => {
    const proxy = compose.services['telegram-proxy'];
    assert.ok(proxy, 'telegram-proxy service must exist');
    const networks = normalizeNetworks(proxy.networks);
    assert.deepEqual(networks, ['arthur_outbound'], 'telegram-proxy must be outbound-only');
    assert.ok(!proxy.ports || proxy.ports.length === 0, 'telegram-proxy must not publish host ports');
    assert.deepEqual(proxy.cap_drop, ['ALL'], 'telegram-proxy must drop Linux capabilities');
    assert.ok(proxy.security_opt.includes('no-new-privileges:true'), 'telegram-proxy must disable privilege escalation');
    assert.equal(proxy.read_only, true, 'telegram-proxy root filesystem must be read-only');
  });

  test('telegram-gateway is attached to internal and outbound networks and depends on proxy health', () => {
    const gateway = compose.services['telegram-gateway'];
    assert.ok(gateway, 'telegram-gateway service must exist');
    const networks = normalizeNetworks(gateway.networks);
    assert.ok(networks.includes('arthur_internal'), 'telegram-gateway must be on arthur_internal');
    assert.ok(networks.includes('arthur_outbound'), 'telegram-gateway must be on arthur_outbound');
    assert.equal(gateway.depends_on['telegram-proxy'].condition, 'service_healthy');
    assert.equal(gateway.environment.HTTP_PROXY, '${TELEGRAM_HTTP_PROXY:-http://telegram-proxy:18443}');
    assert.equal(gateway.environment.HTTPS_PROXY, '${TELEGRAM_HTTPS_PROXY:-http://telegram-proxy:18443}');
    assert.match(gateway.environment.NO_PROXY, /api/);
    assert.match(gateway.environment.NO_PROXY, /postgres/);
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

  test('Arthur services support an external production env file', () => {
    for (const serviceName of ['migrate', 'api', 'telegram-gateway']) {
      const service = compose.services[serviceName];
      assert.ok(service.env_file, `${serviceName} must declare env_file`);
      const files = Array.isArray(service.env_file) ? service.env_file : [service.env_file];
      assert.ok(files.some(entry => {
        const value = typeof entry === 'string' ? entry : entry.path || entry;
        return value === '${ARTHUR_ENV_FILE:-.env}';
      }), `${serviceName} env_file must support ARTHUR_ENV_FILE`);
    }
  });
});

function normalizeNetworks(networks) {
  if (!networks) return [];
  if (Array.isArray(networks)) return networks.map(String);
  return Object.keys(networks);
}
