'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const {
  buildExcelMessage,
  imapSinceDate,
} = require('../../../scripts/arthur/minmax-mail-protocol');
const {
  buildE2EMailOptions,
  buildE2ESubject,
  collectBackendDiagnostics,
  ensurePersistentBackend,
  inspectHistoricalExecution,
  latestOutputJson,
  productionConfig,
  productionEnvironment: buildProductionEnvironment,
  registryNodeSnapshot,
  runDockerNodeFromStdin,
  runE2EWithAutomaticRestore,
  verifyConnectionRefused,
  verifyBackendHealthResponse,
  verifyContainerRuntime,
  verifyCredentialMetadata,
  verifyDeployedRuntimeConfig,
  waitForE2EExecution,
} = require('../../../scripts/arthur/minmax-production-check');
const {
  bindCredentials,
  bindFixedRuntimeConfig,
} = require('../../../scripts/arthur/minmax-n8n-workflow-deployment');

const ROOT = path.resolve(__dirname, '../../..');
const workflow = JSON.parse(fs.readFileSync(path.join(
  ROOT,
  'n8n/workflows/arthur-minmax-yandex-mail-intake-fixed.json'
), 'utf8'));

function productionEnvironment(overrides = {}) {
  return {
    N8N_API_KEY: 'n8n-secret',
    PURCHASING_API_TOKEN: '0123456789abcdef',
    MINMAX_E2E_MAIL_USER: 'e2e-sender@example.test',
    MINMAX_E2E_MAIL_PASSWORD: 'mail-secret',
    MINMAX_NOTIFY_EMAIL: 'owner@example.test',
    MINMAX_NOTIFICATION_IMAP_USER: 'owner@example.test',
    MINMAX_NOTIFICATION_IMAP_PASSWORD: 'notification-secret',
    MINMAX_SMTP_FROM: 'robot@example.test',
    ...overrides,
  };
}

function publishedRecord(runtimeConfig, versionId) {
  const deployed = bindCredentials(
    bindFixedRuntimeConfig(workflow, runtimeConfig),
    {
      httpHeaderAuth: 'pjXec1bxtt81cy0u',
      imap: 'Od4UJQh12iTGufks',
      smtp: 'zOGxEOJGUvn59jgC',
    }
  );
  return {
    active: true,
    versionId,
    activeVersionId: versionId,
    activeVersion: {
      versionId,
      nodes: deployed.nodes,
      connections: deployed.connections,
    },
  };
}

function transactionHarness(options = {}) {
  const config = productionConfig(productionEnvironment());
  config.shortSha = '8d530fe';
  const originalRuntime = {
    apiBaseUrl: 'http://production-backend.internal:3210',
    ownerUiBaseUrl: 'https://owner.example.test',
    allowedSender: 'supplier@example.test',
    subjectPattern: 'supplier minmax report',
    notifyTo: 'operations@example.test',
    notifyFrom: 'minmax@example.test',
    ...options.originalRuntime,
  };
  const e2eRuntime = {
    apiBaseUrl: config.backendContainerBaseUrl,
    ownerUiBaseUrl: config.ownerUrl,
    allowedSender: config.allowedSender,
    subjectPattern: config.subjectPattern,
    notifyTo: config.notifyEmail,
    notifyFrom: config.smtpFrom,
  };
  const records = [
    publishedRecord(originalRuntime, 'production-v1'),
    publishedRecord(e2eRuntime, 'e2e-v2'),
    publishedRecord(originalRuntime, 'restored-v3'),
  ];
  const deployEnvironments = [];
  let e2eCalls = 0;
  const credentialTypes = {
    [config.n8n.credentials.httpHeaderAuth]: 'httpHeaderAuth',
    [config.n8n.credentials.imap]: 'imap',
    [config.n8n.credentials.smtp]: 'smtp',
  };
  const client = {
    async getWorkflow() {
      const record = records.shift();
      if (!record) throw new Error('Unexpected workflow read.');
      return record;
    },
    async request(method, endpoint) {
      assert.equal(method, 'GET');
      const id = endpoint.split('/').at(-1);
      return { id, name: `credential-${id}`, type: credentialTypes[id] };
    },
  };
  const dependencies = {
    logger: { log() {} },
    async deploy(environment) {
      deployEnvironments.push(environment);
      if (options.restoreFails && deployEnvironments.length === 2) {
        throw new Error('restore publish rejected');
      }
      return { publishedVersionId: `published-${deployEnvironments.length}` };
    },
    async runMailE2E() {
      e2eCalls += 1;
      if (options.e2eError) throw options.e2eError;
      return { executionId: 'new-execution', runId: 'new-run' };
    },
  };
  return {
    client,
    config,
    dependencies,
    deployEnvironments,
    get e2eCalls() { return e2eCalls; },
    originalRuntime,
  };
}

function execution(overrides = {}) {
  return {
    id: 'e2e-100',
    workflowId: 'minmaxYandexIntakeFixed01',
    startedAt: '2026-08-02T00:00:00.000Z',
    status: 'success',
    finished: true,
    data: {
      resultData: {
        runData: {
          'Конфигурация MinMax': [{
            data: { main: [[{ json: { subject: 'MinMax production E2E marker' } }]] },
          }],
          'Сформировать уведомление': [{
            data: { main: [[{ json: { runId: 'run-1' } }]] },
          }],
        },
      },
    },
    ...overrides,
  };
}

function healthResponse(overrides = {}) {
  const body = {
    data: {
      status: 'ok',
      service: 'purchasing-web',
      build_sha: 'd14d642',
      ...overrides.data,
    },
  };
  return {
    method: 'GET',
    requestPath: '/api/v1/health',
    status: overrides.status ?? 200,
    contentType: overrides.contentType || 'application/json; charset=utf-8',
    text: overrides.text === undefined ? JSON.stringify(body) : overrides.text,
    json: overrides.json === undefined ? body : overrides.json,
  };
}

function healthyContainerRuntime(overrides = {}) {
  return {
    status: 'running',
    health: 'healthy',
    exitCode: 0,
    oomKilled: false,
    restartCount: 0,
    publishedPorts: {
      '3210/tcp': [{ HostIp: '0.0.0.0', HostPort: '3210' }],
    },
    workingDirectory: '/app',
    imageCommand: ['node', 'apps/purchasing-web-backend/server.js'],
    runtimeProbe: 'runtime-ok',
    ...overrides,
  };
}

function containerRuntimeCommand(overrides = {}) {
  const values = {
    '{{json .State}}': {
      Status: 'running',
      ExitCode: 0,
      Error: '',
      OOMKilled: false,
      Health: { Status: 'healthy' },
    },
    '{{json .RestartCount}}': 0,
    '{{json .NetworkSettings.Ports}}': {
      '3210/tcp': [{ HostIp: '0.0.0.0', HostPort: '3210' }],
    },
    '{{json .Config.WorkingDir}}': '/app',
    '{{json .Config.Cmd}}': ['node', 'apps/purchasing-web-backend/server.js'],
    ...overrides,
  };
  return (command, args) => {
    assert.equal(command, 'docker');
    if (args[0] === 'exec') return 'runtime-ok';
    return JSON.stringify(values[args[2]]);
  };
}

test('production config uses required runtime values and production ids', () => {
  const config = productionConfig(productionEnvironment());

  assert.equal(config.n8n.workflowId, 'minmaxYandexIntakeFixed01');
  assert.equal(config.n8n.credentials.httpHeaderAuth, 'pjXec1bxtt81cy0u');
  assert.equal(config.n8n.credentials.imap, 'Od4UJQh12iTGufks');
  assert.equal(config.n8n.credentials.smtp, 'zOGxEOJGUvn59jgC');
  assert.equal(config.n8n.container, 'n8n');
  assert.equal(config.mail.smtpHost, 'smtp.yandex.ru');
  assert.equal(config.mail.imapHost, 'imap.yandex.ru');
  assert.equal(config.allowedSender, 'e2e-sender@example.test');
  assert.equal(config.subjectPattern, 'minmax production e2e');
  assert.equal(config.executionId, null);
  assert.match(config.ownerUrl, /^http:\/\/[^/]+:3210$/);
});

test('production config rejects missing secrets and placeholder owner URL', () => {
  assert.throws(() => productionConfig({}), /MINMAX_E2E_MAIL_USER/);
  assert.throws(() => productionConfig(productionEnvironment({
    MINMAX_OWNER_UI_BASE_URL: 'http://<SERVER-IP>:3210',
  })), /absolute usable URL/);
  assert.throws(
    () => productionConfig(productionEnvironment({
      MINMAX_NOTIFY_EMAIL: '',
    })),
    /MINMAX_NOTIFY_EMAIL is required/
  );
  assert.throws(
    () => productionConfig(productionEnvironment({
      MINMAX_SMTP_FROM: '',
    })),
    /MINMAX_SMTP_FROM is required/
  );
});

test('separate notification mailbox requires explicit IMAP credentials', () => {
  assert.throws(
    () => productionConfig(productionEnvironment({
      MINMAX_NOTIFICATION_IMAP_USER: '',
      MINMAX_NOTIFICATION_IMAP_PASSWORD: '',
    })),
    /required when MINMAX_NOTIFY_EMAIL differs from MINMAX_E2E_MAIL_USER/
  );
});

test('empty production sender or subject pattern fails before deploy', () => {
  assert.throws(
    () => productionConfig(productionEnvironment({
      MINMAX_ALLOWED_SENDER: '',
    })),
    /MINMAX_ALLOWED_SENDER is required/
  );
  assert.throws(
    () => productionConfig(productionEnvironment({
      MINMAX_SUBJECT_PATTERN: '',
    })),
    /MINMAX_SUBJECT_PATTERN is required/
  );
});

test('E2E sender and subject match deployed production filters', () => {
  const config = productionConfig(productionEnvironment());
  config.shortSha = '031aabd';
  const deployEnvironment = buildProductionEnvironment(config);
  const deployed = bindFixedRuntimeConfig(workflow, {
    apiBaseUrl: deployEnvironment.MINMAX_API_BASE_URL,
    ownerUiBaseUrl: deployEnvironment.MINMAX_OWNER_UI_BASE_URL,
    allowedSender: deployEnvironment.MINMAX_ALLOWED_SENDER,
    subjectPattern: deployEnvironment.MINMAX_SUBJECT_PATTERN,
    notifyTo: deployEnvironment.MINMAX_NOTIFY_EMAIL,
    notifyFrom: deployEnvironment.MINMAX_SMTP_FROM,
  });
  const snapshot = verifyDeployedRuntimeConfig(deployed, config);
  const marker = 'minmax-correlation-marker';
  const mail = buildE2EMailOptions(config, marker, Buffer.from('fixture'));

  assert.equal(snapshot.allowedSender, config.mail.user);
  assert.equal(deployEnvironment.MINMAX_ALLOWED_SENDER, config.mail.user);
  assert.equal(
    deployEnvironment.MINMAX_SUBJECT_PATTERN,
    'minmax production e2e'
  );
  assert.equal(mail.from, config.mail.user);
  assert.equal(mail.subject, buildE2ESubject(config, marker));
  assert.ok(mail.subject.toLowerCase().includes(
    snapshot.subjectPattern.toLowerCase()
  ));
});

test('accept-all deployed filter configuration is forbidden', () => {
  const config = productionConfig(productionEnvironment());
  assert.throws(
    () => verifyDeployedRuntimeConfig(workflow, config),
    /must not be accept-all/
  );
});

test('successful E2E restores and verifies the original production config', async () => {
  const harness = transactionHarness();
  const result = await runE2EWithAutomaticRestore(
    harness.config,
    harness.client,
    harness.dependencies
  );

  assert.equal(harness.e2eCalls, 1);
  assert.equal(harness.deployEnvironments.length, 2);
  assert.deepEqual({
    apiBaseUrl: harness.deployEnvironments[1].MINMAX_API_BASE_URL,
    ownerUiBaseUrl: harness.deployEnvironments[1].MINMAX_OWNER_UI_BASE_URL,
    allowedSender: harness.deployEnvironments[1].MINMAX_ALLOWED_SENDER,
    subjectPattern: harness.deployEnvironments[1].MINMAX_SUBJECT_PATTERN,
    notifyTo: harness.deployEnvironments[1].MINMAX_NOTIFY_EMAIL,
    notifyFrom: harness.deployEnvironments[1].MINMAX_SMTP_FROM,
  }, harness.originalRuntime);
  assert.equal(result.restore.activeVersionId, 'restored-v3');
  assert.deepEqual(result.restore.runtimeConfig, harness.originalRuntime);
});

test('failed E2E restores the original production config', async () => {
  const harness = transactionHarness({
    e2eError: new Error('workflow execution failed'),
  });

  await assert.rejects(
    () => runE2EWithAutomaticRestore(
      harness.config,
      harness.client,
      harness.dependencies
    ),
    /workflow execution failed/
  );
  assert.equal(harness.e2eCalls, 1);
  assert.equal(harness.deployEnvironments.length, 2);
  assert.equal(
    harness.deployEnvironments[1].MINMAX_ALLOWED_SENDER,
    harness.originalRuntime.allowedSender
  );
});

test('E2E timeout restores the original production config', async () => {
  const harness = transactionHarness({
    e2eError: new Error('E2E execution timed out; last state=running.'),
  });

  await assert.rejects(
    () => runE2EWithAutomaticRestore(
      harness.config,
      harness.client,
      harness.dependencies
    ),
    /timed out/
  );
  assert.equal(harness.deployEnvironments.length, 2);
  assert.equal(
    harness.deployEnvironments[1].MINMAX_SUBJECT_PATTERN,
    harness.originalRuntime.subjectPattern
  );
});

test('restore failure makes the overall production check fail', async () => {
  const harness = transactionHarness({ restoreFails: true });

  await assert.rejects(
    () => runE2EWithAutomaticRestore(
      harness.config,
      harness.client,
      harness.dependencies
    ),
    /Automatic production runtime config restore failed: restore publish rejected/
  );
  assert.equal(harness.e2eCalls, 1);
  assert.equal(harness.deployEnvironments.length, 2);
});

test('unsafe original accept-all config prevents deploy and E2E', async () => {
  const harness = transactionHarness({
    originalRuntime: { allowedSender: '', subjectPattern: '' },
  });

  await assert.rejects(
    () => runE2EWithAutomaticRestore(
      harness.config,
      harness.client,
      harness.dependencies
    ),
    /unsafe to restore.*allowedSender, subjectPattern.*E2E was not started/
  );
  assert.equal(harness.e2eCalls, 0);
  assert.equal(harness.deployEnvironments.length, 0);
});

test('historical inspect is skipped without MINMAX_EXECUTION_ID', async () => {
  const config = productionConfig(productionEnvironment());
  let calls = 0;
  const result = await inspectHistoricalExecution(config, {}, {
    logger: { log() {} },
    inspectExecution: async () => { calls += 1; },
  });
  assert.equal(result, null);
  assert.equal(calls, 0);
});

test('historical inspect runs when MINMAX_EXECUTION_ID is explicit', async () => {
  const config = productionConfig(productionEnvironment({
    MINMAX_EXECUTION_ID: '891',
  }));
  let received = null;
  const result = await inspectHistoricalExecution(config, { id: 'client' }, {
    logger: { log() {} },
    inspectExecution: async options => {
      received = options;
      return { cause: 'retained JSON evidence' };
    },
    printInspection() {},
  });
  assert.equal(received.executionId, '891');
  assert.equal(result.cause, 'retained JSON evidence');
});

test('repository workflow contains no real email addresses', () => {
  const code = workflow.nodes.find(node => node.id === 'minmax-fixed-config')
    .parameters.jsCode;
  assert.doesNotMatch(JSON.stringify(workflow), /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  assert.match(code, /notifyTo: ''/);
  assert.match(code, /notifyFrom: ''/);
});

test('published registry node contract exposes JSON, retries and exact options', () => {
  const snapshot = registryNodeSnapshot(workflow);
  assert.equal(snapshot.method, 'GET');
  assert.equal(snapshot.accept, 'application/json');
  assert.equal(snapshot.responseFormat, 'json');
  assert.equal(snapshot.neverError, true);
  assert.equal(snapshot.fullResponse, false);
  assert.equal(snapshot.includeHeaders, false);
  assert.equal(snapshot.retryOnFail, true);
  assert.equal(snapshot.maxTries, 3);
  assert.equal(snapshot.waitBetweenTries, 5000);
  assert.equal(snapshot.redirects, true);
  assert.equal(snapshot.encoding, 'utf8');
  assert.equal(snapshot.timeout, 30000);
});

test('healthy container passes host health and restart verification', async () => {
  const commands = [];
  const config = {
    apiToken: '0123456789abcdef',
    backendBaseUrl: 'http://127.0.0.1:3210',
    composeFile: '/repo/compose.yml',
    shortSha: 'd14d642',
  };
  const runtime = healthyContainerRuntime();
  const result = await ensurePersistentBackend(config, {
    runCommand(command, args) {
      commands.push([command, ...args]);
      return args[0] === 'inspect' ? 'unless-stopped' : '';
    },
    request: async () => healthResponse(),
    verifyContainerRuntime: () => runtime,
  });

  assert.deepEqual(result, {
    restartPolicy: 'unless-stopped',
    container: runtime,
  });
  assert.equal(commands.filter(command => command[1] === 'restart').length, 1);
});

test('running container proves healthy state, runtime files and published port', () => {
  const result = verifyContainerRuntime({}, {
    runCommand: containerRuntimeCommand(),
  });

  assert.equal(result.status, 'running');
  assert.equal(result.health, 'healthy');
  assert.equal(result.restartCount, 0);
  assert.equal(result.runtimeProbe, 'runtime-ok');
  assert.equal(result.publishedPorts['3210/tcp'][0].HostPort, '3210');
});

test('Windows-safe docker exec transports complex JavaScript only through stdin', () => {
  const script = String.raw`
    const value = {
      semicolon: 'one;two',
      quotes: 'single\' and "double"',
      backslash: 'C:\\MinMax\\report.json',
      json: { ok: true, count: 2 },
      url: new URL('http://127.0.0.1:3210/api/v1/health?source=e2e').pathname,
      cyrillic: 'Проверка МинМакс',
    };
    process.stdout.write(JSON.stringify(value));
  `;
  let captured = null;
  const output = runDockerNodeFromStdin(
    'purchasing-web-backend',
    script,
    {},
    {
      runCommand(command, args, options) {
        captured = { command, args, options };
        const result = spawnSync(process.execPath, ['-'], {
          encoding: 'utf8',
          input: options.input,
        });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout;
      },
    }
  );

  assert.deepEqual(captured.args, [
    'exec', '-i', 'purchasing-web-backend', 'node', '-',
  ]);
  assert.equal(captured.options.input, script);
  assert.ok(!captured.args.includes(script));
  assert.deepEqual(JSON.parse(output), {
    semicolon: 'one;two',
    quotes: 'single\' and "double"',
    backslash: 'C:\\MinMax\\report.json',
    json: { ok: true, count: 2 },
    url: '/api/v1/health',
    cyrillic: 'Проверка МинМакс',
  });
});

test('missing published port fails container runtime verification', () => {
  assert.throws(
    () => verifyContainerRuntime({}, {
      runCommand: containerRuntimeCommand({
        '{{json .NetworkSettings.Ports}}': {},
      }),
    }),
    /publishedPorts=\{\}.*expected host 3210/
  );
});

test('automatic restart during verification fails production-check', async () => {
  const runtimes = [
    healthyContainerRuntime({ restartCount: 3 }),
    healthyContainerRuntime({ restartCount: 4 }),
  ];
  await assert.rejects(
    () => ensurePersistentBackend({
      apiToken: '0123456789abcdef',
      backendBaseUrl: 'http://127.0.0.1:3210',
      composeFile: '/repo/compose.yml',
      shortSha: 'd14d642',
    }, {
      runCommand(command, args) {
        return args[0] === 'inspect' ? 'unless-stopped' : '';
      },
      runCommandCapture() {
        return { status: 0, stdout: '{}', stderr: '', error: null };
      },
      request: async () => healthResponse(),
      verifyContainerRuntime: () => runtimes.shift(),
      logger: { error() {} },
    }),
    /RestartCount changed from 3 to 4/
  );
});

test('backend not started prints Docker health and container logs automatically', async () => {
  const messages = [];
  const config = {
    apiToken: '0123456789abcdef',
    backendBaseUrl: 'http://127.0.0.1:3210',
    composeFile: '/repo/compose.yml',
    shortSha: 'd14d642',
  };

  await assert.rejects(
    () => ensurePersistentBackend(config, {
      runCommand() { throw new Error('container is unhealthy'); },
      runCommandCapture(command, args) {
        return {
          status: 1,
          stdout: '',
          stderr: args[0] === 'logs'
            ? 'backend process exited before listen'
            : 'No such container',
          error: null,
        };
      },
      request: async () => { throw new Error('connect ECONNREFUSED'); },
      logger: { error(message) { messages.push(message); } },
    }),
    /container is unhealthy/
  );
  assert.ok(messages.some(message => message.includes('healthLogEntries')));
  assert.ok(messages.some(message =>
    message.includes('backend process exited before listen')
  ));
  assert.ok(messages.some(message => message.includes('ECONNREFUSED')));
});

test('wrong published port is reported with host connection evidence', async () => {
  const messages = [];
  const config = {
    apiToken: '0123456789abcdef',
    backendBaseUrl: 'http://127.0.0.1:3211',
    composeFile: '/repo/compose.yml',
    shortSha: 'd14d642',
  };

  await assert.rejects(
    () => ensurePersistentBackend(config, {
      runCommand(command, args) {
        return args[0] === 'inspect' ? 'unless-stopped' : '';
      },
      runCommandCapture() {
        return { status: 0, stdout: '{}', stderr: '', error: null };
      },
      request: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:3211');
      },
      verifyContainerRuntime: () => healthyContainerRuntime(),
      delay: async () => new Promise(resolve => setTimeout(resolve, 2)),
      timeoutMs: 5,
      logger: { error(message) { messages.push(message); } },
    }),
    /Backend health did not become ready.*3211/
  );
  assert.ok(messages.some(message => message.includes('127.0.0.1:3211')));
});

test('wrong build SHA fails the exact health contract', () => {
  assert.throws(
    () => verifyBackendHealthResponse(
      healthResponse({ data: { build_sha: 'fffffff' } }),
      'd14d642',
      'Windows host'
    ),
    /build_sha=fffffff, expected d14d642/
  );
});

test('non-JSON health response fails the exact health contract', () => {
  assert.throws(
    () => verifyBackendHealthResponse(healthResponse({
      contentType: 'text/html',
      text: '<h1>proxy error</h1>',
      json: null,
    }), 'd14d642', 'Windows host'),
    /Content-Type "text\/html"/
  );
});

test('missing healthcheck tool is preserved in automatic diagnostics', async () => {
  const diagnostics = await collectBackendDiagnostics({
    apiToken: '0123456789abcdef',
    backendBaseUrl: 'http://127.0.0.1:3210',
  }, {
    runCommandCapture(command, args) {
      if (args[0] === 'exec' && args.includes('--version')) {
        return {
          status: 127,
          stdout: '',
          stderr: 'exec: node: executable file not found',
          error: null,
        };
      }
      if (args.includes('{{json .Config.Env}}')) {
        return {
          status: 0,
          stdout: JSON.stringify([
            'PURCHASING_API_TOKEN=0123456789abcdef',
            'PURCHASING_BUILD_SHA=d14d642',
          ]),
          stderr: '',
          error: null,
        };
      }
      return { status: 0, stdout: '{}', stderr: '', error: null };
    },
    request: async () => healthResponse(),
  });

  assert.equal(diagnostics.healthcheckTool.exitCode, 127);
  assert.match(diagnostics.healthcheckTool.output, /node.*not found/);
  assert.doesNotMatch(diagnostics.environment.output, /0123456789abcdef/);
  assert.match(diagnostics.environment.output, /PURCHASING_API_TOKEN=\[REDACTED\]/);
});

test('Docker service is restart-safe and keeps output/data on host mounts', () => {
  const compose = fs.readFileSync(path.join(
    ROOT,
    'docker/purchasing-web-backend/compose.yml'
  ), 'utf8');
  const dockerfile = fs.readFileSync(path.join(
    ROOT,
    'docker/purchasing-web-backend/Dockerfile'
  ), 'utf8');
  const supplierOrderService = fs.readFileSync(path.join(
    ROOT,
    'apps/purchasing-web-backend/application/supplier_order_service.js'
  ), 'utf8');
  const serverSource = fs.readFileSync(path.join(
    ROOT,
    'apps/purchasing-web-backend/server.js'
  ), 'utf8');
  assert.match(compose, /restart: unless-stopped/);
  assert.match(compose, /"3210:3210"/);
  assert.match(compose, /\.\.\/\.\.\/output:\/app\/output/);
  assert.match(compose, /data\/purchasing:\/app\/data\/purchasing/);
  assert.match(compose, /PURCHASING_API_TOKEN/);
  assert.match(compose, /PURCHASING_BUILD_SHA/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(dockerfile, /WORKDIR \/app/);
  assert.match(dockerfile, /COPY package\.json package-lock\.json/);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /COPY agents \.\/agents/);
  assert.match(dockerfile, /COPY apps \.\/apps/);
  assert.match(dockerfile, /COPY shared \.\/shared/);
  assert.match(dockerfile, /mkdir -p \/app\/output \/app\/data\/purchasing/);
  assert.match(
    dockerfile,
    /CMD \["node", "apps\/purchasing-web-backend\/server\.js"\]/
  );
  assert.match(supplierOrderService, /shared\/reporting\/xlsx_exporter/);
  assert.doesNotMatch(dockerfile, /\["node", "-e"/);
  assert.match(serverSource, /hostname: '127\.0\.0\.1'/);
  assert.match(serverSource, /port: 3210/);
  assert.match(serverSource, /service !== 'purchasing-web'/);
  assert.match(serverSource, /build_sha !== expectedSha/);
  const healthCommand = JSON.parse(
    dockerfile.match(/\n  CMD (\[[^\n]+\])/)[1]
  );
  assert.deepEqual(healthCommand, [
    'node', 'apps/purchasing-web-backend/server.js', '--healthcheck',
  ]);
});

test('SMTP message has one Excel attachment and correlation marker', () => {
  const message = buildExcelMessage({
    marker: 'marker-123',
    from: 'from@example.test',
    to: 'to@example.test',
    subject: 'MinMax production E2E marker-123',
    fileName: 'minmax-e2e.xlsx',
    file: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    date: '2026-08-02T00:00:00.000Z',
  });
  assert.match(message, /Message-ID: <marker-123@codex-minmax-e2e>/);
  assert.match(message, /filename="minmax-e2e\.xlsx"/);
  assert.equal((message.match(/Content-Disposition: attachment/g) || []).length, 1);
  assert.match(message, /UEsDBA==/);
});

test('IMAP search starts one UTC day earlier to avoid timezone gaps', () => {
  assert.equal(imapSinceDate('2026-08-02T00:01:00.000Z'), '1-Aug-2026');
});

test('execution polling selects one correlated successful production execution', async () => {
  const detail = execution();
  const client = {
    async request(method, endpoint) {
      assert.equal(method, 'GET');
      if (endpoint.startsWith('/executions?')) {
        return { data: [{
          id: detail.id,
          startedAt: detail.startedAt,
        }] };
      }
      return detail;
    },
  };
  const result = await waitForE2EExecution(client, {
    timeoutMs: 100,
    n8n: { workflowId: 'minmaxYandexIntakeFixed01' },
  }, 'MinMax production E2E marker', Date.parse(detail.startedAt), {
    delay: async () => {},
  });
  assert.equal(result.id, 'e2e-100');
  assert.deepEqual(
    latestOutputJson(result, 'Сформировать уведомление'),
    { runId: 'run-1' }
  );
});

test('execution polling rejects a correlated duplicate', async () => {
  const first = execution();
  const second = execution({ id: 'e2e-101' });
  const client = {
    async request(method, endpoint) {
      if (endpoint.startsWith('/executions?')) {
        return { data: [first, second] };
      }
      return endpoint.includes(first.id) ? first : second;
    },
  };
  await assert.rejects(
    () => waitForE2EExecution(client, {
      timeoutMs: 100,
      n8n: { workflowId: 'minmaxYandexIntakeFixed01' },
    }, 'MinMax production E2E marker', Date.parse(first.startedAt), {
      delay: async () => {},
    }),
    /Expected one matching execution, found 2/
  );
});

test('credential metadata verifies all three deployed credential types', async () => {
  const values = new Map([
    ['http-id', { id: 'http-id', name: 'Arthur Core API', type: 'httpHeaderAuth' }],
    ['imap-id', { id: 'imap-id', name: 'Yandex IMAP', type: 'imap' }],
    ['smtp-id', { id: 'smtp-id', name: 'Yandex SMTP', type: 'smtp' }],
  ]);
  const result = await verifyCredentialMetadata({
    n8n: { credentials: {
      httpHeaderAuth: 'http-id',
      imap: 'imap-id',
      smtp: 'smtp-id',
    } },
  }, {
    request: async (method, endpoint) => values.get(endpoint.split('/').at(-1)),
  });
  assert.equal(result.length, 3);
});

test('connection-refused check accepts only a real transport failure', async () => {
  const cause = new Error('connect ECONNREFUSED 127.0.0.1:1');
  assert.equal(await verifyConnectionRefused({
    fetch: async () => { throw cause; },
  }), cause);
  await assert.rejects(
    () => verifyConnectionRefused({ fetch: async () => ({ ok: true }) }),
    /unexpectedly reached port 1/
  );
});
