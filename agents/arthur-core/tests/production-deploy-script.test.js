'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const scriptPath = path.resolve(__dirname, '../../../scripts/arthur/deploy-production.sh');
const script = fs.readFileSync(scriptPath, 'utf8');

test('production deploy defaults to external protected env and core-only phase', () => {
  assert.match(script, /ARTHUR_ENV_FILE:-\/opt\/arthur\/config\/production\.env/);
  assert.match(script, /ARTHUR_DEPLOY_GATEWAY:-false/);
  assert.match(script, /ARTHUR_CONNECT_N8N:-false/);
  assert.match(script, /up -d --build postgres migrate api/);
});

test('production deploy does not require n8n unless explicitly requested', () => {
  const n8nGuard = script.indexOf('if [ "$CONNECT_N8N" = true ]');
  const n8nInspect = script.indexOf('docker inspect "$N8N_CONTAINER"');
  assert.ok(n8nGuard >= 0);
  assert.ok(n8nInspect > n8nGuard);
});

test('production deploy refuses insecure env permissions and published Arthur API', () => {
  assert.match(script, /find "\$ENV_FILE" -perm \/077/);
  assert.match(script, /Arthur API unexpectedly publishes a host port/);
  assert.match(script, /"8787\/tcp":null/);
});

test('production deploy keeps Telegram as explicit second phase', () => {
  const gatewayGuard = script.indexOf('if [ "$DEPLOY_GATEWAY" = true ]');
  const gatewayStart = script.indexOf('up -d --build telegram-gateway');
  assert.ok(gatewayGuard >= 0);
  assert.ok(gatewayStart > gatewayGuard);
});
