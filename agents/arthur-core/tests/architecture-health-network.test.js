'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const scriptPath = path.resolve(__dirname, '../../../scripts/ops/architecture-health.py');
const script = fs.readFileSync(scriptPath, 'utf8');

test('architecture health monitors Arthur shared service network as internal bridge', () => {
  assert.ok(script.includes('ARTHUR_SERVICES_NETWORK'));
  assert.ok(script.includes("['docker','network','inspect',services_network]"));
  assert.ok(script.includes('arthur_services_internal'));
  assert.ok(script.includes('not_internal'));
  assert.ok(script.includes('arthur_services_driver'));
  assert.ok(script.includes("driver != 'bridge'"));
});

test('architecture health requires KPI web and stable private alias', () => {
  assert.ok(script.includes('business-kpi-web-1'));
  assert.ok(script.includes('business-kpi-api_alias:missing'));
  assert.ok(script.includes('arthur_services_kpi_aliases'));
});

test('architecture health rejects databases and Arthur Core API on shared service network', () => {
  for (const name of [
    'app-postgres-1',
    'business-kpi-postgres-1',
    'arthur-core-postgres-1',
    'arthur-core-api-1',
  ]) {
    assert.ok(script.includes(name), `missing forbidden member ${name}`);
  }
  assert.ok(script.includes('arthur_services_forbidden_members'));
  assert.ok(script.includes('forbidden_members'));
});
