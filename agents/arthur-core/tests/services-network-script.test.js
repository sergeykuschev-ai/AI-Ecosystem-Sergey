'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const scriptPath = path.resolve(__dirname, '../../../scripts/arthur/ensure-services-network.sh');
const script = fs.readFileSync(scriptPath, 'utf8');

test('Arthur shared service network is created internal-only', () => {
  assert.match(script, /docker network create[\s\S]*--internal[\s\S]*"\$NETWORK_NAME"/);
  assert.match(script, /--driver bridge/);
});

test('existing shared network must remain internal and bridge', () => {
  assert.match(script, /\.Internal/);
  assert.match(script, /Refusing non-internal shared network/);
  assert.match(script, /\.Driver/);
  assert.match(script, /Refusing non-bridge shared network/);
});

test('network name is configurable but defaults to arthur_services', () => {
  assert.match(script, /ARTHUR_SERVICES_NETWORK:-arthur_services/);
});
