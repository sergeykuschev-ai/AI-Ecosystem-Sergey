'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');

const repositoryRoot = path.resolve(__dirname, '../../..');
const composePath = path.join(repositoryRoot, 'docker/business-kpi/compose.test.yml');
const envPath = path.join(repositoryRoot, 'docker/business-kpi/.env.test.example');

test('Business KPI test compose is isolated from Arthur production storage', () => {
  const source = fs.readFileSync(composePath, 'utf8');
  const compose = yaml.load(source);
  assert.equal(compose.name, 'business-kpi-test');
  assert.equal(compose.services.postgres.image, 'postgres:16-alpine');
  assert.equal(compose.services.postgres.ports, undefined);
  assert.deepEqual(
    compose.services.postgres.volumes,
    ['business_kpi_test_postgres_data:/var/lib/postgresql/data']
  );
  assert.equal(compose.networks.business_kpi_test_internal.internal, true);
  assert.equal(
    compose.volumes.business_kpi_test_postgres_data.name,
    'business_kpi_test_postgres_data'
  );
  assert.doesNotMatch(source, /arthur_postgres_data|\/arthur(?:\s|$)/);
});

test('test Web, migration and integration services are fail-closed', () => {
  const compose = yaml.load(fs.readFileSync(composePath, 'utf8'));
  const web = compose.services['business-kpi-web'];
  const migrate = compose.services['business-kpi-migrate'];
  const integration = compose.services['business-kpi-test'];
  assert.deepEqual(web.ports, ['127.0.0.1:${BUSINESS_KPI_TEST_WEB_PORT:-3220}:3220']);
  assert.equal(web.environment.BUSINESS_KPI_STORAGE_MODE.includes('postgresql'), true);
  assert.equal(web.environment.BUSINESS_KPI_SEED_REFERENCE_DATA, 'false');
  assert.deepEqual(migrate.command, [
    'node', 'apps/business-kpi-web/storage/run-migrations.js',
  ]);
  assert.equal(integration.volumes[0].read_only, true);
  assert.equal(integration.environment.BUSINESS_KPI_REAL_XLSX_ROOT, '/test-inputs');
  assert.deepEqual(integration.command, [
    'npm', 'run', 'test:business-kpi:postgres',
  ]);
});

test('test env template contains placeholders but no committed secret', () => {
  const env = fs.readFileSync(envPath, 'utf8');
  assert.match(env, /BUSINESS_KPI_TEST_DB_NAME=business_kpi_test/);
  assert.match(env, /BUSINESS_KPI_TEST_STORAGE_MODE=postgresql/);
  assert.match(env, /replace-with-a-url-safe-test-password/);
  assert.doesNotMatch(env, /ARTHUR_POSTGRES_PASSWORD/);
});
