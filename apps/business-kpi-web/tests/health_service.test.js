'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { HealthService } = require('../application/health_service');

test('PostgreSQL health is checked and reported healthy', async () => {
  const service = new HealthService({
    databaseSchema: 'business_kpi',
    devMode: true,
    storageProvider: 'postgresql',
    checkStorage: async () => true,
  });
  const health = await service.getHealth();
  assert.equal(health.status, 'ok');
  assert.deepEqual(health.storage, {
    provider: 'postgresql',
    schema: 'business_kpi',
    configured: true,
    checked: true,
    healthy: true,
  });
});

test('PostgreSQL health degrades without leaking connection details', async () => {
  const service = new HealthService({
    databaseSchema: 'business_kpi',
    devMode: true,
    storageProvider: 'postgresql',
    checkStorage: async () => {
      throw new Error('password=do-not-expose');
    },
  });
  const health = await service.getHealth();
  assert.equal(health.status, 'degraded');
  assert.equal(health.storage.checked, true);
  assert.equal(health.storage.healthy, false);
  assert.doesNotMatch(JSON.stringify(health), /do-not-expose/);
});
