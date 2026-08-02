'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const {
  sendExcelMail,
  waitForMailboxText,
} = require('./minmax-mail-protocol');
const { loadConfig } = require('../../apps/minmax-mail-intake/config');

const ROOT = path.resolve(__dirname, '../..');
const BRANCH = 'feature/minmax-direct-imap-intake';
const BACKEND_COMPOSE = path.join(ROOT, 'docker/purchasing-web-backend/compose.yml');
const INTAKE_COMPOSE = path.join(ROOT, 'docker/minmax-direct-mail-intake/compose.yml');
const WORKBOOK = path.join(ROOT, 'tests/fixtures/SmartZapas_synthetic.xlsx');
const INTAKE_CONTAINER = 'minmax-direct-mail-intake';
const BACKEND_CONTAINER = 'purchasing-web-backend';

function required(name, environment) {
  const value = String(environment[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function integer(name, value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function productionConfig(environment = process.env) {
  const normalizedEnvironment = {
    ...environment,
    MINMAX_BUILD_SHA: environment.MINMAX_BUILD_SHA || 'runtime-git-sha',
    MINMAX_PURCHASING_API_BASE_URL:
      environment.MINMAX_PURCHASING_API_BASE_URL ||
      'http://host.docker.internal:3210',
  };
  const direct = loadConfig(normalizedEnvironment);
  const e2eUser = required('MINMAX_E2E_MAIL_USER', environment).toLowerCase();
  const notificationUser = String(
    environment.MINMAX_NOTIFICATION_IMAP_USER || direct.imap.user
  ).trim();
  const notificationPassword = String(
    environment.MINMAX_NOTIFICATION_IMAP_PASSWORD ||
      (notificationUser === direct.imap.user ? direct.imap.password : '')
  ).trim();
  if (!notificationPassword) {
    throw new Error(
      'MINMAX_NOTIFICATION_IMAP_PASSWORD is required for a separate notification mailbox.'
    );
  }
  return {
    direct,
    environment: normalizedEnvironment,
    e2e: {
      user: e2eUser,
      password: required('MINMAX_E2E_MAIL_PASSWORD', environment),
      smtpHost: String(environment.MINMAX_E2E_SMTP_HOST || 'smtp.yandex.ru'),
      smtpPort: integer('MINMAX_E2E_SMTP_PORT', environment.MINMAX_E2E_SMTP_PORT, 465),
      notificationUser,
      notificationPassword,
      notificationHost: String(
        environment.MINMAX_NOTIFICATION_IMAP_HOST || direct.imap.host
      ),
      notificationPort: integer(
        'MINMAX_NOTIFICATION_IMAP_PORT',
        environment.MINMAX_NOTIFICATION_IMAP_PORT,
        direct.imap.port
      ),
      timeoutMs: integer(
        'MINMAX_E2E_TIMEOUT_MS', environment.MINMAX_E2E_TIMEOUT_MS, 900000
      ),
      backendHostBaseUrl: String(
        environment.MINMAX_PURCHASING_HOST_BASE_URL || 'http://127.0.0.1:3210'
      ).replace(/\/$/, ''),
    },
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 32 * 1024 * 1024,
    stdio: options.inherit ? 'inherit' : 'pipe',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().slice(-4000);
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${detail}`);
  }
  return String(result.stdout || '').trim();
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 32 * 1024 * 1024,
    stdio: 'pipe',
  });
  return {
    status: result.status,
    error: result.error?.message || null,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  };
}

function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
  }).trim();
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(options.timeoutMs || 30000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status, text, json, headers: response.headers };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs, intervalMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) { lastError = error; }
    await delay(Math.min(intervalMs, Math.max(1, deadline - Date.now())));
  }
  throw lastError || new Error('Timed out waiting for condition.');
}

async function waitForHealth(expectedSha, timeoutMs, expectedFilters = null) {
  return waitFor(async () => {
    const result = await jsonRequest('http://127.0.0.1:3220/health');
    if (
      result.status === 200 &&
      result.json?.service === 'minmax-direct-mail-intake' &&
      result.json?.build_sha === expectedSha &&
      result.json?.imap_connected === true &&
      (!expectedFilters || (
        result.json?.allowed_sender === expectedFilters.allowedSender &&
        result.json?.subject_pattern === expectedFilters.subjectPattern
      ))
    ) return result.json;
    throw new Error(`intake health HTTP ${result.status}: ${result.text.slice(0, 500)}`);
  }, timeoutMs);
}

async function waitForEvent(match, timeoutMs) {
  return waitFor(async () => {
    const result = await jsonRequest('http://127.0.0.1:3220/events/latest');
    const event = result.json?.event;
    if (result.status === 200 && event && match(event)) return event;
    return null;
  }, timeoutMs);
}

function composeEnvironment(config, sha) {
  return {
    ...process.env,
    ...config.environment,
    MINMAX_BUILD_SHA: sha,
    PURCHASING_BUILD_SHA: sha.slice(0, 7),
  };
}

function redact(value, environment = process.env) {
  let output = String(value || '');
  for (const [name, secret] of Object.entries(environment)) {
    if (!/(?:PASSWORD|TOKEN|SECRET|API_KEY)/i.test(name) || !secret) continue;
    output = output.split(String(secret)).join('[REDACTED]');
  }
  return output;
}

function diagnostics(logger = console, environment = process.env) {
  logger.error('[DIAGNOSTICS] stage failure');
  for (const container of [INTAKE_CONTAINER, BACKEND_CONTAINER]) {
    for (const [label, args] of [
      ['state', ['inspect', '--format', '{{json .State}}', container]],
      ['health', ['inspect', '--format', '{{json .State.Health}}', container]],
      ['logs', ['logs', '--tail', '300', '--timestamps', container]],
    ]) {
      const result = capture('docker', args);
      logger.error(redact(`[DIAGNOSTICS ${container} ${label}] ${
        (result.stdout || result.stderr || result.error || '(empty)').trim()
      }`, environment));
    }
  }
}

async function verifyBackend(config, sha) {
  const result = await jsonRequest(`${config.e2e.backendHostBaseUrl}/api/v1/health`, {
    headers: { 'x-api-key': config.direct.purchasing.apiToken },
  });
  const data = result.json?.data;
  if (
    result.status !== 200 ||
    data?.service !== 'purchasing-web' ||
    !String(sha).startsWith(String(data?.build_sha || ''))
  ) {
    throw new Error(`Purchasing health mismatch: HTTP ${result.status}; ${result.text}`);
  }
  return data;
}

async function verifyOwnerReview(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const body = await response.text();
  if (response.status !== 200 || !body.includes('Purchasing')) {
    throw new Error(`Owner Review URL failed: HTTP ${response.status}.`);
  }
  return { status: response.status, url };
}

async function runProductionCheck(config, dependencies = {}) {
  const logger = dependencies.logger || console;
  const branch = git(['branch', '--show-current']);
  const sha = git(['rev-parse', 'HEAD']);
  if (branch !== BRANCH) throw new Error(`branch=${branch}; expected ${BRANCH}.`);
  const dataDiffBefore = git(['diff', '--', 'data/purchasing']);
  const productionEnv = composeEnvironment(config, sha);
  const marker = `minmax-direct-e2e-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const e2eFilters = {
    allowedSender: config.e2e.user,
    subjectPattern: marker,
  };
  const e2eEnv = {
    ...productionEnv,
    MINMAX_ALLOWED_SENDER: e2eFilters.allowedSender,
    MINMAX_SUBJECT_PATTERN: e2eFilters.subjectPattern,
  };
  let intakeStarted = false;
  logger.log(`[PASS] branch=${branch}; SHA=${sha}`);

  try {
    run('docker', ['compose', '-f', BACKEND_COMPOSE, 'up', '-d', '--build', '--wait'], { env: productionEnv });
    await verifyBackend(config, sha);
    logger.log('[PASS] purchasing backend healthy');
    intakeStarted = true;
    run('docker', ['compose', '-f', INTAKE_COMPOSE, 'up', '-d', '--build', '--wait'], { env: e2eEnv });
    const health = await waitForHealth(sha, config.e2e.timeoutMs, e2eFilters);
    logger.log(`[PASS] intake healthy with isolated E2E filters; poll=${health.last_poll_time}`);

    const filename = `${marker}.xlsx`;
    const workbook = fs.readFileSync(WORKBOOK);
    const workbookSha = crypto.createHash('sha256').update(workbook).digest('hex');
    await sendExcelMail({
      host: config.e2e.smtpHost,
      port: config.e2e.smtpPort,
      timeoutMs: 30000,
      user: config.e2e.user,
      password: config.e2e.password,
      from: config.e2e.user,
      to: config.direct.imap.user,
      marker,
      subject: marker,
      fileName: filename,
      file: workbook,
    });
    logger.log(`[PASS] one E2E email sent; marker=${marker}`);

    const event = await waitForEvent(candidate =>
      candidate.status === 'completed' && candidate.attachmentName === filename,
    config.e2e.timeoutMs);
    if (event.sourceArtifactSha256 !== workbookSha) {
      throw new Error('source artifact SHA differs from E2E workbook.');
    }
    if (!event.ownerReviewUrl?.includes(`runId=${event.runId}`)) {
      throw new Error('Owner Review URL does not contain the runId.');
    }
    const ownerReview = await verifyOwnerReview(event.ownerReviewUrl);
    await waitForMailboxText({
      host: config.e2e.notificationHost,
      port: config.e2e.notificationPort,
      timeoutMs: config.e2e.timeoutMs,
      pollIntervalMs: 5000,
      user: config.e2e.notificationUser,
      password: config.e2e.notificationPassword,
      mailbox: 'INBOX',
      since: event.startedAt,
      text: event.runId,
    });
    logger.log(`[PASS] notification received; runId=${event.runId}`);

    const beforeRestartEventCount = Number(health.event_count || 0);
    run('docker', ['restart', INTAKE_CONTAINER], { env: e2eEnv });
    await waitForHealth(sha, config.e2e.timeoutMs, e2eFilters);
    const replay = await waitForEvent(candidate =>
      candidate.idempotencyKey === event.idempotencyKey &&
      candidate.runId === event.runId &&
      candidate.replay === true &&
      candidate.notificationSuppressed === true,
    config.e2e.timeoutMs);
    if (replay.runId !== event.runId) throw new Error('Restart replay created another run.');
    const afterRestartHealth = await jsonRequest('http://127.0.0.1:3220/health');
    if (Number(afterRestartHealth.json?.event_count || 0) <= beforeRestartEventCount) {
      throw new Error('Service restart did not produce a replay event.');
    }
    logger.log('[PASS] restart-safe replay produced no duplicate run or notification');

    run('npm', ['test'], { inherit: true, env: productionEnv });
    if (git(['diff', '--', 'data/purchasing']) !== dataDiffBefore) {
      throw new Error('data/purchasing changed during production-check.');
    }
    return {
      sha,
      eventId: event.eventId,
      runId: event.runId,
      sourceArtifactSha256: event.sourceArtifactSha256,
      ownerReview,
      notification: 'received',
      replay: { noDuplicate: true, runId: replay.runId },
      restart: 'healthy',
      tests: 'PASS',
    };
  } finally {
    if (intakeStarted) {
      run('docker', [
        'compose', '-f', INTAKE_COMPOSE, 'up', '-d', '--force-recreate', '--wait',
      ], { env: productionEnv });
      await waitForHealth(sha, config.e2e.timeoutMs, {
        allowedSender: config.direct.allowedSender,
        subjectPattern: config.direct.subjectPattern,
      });
      logger.log('[PASS] production intake filters restored after E2E');
    }
  }
}

async function main(environment = process.env, logger = console) {
  try {
    const result = await runProductionCheck(productionConfig(environment), { logger });
    logger.log(`[RESULT] PASS ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    logger.error(redact(`[RESULT] FAIL ${error.message}`, environment));
    diagnostics(logger, environment);
    throw error;
  }
}

if (require.main === module) {
  main().catch(() => { process.exitCode = 1; });
}

module.exports = {
  diagnostics,
  main,
  productionConfig,
  redact,
  runProductionCheck,
  waitFor,
  waitForEvent,
  waitForHealth,
};
