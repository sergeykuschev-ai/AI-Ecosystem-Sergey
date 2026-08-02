'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const {
  DEFAULT_WORKFLOW_ID,
  N8nApiClient,
  deploymentConfig,
} = require('./minmax-n8n-workflow-deployment');
const { main: deployWorkflow } = require('./deploy-minmax-workflow');
const {
  inspectExecution,
  printInspection,
} = require('./inspect-minmax-execution');
const {
  assertJsonResponse,
  probeN8nContainer,
  rawRequest,
  verifyDirectContract,
} = require('../purchasing/verify-minmax-n8n-contract');
const {
  sendExcelMail,
  waitForMailboxText,
} = require('./minmax-mail-protocol');

const REPOSITORY_ROOT = path.resolve(__dirname, '../..');
const COMPOSE_FILE = path.join(
  REPOSITORY_ROOT,
  'docker/purchasing-web-backend/compose.yml'
);
const WORKBOOK_PATH = path.join(
  REPOSITORY_ROOT,
  'tests/fixtures/SmartZapas_synthetic.xlsx'
);
const REQUIRED_BRANCH = 'feature/minmax-yandex-mail-intake';
const DEFAULT_E2E_SUBJECT_PATTERN = 'minmax production e2e';
const DEFAULT_CREDENTIALS = Object.freeze({
  httpHeaderAuth: 'pjXec1bxtt81cy0u',
  imap: 'Od4UJQh12iTGufks',
  smtp: 'zOGxEOJGUvn59jgC',
});

function requiredSecret(name, environment = process.env) {
  const value = String(environment[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function positiveInteger(value, fallback, name) {
  const number = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return number;
}

function productionConfig(environment = process.env) {
  const mailUser = requiredSecret('MINMAX_E2E_MAIL_USER', environment);
  const mailPassword = requiredSecret('MINMAX_E2E_MAIL_PASSWORD', environment);
  const allowedSender = environment.MINMAX_ALLOWED_SENDER === undefined
    ? mailUser
    : String(environment.MINMAX_ALLOWED_SENDER).trim();
  const subjectPattern = environment.MINMAX_SUBJECT_PATTERN === undefined
    ? DEFAULT_E2E_SUBJECT_PATTERN
    : String(environment.MINMAX_SUBJECT_PATTERN).trim();
  if (!allowedSender) throw new Error('MINMAX_ALLOWED_SENDER is required.');
  if (!subjectPattern) throw new Error('MINMAX_SUBJECT_PATTERN is required.');
  if (allowedSender.toLowerCase() !== mailUser.toLowerCase()) {
    throw new Error(
      'MINMAX_ALLOWED_SENDER must equal MINMAX_E2E_MAIL_USER for production E2E.'
    );
  }
  const ownerUrl = String(
    environment.MINMAX_OWNER_UI_BASE_URL || `http://${os.hostname()}:3210`
  ).replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(ownerUrl) || /<[^>]+>/.test(ownerUrl)) {
    throw new Error('MINMAX_OWNER_UI_BASE_URL must be an absolute usable URL.');
  }
  const n8nBaseUrl = String(
    environment.N8N_BASE_URL || 'http://127.0.0.1:5678'
  ).replace(/\/+$/, '');
  return {
    branch: String(environment.MINMAX_PRODUCTION_BRANCH || REQUIRED_BRANCH),
    backendBaseUrl: 'http://127.0.0.1:3210',
    backendContainerBaseUrl: 'http://host.docker.internal:3210',
    composeFile: environment.PURCHASING_COMPOSE_FILE
      ? path.resolve(environment.PURCHASING_COMPOSE_FILE)
      : COMPOSE_FILE,
    executionId: environment.MINMAX_EXECUTION_ID === undefined
      ? null
      : String(environment.MINMAX_EXECUTION_ID).trim() || null,
    fixturePath: environment.MINMAX_E2E_FIXTURE
      ? path.resolve(environment.MINMAX_E2E_FIXTURE)
      : WORKBOOK_PATH,
    n8n: {
      baseUrl: n8nBaseUrl,
      apiKey: requiredSecret('N8N_API_KEY', environment),
      container: String(environment.N8N_CONTAINER_NAME || 'n8n'),
      workflowId: String(
        environment.N8N_MINMAX_WORKFLOW_ID || DEFAULT_WORKFLOW_ID
      ),
      credentials: {
        httpHeaderAuth: String(
          environment.N8N_ARTHUR_CREDENTIAL_ID ||
          DEFAULT_CREDENTIALS.httpHeaderAuth
        ),
        imap: String(
          environment.N8N_MINMAX_IMAP_CREDENTIAL_ID ||
          DEFAULT_CREDENTIALS.imap
        ),
        smtp: String(
          environment.N8N_MINMAX_SMTP_CREDENTIAL_ID ||
          DEFAULT_CREDENTIALS.smtp
        ),
      },
    },
    apiToken: requiredSecret('PURCHASING_API_TOKEN', environment),
    ownerUrl,
    allowedSender,
    subjectPattern,
    notifyEmail: requiredSecret('MINMAX_NOTIFY_EMAIL', environment),
    smtpFrom: requiredSecret('MINMAX_SMTP_FROM', environment),
    mail: {
      smtpHost: String(environment.MINMAX_E2E_SMTP_HOST || 'smtp.yandex.ru'),
      smtpPort: positiveInteger(
        environment.MINMAX_E2E_SMTP_PORT,
        465,
        'MINMAX_E2E_SMTP_PORT'
      ),
      imapHost: String(environment.MINMAX_E2E_IMAP_HOST || 'imap.yandex.ru'),
      imapPort: positiveInteger(
        environment.MINMAX_E2E_IMAP_PORT,
        993,
        'MINMAX_E2E_IMAP_PORT'
      ),
      user: mailUser,
      password: mailPassword,
      recipient: String(environment.MINMAX_E2E_RECIPIENT || mailUser),
      notificationUser: String(
        environment.MINMAX_NOTIFICATION_IMAP_USER || mailUser
      ),
      notificationPassword: String(
        environment.MINMAX_NOTIFICATION_IMAP_PASSWORD || mailPassword
      ),
    },
    timeoutMs: positiveInteger(
      environment.MINMAX_E2E_TIMEOUT_MS,
      15 * 60 * 1000,
      'MINMAX_E2E_TIMEOUT_MS'
    ),
  };
}

function buildE2ESubject(config, marker) {
  return `${config.subjectPattern} ${marker}`;
}

function buildE2EMailOptions(config, marker, file) {
  return {
    host: config.mail.smtpHost,
    port: config.mail.smtpPort,
    user: config.mail.user,
    password: config.mail.password,
    from: config.mail.user,
    to: config.mail.recipient,
    subject: buildE2ESubject(config, marker),
    marker,
    file,
    fileName: 'minmax-production-e2e.xlsx',
    timeoutMs: 30000,
  };
}

function fixedConfigValue(code, field) {
  const expression = new RegExp(`\\b${field}:\\s*('[^']*'|"[^"]*")`);
  const literal = String(code || '').match(expression)?.[1];
  if (!literal) return null;
  if (literal.startsWith('"')) return JSON.parse(literal);
  return literal.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

function deployedRuntimeConfigSnapshot(workflow) {
  const code = (workflow.nodes || []).find(node =>
    node.id === 'minmax-fixed-config'
  )?.parameters?.jsCode;
  if (!code) throw new Error('Published Fixed MinMax config node is missing.');
  return {
    allowedSender: fixedConfigValue(code, 'allowedSender'),
    subjectPattern: fixedConfigValue(code, 'subjectPattern'),
    notifyTo: fixedConfigValue(code, 'notifyTo'),
    notifyFrom: fixedConfigValue(code, 'notifyFrom'),
  };
}

function verifyDeployedRuntimeConfig(workflow, config) {
  const snapshot = deployedRuntimeConfigSnapshot(workflow);
  if (!snapshot.allowedSender || !snapshot.subjectPattern) {
    throw new Error('Published MinMax filters must not be accept-all.');
  }
  const expected = {
    allowedSender: config.allowedSender,
    subjectPattern: config.subjectPattern,
    notifyTo: config.notifyEmail,
    notifyFrom: config.smtpFrom,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (snapshot[field] !== value) {
      throw new Error(
        `Published MinMax ${field}=${snapshot[field] || '(empty)'}, ` +
        `expected ${value}.`
      );
    }
  }
  const sampleSubject = buildE2ESubject(config, 'contract-marker');
  if (!config.mail.user.toLowerCase().includes(
    snapshot.allowedSender.toLowerCase()
  )) {
    throw new Error('E2E sender does not match published allowedSender.');
  }
  if (!sampleSubject.toLowerCase().includes(
    snapshot.subjectPattern.toLowerCase()
  )) {
    throw new Error('E2E subject does not match published subjectPattern.');
  }
  return snapshot;
}

function gitValue(args) {
  return execFileSync('git', args, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  }).trim();
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || REPOSITORY_ROOT,
    encoding: 'utf8',
    env: options.env || process.env,
    maxBuffer: 32 * 1024 * 1024,
    stdio: options.inherit ? 'inherit' : 'pipe',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().slice(-2000);
    throw new Error(
      `${command} ${args.join(' ')} failed with exit ${result.status}: ${detail}`
    );
  }
  return String(result.stdout || '').trim();
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHealth(config, dependencies = {}) {
  const request = dependencies.request || rawRequest;
  const wait = dependencies.delay || delay;
  const deadline = Date.now() + (dependencies.timeoutMs || 90000);
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await request(config.backendBaseUrl, '/api/v1/health', {
        headers: { 'x-api-key': config.apiToken, accept: 'application/json' },
      });
      assertJsonResponse(result, [200]);
      if (result.json?.data?.build_sha !== config.shortSha) {
        throw new Error(
          `backend build_sha=${result.json?.data?.build_sha || '(missing)'}, ` +
          `expected ${config.shortSha}`
        );
      }
      return result;
    } catch (error) {
      lastError = error;
      await wait(2000);
    }
  }
  throw new Error(`Backend health did not become ready: ${lastError?.message}`);
}

function startPersistentBackend(config, dependencies = {}) {
  const run = dependencies.runCommand || runCommand;
  const environment = {
    ...process.env,
    PURCHASING_API_TOKEN: config.apiToken,
    PURCHASING_BUILD_SHA: config.shortSha,
  };
  run('docker', [
    'compose', '-f', config.composeFile,
    'up', '-d', '--build', '--wait',
  ], { env: environment });
  const restartPolicy = run('docker', [
    'inspect', '--format', '{{.HostConfig.RestartPolicy.Name}}',
    'purchasing-web-backend',
  ]);
  if (restartPolicy !== 'unless-stopped') {
    throw new Error(`Backend restart policy=${restartPolicy}, expected unless-stopped.`);
  }
  return { restartPolicy };
}

async function verifyBackendRestart(config, dependencies = {}) {
  const run = dependencies.runCommand || runCommand;
  run('docker', ['restart', 'purchasing-web-backend']);
  return waitForHealth(config, dependencies);
}

async function verifyConnectionRefused(dependencies = {}) {
  const request = dependencies.fetch || fetch;
  try {
    await request('http://127.0.0.1:1/api/v1/upload-idempotency/unreachable', {
      signal: AbortSignal.timeout(3000),
    });
  } catch (error) {
    return error;
  }
  throw new Error('Connection-refused probe unexpectedly reached port 1.');
}

async function verifyInvalidToken(config, dependencies = {}) {
  const request = dependencies.request || rawRequest;
  const result = await request(config.backendBaseUrl, '/api/v1/health', {
    headers: { 'x-api-key': `${config.apiToken}-invalid` },
  });
  assertJsonResponse(result, [401]);
  if (result.json?.error?.code !== 'API_TOKEN_INVALID') {
    throw new Error('Invalid API key did not return API_TOKEN_INVALID JSON.');
  }
  return result;
}

async function verifyCredentialMetadata(config, client) {
  const expected = [
    [config.n8n.credentials.httpHeaderAuth, 'httpHeaderAuth'],
    [config.n8n.credentials.imap, 'imap'],
    [config.n8n.credentials.smtp, 'smtp'],
  ];
  const metadata = [];
  for (const [id, type] of expected) {
    const value = await client.request(
      'GET',
      `/credentials/${encodeURIComponent(id)}`
    );
    if (String(value.id) !== id || value.type !== type) {
      throw new Error(
        `Credential ${id}: id/type=${value.id}/${value.type}, expected ${id}/${type}.`
      );
    }
    metadata.push({ id: value.id, name: value.name, type: value.type });
  }
  return metadata;
}

function registryNodeSnapshot(workflow) {
  const node = (workflow.nodes || []).find(candidate =>
    candidate.id === 'check-registry'
  );
  if (!node) throw new Error('Published Проверить реестр node is missing.');
  const parameters = node.parameters || {};
  const response = parameters.options?.response?.response || {};
  const accept = (parameters.headerParameters?.parameters || []).find(header =>
    String(header.name).toLowerCase() === 'accept'
  )?.value;
  const snapshot = {
    method: parameters.method || 'GET',
    url: parameters.url,
    sendHeaders: parameters.sendHeaders,
    accept,
    authentication: parameters.authentication,
    genericAuthType: parameters.genericAuthType,
    credential: node.credentials?.httpHeaderAuth || null,
    responseFormat: response.responseFormat,
    neverError: response.neverError,
    fullResponse: response.fullResponse ?? false,
    includeHeaders: response.includeResponseHeaders ?? false,
    retryOnFail: node.retryOnFail === true,
    maxTries: node.maxTries ?? node.maxRetries ?? 1,
    waitBetweenTries: node.waitBetweenTries ?? node.waitBetweenRetries ?? 0,
    redirects: parameters.options?.redirect?.redirect?.followRedirects ?? true,
    maxRedirects: parameters.options?.redirect?.redirect?.maxRedirects ?? null,
    encoding: parameters.options?.encoding || 'utf8',
    timeout: parameters.options?.timeout ?? null,
  };
  const expected = {
    method: 'GET',
    sendHeaders: true,
    accept: 'application/json',
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    responseFormat: 'json',
    neverError: true,
    fullResponse: false,
    includeHeaders: false,
    retryOnFail: true,
    maxTries: 3,
    encoding: 'utf8',
    timeout: 30000,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (snapshot[field] !== value) {
      throw new Error(`Проверить реестр ${field}=${snapshot[field]}, expected ${value}.`);
    }
  }
  if (snapshot.credential?.id !== configCredentialId(workflow)) {
    throw new Error('Проверить реестр credential differs from deployed contract.');
  }
  return snapshot;
}

function configCredentialId(workflow) {
  return (workflow.nodes || []).find(node => node.id === 'check-registry')
    ?.credentials?.httpHeaderAuth?.id || null;
}

function runData(execution) {
  return execution.data?.resultData?.runData || execution.data?.runData || {};
}

function latestOutputJson(execution, nodeName) {
  const runs = runData(execution)[nodeName] || [];
  const run = runs[runs.length - 1];
  const outputs = run?.data?.main || [];
  for (const output of outputs) {
    const item = output?.[0];
    if (item?.json) return item.json;
  }
  return null;
}

async function listExecutionDetails(client, workflowId) {
  const page = await client.request(
    'GET',
    `/executions?workflowId=${encodeURIComponent(workflowId)}&limit=100`
  );
  return page.data || [];
}

async function matchingExecutionDetails(client, config, subject, startedAt) {
  const records = await listExecutionDetails(client, config.n8n.workflowId);
  const candidates = records.filter(record =>
    new Date(record.startedAt || 0).getTime() >= startedAt - 5000
  );
  const matches = [];
  for (const record of candidates) {
    const detail = await client.request(
      'GET',
      `/executions/${encodeURIComponent(record.id)}` +
        '?includeData=true&ignoreDataSizeLimit=true&redactExecutionData=false'
    );
    const configOutput = latestOutputJson(detail, 'Конфигурация MinMax');
    if (configOutput?.subject === subject) matches.push(detail);
  }
  return matches;
}

async function waitForE2EExecution(client, config, subject, startedAt, dependencies = {}) {
  const wait = dependencies.delay || delay;
  const deadline = Date.now() + config.timeoutMs;
  let lastState = 'not seen';
  while (Date.now() < deadline) {
    const matches = await matchingExecutionDetails(client, config, subject, startedAt);
    if (matches.length > 1) {
      throw new Error(`Expected one matching execution, found ${matches.length}.`);
    }
    if (matches.length === 1) {
      const execution = matches[0];
      lastState = execution.status || (execution.finished ? 'finished' : 'running');
      if (execution.status === 'error' || runData(execution).error) {
        const error = execution.data?.resultData?.error || runData(execution).error;
        throw new Error(
          `E2E execution ${execution.id} failed at ` +
          `${error?.node?.name || error?.node || 'unknown node'}: ` +
          `${error?.message || JSON.stringify(error)}`
        );
      }
      if (execution.finished === true || execution.status === 'success') {
        return execution;
      }
    }
    await wait(5000);
  }
  throw new Error(`E2E execution timed out; last state=${lastState}.`);
}

async function backendJson(config, requestPath, options = {}, dependencies = {}) {
  const request = dependencies.request || rawRequest;
  const result = await request(config.backendBaseUrl, requestPath, {
    ...options,
    headers: {
      accept: 'application/json',
      'x-api-key': config.apiToken,
      ...(options.headers || {}),
    },
  });
  assertJsonResponse(result, options.expectedStatuses || [200]);
  return result;
}

async function verifySourceArtifact(config, runId, sourceBytes, dependencies = {}) {
  const manifest = await backendJson(
    config,
    `/api/v1/runs/${runId}/artifacts`,
    {},
    dependencies
  );
  const artifacts = Array.isArray(manifest.json.data)
    ? manifest.json.data
    : manifest.json.data?.artifacts || [];
  const source = artifacts.find(item => /^source-report\.xlsx?$/.test(item.name));
  if (!source) throw new Error('Run does not contain a source Excel artifact.');
  const fetcher = dependencies.fetch || fetch;
  const response = await fetcher(
    `${config.backendBaseUrl}/api/v1/runs/${runId}/artifacts/${source.name}`,
    { headers: { 'x-api-key': config.apiToken } }
  );
  if (!response.ok) throw new Error(`Source artifact download returned HTTP ${response.status}.`);
  const downloaded = Buffer.from(await response.arrayBuffer());
  if (!downloaded.equals(sourceBytes)) {
    throw new Error('Stored source artifact differs from the emailed workbook.');
  }
  return source;
}

async function verifyIdempotentReplay(config, idempotencyKey, runId, file, dependencies = {}) {
  const fetcher = dependencies.fetch || fetch;
  const form = new FormData();
  form.append('file', new Blob([file], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), 'minmax-production-e2e.xlsx');
  form.append('idempotency_key', idempotencyKey);
  form.append('mailbox', 'INBOX');
  form.append('message_uid', 'production-check-replay');
  const response = await fetcher(`${config.backendBaseUrl}/api/v1/runs`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'x-api-key': config.apiToken,
      'x-idempotency-key': idempotencyKey,
    },
    body: form,
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  if (response.status !== 200 || body?.data?.run_id !== runId ||
      body?.data?.idempotent_replay !== true) {
    throw new Error(`Idempotent multipart replay failed: HTTP ${response.status}; ${text.slice(0, 300)}`);
  }
  return body.data;
}

async function runMailE2E(config, client, dependencies = {}) {
  const file = fs.readFileSync(config.fixturePath);
  const marker = `minmax-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  const subject = buildE2ESubject(config, marker);
  const startedAt = Date.now();
  await (dependencies.sendMail || sendExcelMail)(
    buildE2EMailOptions(config, marker, file)
  );
  const execution = await waitForE2EExecution(
    client,
    config,
    subject,
    startedAt,
    dependencies
  );
  const filter = latestOutputJson(execution, 'Отфильтровать письмо');
  const notification = latestOutputJson(execution, 'Сформировать уведомление');
  const runId = notification?.runId ||
    latestOutputJson(execution, 'Проверить ответ загрузки')?.runId;
  const idempotencyKey = filter?.idempotencyKey;
  if (!runId || !idempotencyKey) {
    throw new Error(`Execution ${execution.id} did not expose runId/idempotencyKey.`);
  }
  const status = await backendJson(
    config,
    `/api/v1/runs/${runId}`,
    {},
    dependencies
  );
  if (status.json?.data?.status !== 'completed') {
    throw new Error(`Run ${runId} status=${status.json?.data?.status}.`);
  }
  const registry = await backendJson(
    config,
    `/api/v1/upload-idempotency/${encodeURIComponent(idempotencyKey)}`,
    {},
    dependencies
  );
  if (registry.json?.data?.run_id !== runId ||
      registry.json?.data?.state !== 'completed' ||
      !registry.json?.data?.notification_sent_at) {
    throw new Error(`Registry record for ${runId} is incomplete or unnotified.`);
  }
  const ownerLink = String(notification?.notifyText || '').match(
    /https?:\/\/\S+\?runId=[0-9a-f-]{36}/i
  )?.[0];
  if (!ownerLink || !ownerLink.includes(`runId=${runId}`)) {
    throw new Error(`Owner Review link for run ${runId} is absent.`);
  }
  if (!ownerLink.startsWith(`${config.ownerUrl}/?runId=`)) {
    throw new Error(`Owner Review link uses unexpected base URL: ${ownerLink}.`);
  }
  const fetcher = dependencies.fetch || fetch;
  const ownerResponse = await fetcher(ownerLink, {
    signal: AbortSignal.timeout(15000),
  });
  if (!ownerResponse.ok) {
    throw new Error(`Owner Review link returned HTTP ${ownerResponse.status}.`);
  }
  await verifySourceArtifact(config, runId, file, dependencies);
  await (dependencies.waitForMailbox || waitForMailboxText)({
    host: config.mail.imapHost,
    port: config.mail.imapPort,
    user: config.mail.notificationUser,
    password: config.mail.notificationPassword,
    mailbox: 'INBOX',
    text: runId,
    since: startedAt,
    timeoutMs: config.timeoutMs,
    pollIntervalMs: 5000,
  });
  const replay = await verifyIdempotentReplay(
    config,
    idempotencyKey,
    runId,
    file,
    dependencies
  );
  const matchesAfterReplay = await matchingExecutionDetails(
    client,
    config,
    subject,
    startedAt
  );
  if (matchesAfterReplay.length !== 1) {
    throw new Error(`Execution duplicate detected: ${matchesAfterReplay.length} matches.`);
  }
  return {
    executionId: String(execution.id),
    runId,
    idempotencyKey,
    ownerLink,
    replayRunId: replay.run_id,
    executionCount: matchesAfterReplay.length,
  };
}

function productionEnvironment(config) {
  return {
    ...process.env,
    N8N_BASE_URL: config.n8n.baseUrl,
    N8N_API_KEY: config.n8n.apiKey,
    N8N_MINMAX_WORKFLOW_ID: config.n8n.workflowId,
    N8N_ARTHUR_CREDENTIAL_ID: config.n8n.credentials.httpHeaderAuth,
    N8N_MINMAX_IMAP_CREDENTIAL_ID: config.n8n.credentials.imap,
    N8N_MINMAX_SMTP_CREDENTIAL_ID: config.n8n.credentials.smtp,
    N8N_CONTAINER_NAME: config.n8n.container,
    PURCHASING_API_TOKEN: config.apiToken,
    PURCHASING_BUILD_SHA: config.shortSha,
    MINMAX_API_BASE_URL: config.backendContainerBaseUrl,
    MINMAX_OWNER_UI_BASE_URL: config.ownerUrl,
    MINMAX_ALLOWED_SENDER: config.allowedSender,
    MINMAX_SUBJECT_PATTERN: config.subjectPattern,
    MINMAX_NOTIFY_EMAIL: config.notifyEmail,
    MINMAX_SMTP_FROM: config.smtpFrom,
  };
}

async function inspectHistoricalExecution(config, client, dependencies = {}) {
  const logger = dependencies.logger || console;
  if (!config.executionId) {
    logger.log('[SKIP] MINMAX_EXECUTION_ID is not set; historical inspect skipped.');
    return null;
  }
  const inspect = dependencies.inspectExecution || inspectExecution;
  const inspection = await inspect({
    baseUrl: config.n8n.baseUrl,
    n8nApiKey: config.n8n.apiKey,
    workflowId: config.n8n.workflowId,
    executionId: config.executionId,
    container: config.n8n.container,
    credentialId: config.n8n.credentials.httpHeaderAuth,
    expectedCredentialId: config.n8n.credentials.httpHeaderAuth,
    purchasingApiToken: config.apiToken,
  }, {
    client,
    replay: dependencies.replay,
  });
  (dependencies.printInspection || printInspection)(
    inspection,
    logger,
    [config.apiToken]
  );
  return inspection;
}

async function runProductionCheck(config, dependencies = {}) {
  const logger = dependencies.logger || console;
  const branch = (dependencies.gitValue || gitValue)(['branch', '--show-current']);
  const sha = (dependencies.gitValue || gitValue)(['rev-parse', 'HEAD']);
  if (branch !== config.branch) {
    throw new Error(`branch=${branch}, expected ${config.branch}.`);
  }
  config.sha = sha;
  config.shortSha = sha.slice(0, 7);
  if (!fs.existsSync(config.fixturePath)) {
    throw new Error(`E2E fixture is missing: ${config.fixturePath}.`);
  }
  logger.log(`[PASS] branch=${branch}; SHA=${sha}`);

  startPersistentBackend(config, dependencies);
  await waitForHealth(config, dependencies);
  await verifyBackendRestart(config, dependencies);
  logger.log('[PASS] purchasing-web-backend is persistent and restart-safe.');

  const environment = productionEnvironment(config);
  const client = dependencies.client || new N8nApiClient({
    baseUrl: config.n8n.baseUrl,
    apiKey: config.n8n.apiKey,
  });
  const inspection = await inspectHistoricalExecution(
    config,
    client,
    dependencies
  );

  await verifyInvalidToken(config, dependencies);
  await verifyConnectionRefused(dependencies);
  await verifyDirectContract({
    baseUrl: config.backendBaseUrl,
    apiKey: config.apiToken,
    expectedSha: config.shortSha,
  }, {
    logger,
    request: dependencies.request,
    gitSha: config.shortSha,
  });
  probeN8nContainer({
    apiKey: config.apiToken,
    expectedSha: config.shortSha,
    n8nContainer: config.n8n.container,
    containerBaseUrl: config.backendContainerBaseUrl,
  }, {
    logger,
    spawn: dependencies.spawn,
  });

  const deployment = await (dependencies.deploy || deployWorkflow)(environment, logger);
  const credentialMetadata = await verifyCredentialMetadata(config, client);
  const deployed = await client.getWorkflow(config.n8n.workflowId);
  const publishedWorkflow = {
    nodes: deployed.activeVersion?.nodes || [],
  };
  const registryNode = registryNodeSnapshot(publishedWorkflow);
  const runtimeConfig = verifyDeployedRuntimeConfig(publishedWorkflow, config);
  if (registryNode.credential?.id !== config.n8n.credentials.httpHeaderAuth) {
    throw new Error('Published registry node has the wrong credential id.');
  }
  logger.log(`[PASS] credentials metadata=${JSON.stringify(credentialMetadata)}`);
  logger.log(`[PASS] published registry node=${JSON.stringify(registryNode)}`);
  logger.log(`[PASS] published runtime config=${JSON.stringify(runtimeConfig)}`);

  const e2e = await runMailE2E(config, client, dependencies);
  logger.log(`[PASS] email -> Excel -> run -> notification -> Owner Review ${JSON.stringify(e2e)}`);

  (dependencies.runCommand || runCommand)('npm', ['test'], { inherit: true });
  logger.log('[PASS] npm test');
  return {
    status: 'PASS',
    sha,
    historicalInspection: inspection,
    deployment,
    backend: { restartPolicy: 'unless-stopped', buildSha: config.shortSha },
    registryNode,
    e2e,
    tests: 'PASS',
  };
}

async function main(environment = process.env, logger = console) {
  try {
    const result = await runProductionCheck(
      productionConfig(environment),
      { logger }
    );
    logger.log(`[RESULT] PASS ${JSON.stringify({
      executionId: result.e2e.executionId,
      runId: result.e2e.runId,
      duplicate: false,
      sha: result.sha,
    })}`);
    return result;
  } catch (error) {
    logger.error(`[RESULT] FAIL ${error.message}`);
    throw error;
  }
}

if (require.main === module) {
  main().catch(() => {
    process.exitCode = 1;
  });
}

module.exports = {
  backendJson,
  buildE2EMailOptions,
  buildE2ESubject,
  deployedRuntimeConfigSnapshot,
  inspectHistoricalExecution,
  latestOutputJson,
  matchingExecutionDetails,
  productionConfig,
  productionEnvironment,
  registryNodeSnapshot,
  runMailE2E,
  runProductionCheck,
  startPersistentBackend,
  verifyConnectionRefused,
  verifyCredentialMetadata,
  verifyDeployedRuntimeConfig,
  verifyIdempotentReplay,
  verifyInvalidToken,
  waitForE2EExecution,
  waitForHealth,
};
