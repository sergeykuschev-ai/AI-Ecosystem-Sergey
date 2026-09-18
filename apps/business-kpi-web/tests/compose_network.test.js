'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const yaml = require('js-yaml');

const composePath = path.resolve(__dirname, '../../../docker/business-kpi/compose.production.yml');
const { ROLE_PERMISSIONS, ROLES, PERMISSIONS } = require('../application/permissions');

function loadCompose() {
  return yaml.load(fs.readFileSync(composePath, 'utf8'));
}

function networkNames(networks) {
  if (!networks) return [];
  return Array.isArray(networks) ? networks : Object.keys(networks);
}

test('Business KPI web accepts configured service identities', () => {
  const compose = loadCompose();
  assert.equal(
    compose.services.web.environment.BUSINESS_KPI_SERVICE_KEYS,
    '${BUSINESS_KPI_SERVICE_KEYS:-[]}'
  );
});

test('Business KPI web joins external Arthur service network with stable alias', () => {
  const compose = loadCompose();
  const web = compose.services.web;
  assert.ok(networkNames(web.networks).includes('arthur_services'));
  assert.deepEqual(web.networks.arthur_services.aliases, ['business-kpi-api']);
  assert.equal(compose.networks.arthur_services.external, true);
  assert.equal(compose.networks.arthur_services.name, '${ARTHUR_SERVICES_NETWORK:-arthur_services}');
});

test('Business KPI PostgreSQL never joins Arthur service network', () => {
  const compose = loadCompose();
  assert.equal(networkNames(compose.services.postgres.networks).includes('arthur_services'), false);
  assert.equal(networkNames(compose.services.migrate.networks).includes('arthur_services'), false);
  assert.equal(networkNames(compose.services['bootstrap-users'].networks).includes('arthur_services'), false);
});

test('Business KPI host exposure remains loopback-only', () => {
  const compose = loadCompose();
  assert.deepEqual(compose.services.web.ports, ['127.0.0.1:${BUSINESS_KPI_WEB_PORT:-3220}:3220']);
});

test('SERVICE role remains read-only', () => {
  const allowed = ROLE_PERMISSIONS[ROLES.SERVICE];
  const forbidden = [
    PERMISSIONS.SHIFT_CREATE,
    PERMISSIONS.SHIFT_CREATE_OWN,
    PERMISSIONS.SHIFT_EDIT_ANY,
    PERMISSIONS.SHIFT_EDIT_OWN,
    PERMISSIONS.SHIFT_ARCHIVE_ANY,
    PERMISSIONS.SHIFT_ARCHIVE_OWN,
    PERMISSIONS.SETTINGS_WRITE,
    PERMISSIONS.PLAN_WRITE,
    PERMISSIONS.IMPORT_WRITE,
    PERMISSIONS.EXPORT_RUN,
    PERMISSIONS.USERS_MANAGE,
    PERMISSIONS.TASKS_MANAGE,
  ];
  for (const permission of forbidden) {
    assert.equal(allowed.includes(permission), false, `SERVICE must not have ${permission}`);
  }
  assert.ok(allowed.includes(PERMISSIONS.DASHBOARD_READ));
  assert.ok(allowed.includes(PERMISSIONS.SHIFTS_READ));
  assert.ok(allowed.includes(PERMISSIONS.SELLER_PERFORMANCE_READ));
});
