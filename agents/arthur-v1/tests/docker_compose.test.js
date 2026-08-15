'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const composePath = path.resolve(__dirname, '..', '..', '..', 'docker', 'arthur', 'compose.yml');
const repositoryRoot = path.resolve(__dirname, '..', '..', '..');

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

test('telegram-gateway receives PURCHASING_RUNS_ROOT env var', () => {
  const compose = loadCompose();
  const env = compose.services['telegram-gateway'].environment;
  assert.equal(env.PURCHASING_RUNS_ROOT, '${PURCHASING_RUNS_ROOT:-/opt/arthur/output/purchasing-web/runs}');
});

test('telegram-gateway receives canonical owner profile ID env var', () => {
  const compose = loadCompose();
  const env = compose.services['telegram-gateway'].environment;
  assert.equal(env.ARTHUR_OWNER_PROFILE_ID, '${ARTHUR_OWNER_PROFILE_ID:?ARTHUR_OWNER_PROFILE_ID is required}');
});

test('telegram-gateway receives internal read-only Arthur Core configuration', () => {
  const compose = loadCompose();
  const gateway = compose.services['telegram-gateway'];
  assert.equal(gateway.environment.ARTHUR_CORE_BASE_URL, '${ARTHUR_CORE_BASE_URL:-http://api:8787}');
  assert.equal(gateway.environment.ARTHUR_CORE_TOKEN, '${ARTHUR_API_TOKEN:?ARTHUR_API_TOKEN is required}');
  assert.equal(gateway.environment.ARTHUR_CORE_TIMEOUT_MS, '${ARTHUR_CORE_TIMEOUT_MS:-5000}');
  assert.equal(gateway.depends_on.api.condition, 'service_healthy');
});

test('Arthur Core client token is not explicitly exposed to database or migration services', () => {
  const compose = loadCompose();
  assert.equal(compose.services.postgres.environment.ARTHUR_CORE_TOKEN, undefined);
  assert.equal(compose.services.migrate.environment.ARTHUR_CORE_TOKEN, undefined);
});

test('telegram-gateway mounts purchasing runs read-only', () => {
  const compose = loadCompose();
  const volumes = compose.services['telegram-gateway'].volumes || [];
  const runVolume = volumes.find(v =>
    typeof v === 'string' && v.includes('output/purchasing-web/runs')
  );
  assert.ok(runVolume, 'purchasing runs volume not found');
  assert.ok(runVolume.endsWith(':ro'), `expected read-only mount, got ${runVolume}`);
});

test('Yandex mail secret files are scoped only to telegram-gateway', () => {
  const compose = loadCompose();
  const gatewaySecrets = compose.services['telegram-gateway'].secrets || [];
  assert.deepEqual(gatewaySecrets.map(secret => secret.source), [
    'arthur_mailbox_miska_yandex_username',
    'arthur_mailbox_miska_yandex_app_password',
  ]);
  assert.deepEqual(gatewaySecrets.map(secret => secret.target), [
    'arthur_mailbox_miska_yandex_username',
    'arthur_mailbox_miska_yandex_app_password',
  ]);

  for (const serviceName of ['api', 'postgres', 'migrate']) {
    const service = compose.services[serviceName];
    assert.equal(service.secrets, undefined, `${serviceName} must not mount mail secrets`);
    const environmentKeys = Object.keys(service.environment || {});
    assert.equal(
      environmentKeys.some(key => key.startsWith('ARTHUR_MAILBOX_')),
      false,
      `${serviceName} must not receive mail configuration`
    );
  }
});

test('telegram-gateway receives non-secret Yandex config and secret file paths only', () => {
  const compose = loadCompose();
  const env = compose.services['telegram-gateway'].environment;
  assert.equal(env.ARTHUR_MAILBOX_MISKA_YANDEX_ENABLED, '${ARTHUR_MAILBOX_MISKA_YANDEX_ENABLED:-false}');
  assert.equal(env.ARTHUR_MAILBOX_MISKA_YANDEX_IMAP_HOST, '${ARTHUR_MAILBOX_MISKA_YANDEX_IMAP_HOST:-imap.yandex.ru}');
  assert.equal(env.ARTHUR_MAILBOX_MISKA_YANDEX_IMAP_PORT, '${ARTHUR_MAILBOX_MISKA_YANDEX_IMAP_PORT:-993}');
  assert.equal(env.ARTHUR_MAILBOX_MISKA_YANDEX_IMAP_TLS, '${ARTHUR_MAILBOX_MISKA_YANDEX_IMAP_TLS:-true}');
  assert.equal(env.ARTHUR_MAILBOX_MISKA_YANDEX_IMAP_FOLDER, '${ARTHUR_MAILBOX_MISKA_YANDEX_IMAP_FOLDER:-INBOX}');
  assert.equal(
    env.ARTHUR_MAILBOX_MISKA_YANDEX_USERNAME_SECRET_FILE,
    '/run/secrets/arthur_mailbox_miska_yandex_username'
  );
  assert.equal(
    env.ARTHUR_MAILBOX_MISKA_YANDEX_APP_PASSWORD_SECRET_FILE,
    '/run/secrets/arthur_mailbox_miska_yandex_app_password'
  );
  assert.equal(env.ARTHUR_MAILBOX_MISKA_YANDEX_USERNAME, undefined);
  assert.equal(env.ARTHUR_MAILBOX_MISKA_YANDEX_APP_PASSWORD, undefined);
});

test('Docker build context excludes local mail secrets and credentials', () => {
  const dockerIgnore = fs.readFileSync(path.join(repositoryRoot, '.dockerignore'), 'utf8');
  const gitIgnore = fs.readFileSync(path.join(repositoryRoot, '.gitignore'), 'utf8');
  assert.match(dockerIgnore, /^docker\/arthur\/secrets\/\*$/m);
  assert.match(dockerIgnore, /^\.env$/m);
  assert.match(dockerIgnore, /^\*\.key$/m);
  assert.match(gitIgnore, /^docker\/arthur\/secrets\/\*$/m);
});

test('mail dependencies include IMAP and parser libraries without an SMTP transport dependency', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
  assert.equal(packageJson.dependencies.imapflow, '^1.7.1');
  assert.equal(packageJson.dependencies.mailparser, '^3.9.15');
  assert.equal(packageJson.dependencies.nodemailer, undefined);
});
