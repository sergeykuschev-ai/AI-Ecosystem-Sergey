'use strict';

const { execFileSync, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');

const {
  MINMAX_HTTP_CONTRACT_VERSION,
  PURCHASING_SERVICE_NAME,
  REPOSITORY_ROOT,
} = require('../../apps/purchasing-web-backend/config');

const DEFAULT_BASE_URL = 'http://127.0.0.1:3210';
const DEFAULT_CONTAINER_BASE_URL = 'http://host.docker.internal:3210';

function parseArguments(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    apiKey: process.env.PURCHASING_API_TOKEN || '',
    expectedSha: null,
    n8nContainer: process.env.N8N_CONTAINER_NAME || '',
    containerBaseUrl: DEFAULT_CONTAINER_BASE_URL,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name.startsWith('--') || value === undefined) {
      throw new Error(`Некорректный аргумент ${name || '(пусто)'}.`);
    }
    if (name === '--base-url') options.baseUrl = value;
    else if (name === '--api-key') options.apiKey = value;
    else if (name === '--expected-sha') options.expectedSha = value;
    else if (name === '--n8n-container') options.n8nContainer = value;
    else if (name === '--container-base-url') options.containerBaseUrl = value;
    else throw new Error(`Неизвестный аргумент ${name}.`);
    index += 1;
  }
  options.baseUrl = String(options.baseUrl).replace(/\/$/, '');
  options.containerBaseUrl = String(options.containerBaseUrl).replace(/\/$/, '');
  if (!options.apiKey) {
    throw new Error(
      'API key обязателен: задайте PURCHASING_API_TOKEN или --api-key.'
    );
  }
  return options;
}

function localGitSha() {
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  }).trim().toLowerCase();
}

function bodyPreview(value) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

async function rawRequest(baseUrl, requestPath, options = {}) {
  const response = await fetch(`${baseUrl}${requestPath}`, options);
  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return {
    method: options.method || 'GET',
    requestPath,
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    contentType,
    text,
    json,
  };
}

function assertJsonResponse(result, expectedStatuses) {
  if (!/^application\/json(?:;|$)/i.test(result.contentType)) {
    throw new Error(
      `${result.method} ${result.requestPath}: Content-Type ` +
      `"${result.contentType || '(пусто)'}", body="${bodyPreview(result.text)}".`
    );
  }
  if (result.json === null) {
    throw new Error(
      `${result.method} ${result.requestPath}: body не является JSON: ` +
      `"${bodyPreview(result.text)}".`
    );
  }
  if (result.json?.error?.code === 'ROUTE_NOT_FOUND') {
    throw new Error(`${result.method} ${result.requestPath}: ROUTE_NOT_FOUND.`);
  }
  if (!expectedStatuses.includes(result.status)) {
    throw new Error(
      `${result.method} ${result.requestPath}: HTTP ${result.status}, ` +
      `body="${bodyPreview(result.text)}".`
    );
  }
  return result;
}

function logResponse(logger, label, result) {
  logger.log(
    `[PASS] ${label}: HTTP ${result.status}; ` +
    `content-type=${result.contentType}; body=${bodyPreview(result.text)}`
  );
}

function authHeaders(apiKey, mode) {
  if (mode === 'x-api-key') return { 'x-api-key': apiKey };
  if (mode === 'bearer') return { authorization: `Bearer ${apiKey}` };
  return {};
}

function assertHealthIdentity(result, expectedSha) {
  assertJsonResponse(result, [200]);
  const data = result.json?.data;
  if (
    data?.status !== 'ok' ||
    data?.service !== PURCHASING_SERVICE_NAME ||
    data?.minmax_http_contract !== MINMAX_HTTP_CONTRACT_VERSION
  ) {
    throw new Error(
      'Health endpoint отвечает не ожидаемый Purchasing backend: ' +
      bodyPreview(result.text)
    );
  }
  const buildSha = String(data.build_sha || '').toLowerCase();
  if (!buildSha) {
    throw new Error(
      'Health endpoint не содержит build_sha. Запустите backend с ' +
      'PURCHASING_BUILD_SHA=(git rev-parse --short HEAD).'
    );
  }
  if (!buildSha.startsWith(expectedSha) && !expectedSha.startsWith(buildSha)) {
    throw new Error(
      `Backend build_sha=${buildSha}, ожидается HEAD=${expectedSha}.`
    );
  }
}

async function verifyDirectContract(options, dependencies = {}) {
  const logger = dependencies.logger || console;
  const request = dependencies.request || rawRequest;
  const expectedSha = String(
    options.expectedSha || dependencies.gitSha || localGitSha()
  ).trim().toLowerCase();
  const apiHeaders = authHeaders(options.apiKey, 'x-api-key');

  for (const mode of ['none', 'bearer', 'x-api-key']) {
    const health = await request(options.baseUrl, '/api/v1/health', {
      headers: authHeaders(options.apiKey, mode),
    });
    assertJsonResponse(health, mode === 'x-api-key' ? [200] : [200, 401]);
    logResponse(logger, `health auth=${mode}`, health);
    if (mode === 'x-api-key') assertHealthIdentity(health, expectedSha);
    if (health.status === 401 && health.json?.error?.code !== 'API_TOKEN_REQUIRED') {
      throw new Error(`health auth=${mode}: ожидался API_TOKEN_REQUIRED.`);
    }
  }

  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const key = `minmax-diagnostic-${suffix}`;
  const detailPath = `/api/v1/upload-idempotency/${key}`;

  const missing = await request(options.baseUrl, detailPath, {
    headers: apiHeaders,
  });
  assertJsonResponse(missing, [404]);
  if (missing.json?.error?.code !== 'UPLOAD_IDEMPOTENCY_RECORD_NOT_FOUND') {
    throw new Error(`GET registry: неожиданный ответ ${bodyPreview(missing.text)}.`);
  }
  logResponse(logger, 'GET registry (missing)', missing);

  const registered = await request(
    options.baseUrl,
    '/api/v1/upload-idempotency',
    {
      method: 'POST',
      headers: {
        ...apiHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        idempotency_key: key,
        mailbox: 'INBOX',
        message_uid: `diagnostic-${suffix}`,
        attachment_name: 'diagnostic.xlsx',
        state: 'rejected',
        error_code: 'DIAGNOSTIC_ONLY',
      }),
    }
  );
  assertJsonResponse(registered, [201]);
  logResponse(logger, 'POST registry', registered);

  const found = await request(options.baseUrl, detailPath, {
    headers: apiHeaders,
  });
  assertJsonResponse(found, [200]);
  logResponse(logger, 'GET registry (found)', found);

  const state = await request(options.baseUrl, `${detailPath}/state`, {
    method: 'POST',
    headers: {
      ...apiHeaders,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      state: 'uncertain',
      error_code: 'DIAGNOSTIC_UNCERTAIN',
    }),
  });
  assertJsonResponse(state, [200]);
  logResponse(logger, 'POST state', state);

  const notification = await request(
    options.baseUrl,
    `${detailPath}/notification`,
    {
      method: 'POST',
      headers: {
        ...apiHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sent_at: new Date().toISOString() }),
    }
  );
  assertJsonResponse(notification, [200]);
  logResponse(logger, 'POST notification', notification);

  return { expectedSha, key };
}

function inspectWindowsPort(port, dependencies = {}) {
  const logger = dependencies.logger || console;
  const platform = dependencies.platform || process.platform;
  const spawn = dependencies.spawn || spawnSync;
  if (platform !== 'win32') {
    logger.log('[SKIP] Проверка PID порта доступна только на Windows.');
    return null;
  }
  const command = [
    `$items = Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen`,
    '$result = @($items | ForEach-Object {',
    '  $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $_.OwningProcess)',
    '  [PSCustomObject]@{ pid=$_.OwningProcess; name=$p.Name; commandLine=$p.CommandLine }',
    '})',
    '$result | ConvertTo-Json -Compress',
  ].join('; ');
  const result = spawn(
    'powershell.exe',
    ['-NoProfile', '-Command', command],
    { encoding: 'utf8' }
  );
  if (result.status !== 0) {
    throw new Error(`Не удалось проверить listener порта ${port}: ${result.stderr}`);
  }
  const parsed = result.stdout.trim()
    ? JSON.parse(result.stdout.trim())
    : [];
  const listeners = (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean);
  const unique = new Map(listeners.map(item => [item.pid, item]));
  if (unique.size !== 1) {
    throw new Error(
      `На порту ${port} ожидается один процесс, найдено: ${unique.size}.`
    );
  }
  const listener = [...unique.values()][0];
  if (!/node(?:\.exe)?$/i.test(String(listener.name || ''))) {
    throw new Error(
      `Порт ${port} слушает не Node.js: PID ${listener.pid}, ${listener.name}.`
    );
  }
  logger.log(
    `[PASS] port ${port}: PID ${listener.pid}; ${listener.name}; ` +
    `${bodyPreview(listener.commandLine)}`
  );
  return listener;
}

function probeN8nContainer(options, dependencies = {}) {
  const logger = dependencies.logger || console;
  const spawn = dependencies.spawn || spawnSync;
  if (!options.n8nContainer) {
    logger.log(
      '[SKIP] Контейнерный probe не запущен; задайте --n8n-container <name>.'
    );
    return null;
  }
  const probeCode = [
    "const base=process.argv[2].replace(/\\/$/,'');",
    "const key=process.env.MINMAX_VERIFY_API_KEY;",
    "const modes=[['none',{}],['bearer',{authorization:'Bearer '+key}],['x-api-key',{'x-api-key':key}]];",
    "Promise.all(modes.map(async ([mode,headers])=>{",
    "const r=await fetch(base+'/api/v1/health',{headers});",
    "return {mode,status:r.status,contentType:r.headers.get('content-type')||'',body:await r.text()};",
    "})).then(v=>process.stdout.write(JSON.stringify(v))).catch(e=>{console.error(e.message);process.exit(1)});",
  ].join('');
  const result = spawn(
    'docker',
    [
      'exec',
      '-i',
      '-e',
      'MINMAX_VERIFY_API_KEY',
      options.n8nContainer,
      'node',
      '-',
      options.containerBaseUrl,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        MINMAX_VERIFY_API_KEY: options.apiKey,
      },
      input: probeCode,
    }
  );
  if (result.status !== 0) {
    throw new Error(
      `Probe из контейнера ${options.n8nContainer} не выполнен: ` +
      `${bodyPreview(result.stderr)}`
    );
  }
  const responses = JSON.parse(result.stdout);
  for (const item of responses) {
    const parsed = {
      method: 'GET',
      requestPath: '/api/v1/health',
      status: item.status,
      contentType: item.contentType,
      text: item.body,
      json: (() => {
        try { return JSON.parse(item.body); } catch { return null; }
      })(),
    };
    assertJsonResponse(
      parsed,
      item.mode === 'x-api-key' ? [200] : [401]
    );
    if (item.mode === 'x-api-key') {
      assertHealthIdentity(parsed, options.expectedSha || localGitSha());
    } else if (parsed.json?.error?.code !== 'API_TOKEN_REQUIRED') {
      throw new Error(`container auth=${item.mode}: ожидался API_TOKEN_REQUIRED.`);
    }
    logResponse(logger, `container health auth=${item.mode}`, parsed);
  }
  return responses;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  options.expectedSha = String(options.expectedSha || localGitSha()).toLowerCase();
  const url = new URL(options.baseUrl);
  console.log(
    `[INFO] local HEAD=${localGitSha()}; expected backend SHA=${options.expectedSha}`
  );
  inspectWindowsPort(Number(url.port || 80));
  await verifyDirectContract(options);
  probeN8nContainer(options);
  console.log('[PASS] MinMax n8n ↔ Purchasing backend contract verified.');
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[FAIL] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertHealthIdentity,
  assertJsonResponse,
  authHeaders,
  bodyPreview,
  inspectWindowsPort,
  localGitSha,
  main,
  parseArguments,
  probeN8nContainer,
  rawRequest,
  verifyDirectContract,
};
