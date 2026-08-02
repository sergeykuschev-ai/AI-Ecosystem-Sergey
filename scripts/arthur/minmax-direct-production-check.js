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
const {
  normalizeEmailAddress,
  normalizeHeaderText,
  parseMimeMessage,
} = require('../../apps/minmax-mail-intake/mime_parser');

const ROOT = path.resolve(__dirname, '../..');
const BRANCH = 'feature/minmax-direct-imap-intake';
const BACKEND_COMPOSE = path.join(ROOT, 'docker/purchasing-web-backend/compose.yml');
const INTAKE_COMPOSE = path.join(ROOT, 'docker/minmax-direct-mail-intake/compose.yml');
const WORKBOOK = path.join(ROOT, 'tests/fixtures/SmartZapas_synthetic.xlsx');
const INTAKE_CONTAINER = 'minmax-direct-mail-intake';
const BACKEND_CONTAINER = 'purchasing-web-backend';
const NOTIFICATION_SUBJECT_PREFIX = 'Min/Max: отчёт обработан';

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

const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
]);

function errorChain(error) {
  const values = [];
  let current = error;
  while (current && !values.includes(current)) {
    values.push(current);
    current = current.cause;
  }
  return values;
}

function isTransientNetworkError(error) {
  return errorChain(error).some(candidate => {
    const code = String(candidate?.code || '').toUpperCase();
    const message = String(candidate?.message || candidate || '');
    return TRANSIENT_NETWORK_CODES.has(code) ||
      /(?:read\s+)?ECONNRESET|ETIMEDOUT|EPIPE|socket\s+(?:is\s+)?closed|connection\s+(?:was\s+)?closed|closed\s+the\s+connection|TLS[^\n]*connection\s+reset/i.test(message);
  });
}

function stageError(stage, error, retryCount) {
  const wrapped = new Error(
    `[stage=${stage}] ${String(error?.message || error)}; transient_retries=${retryCount}`,
    { cause: error }
  );
  wrapped.code = error?.code || 'E2E_STAGE_FAILED';
  wrapped.stage = stage;
  wrapped.retryCount = retryCount;
  return wrapped;
}

async function waitForStage(stage, operation, options) {
  const logger = options.logger || console;
  const now = options.now || Date.now;
  const sleep = options.delay || delay;
  const deadline = options.deadline;
  const intervalMs = options.intervalMs || 1000;
  const maxBackoffMs = options.maxBackoffMs || 10000;
  let retryCount = 0;
  let lastError = null;
  logger.log(`[STAGE] ${stage} start`);
  while (now() < deadline) {
    try {
      const value = await operation({
        attempt: retryCount + 1,
        remainingMs: Math.max(1, deadline - now()),
      });
      if (value) {
        logger.log(`[PASS] stage=${stage}; transient_retries=${retryCount}`);
        return { value, retryCount };
      }
      lastError = null;
    } catch (error) {
      lastError = error;
      if (!isTransientNetworkError(error)) throw stageError(stage, error, retryCount);
      retryCount += 1;
      const code = errorChain(error).map(item => item?.code).find(Boolean) || 'TRANSIENT_NETWORK_ERROR';
      logger.warn(
        `[RETRY] stage=${stage}; retry=${retryCount}; code=${code}; ` +
        `remaining_ms=${Math.max(0, deadline - now())}`
      );
    }
    const backoff = lastError
      ? Math.min(intervalMs * (2 ** Math.min(retryCount - 1, 4)), maxBackoffMs)
      : intervalMs;
    await sleep(Math.min(backoff, Math.max(1, deadline - now())));
  }
  const timeout = new Error(
    `overall E2E timeout exhausted${lastError ? `; last_error=${lastError.message}` : ''}`
  );
  timeout.code = 'E2E_STAGE_TIMEOUT';
  throw stageError(stage, timeout, retryCount);
}

async function withProductionRestore(task, restore) {
  try {
    return await task();
  } finally {
    await restore();
  }
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

async function waitForEvent(match, timeoutMs, messageUid = null) {
  return waitFor(async () => {
    const query = messageUid ? `?messageUid=${encodeURIComponent(messageUid)}` : '';
    const result = await jsonRequest(`http://127.0.0.1:3220/events/latest${query}`);
    const event = result.json?.event;
    if (result.status === 200 && event && match(event)) return event;
    return null;
  }, timeoutMs);
}

async function eventByUid(messageUid) {
  const result = await jsonRequest(
    `http://127.0.0.1:3220/events/latest?messageUid=${encodeURIComponent(messageUid)}`
  );
  if (result.status !== 200) {
    throw new Error(`service event HTTP ${result.status}: ${result.text.slice(0, 500)}`);
  }
  return result.json?.event || null;
}

function verifyDeliveredMessage(raw, expectedFilters, marker) {
  const parsed = parseMimeMessage(raw);
  const diagnostics = {
    normalizedSender: normalizeEmailAddress(parsed.sender || parsed.from),
    expectedSender: normalizeEmailAddress(expectedFilters.allowedSender),
    normalizedSubject: normalizeHeaderText(parsed.subject).slice(0, 500),
    expectedSubjectPattern: normalizeHeaderText(expectedFilters.subjectPattern).slice(0, 500),
    markerPresent: normalizeHeaderText(parsed.subject).toLowerCase().includes(
      normalizeHeaderText(marker).toLowerCase()
    ),
  };
  const senderMatches = diagnostics.normalizedSender === diagnostics.expectedSender;
  const subjectMatches = diagnostics.normalizedSubject.toLowerCase().includes(
    diagnostics.expectedSubjectPattern.toLowerCase()
  );
  if (!senderMatches || !subjectMatches || !diagnostics.markerPresent) {
    throw new Error(`E2E MIME filter mismatch: ${JSON.stringify(diagnostics)}`);
  }
  return diagnostics;
}

function exactTokenPresent(value, token) {
  const escaped = String(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Za-z0-9-])${escaped}(?:$|[^A-Za-z0-9-])`).test(
    String(value || '')
  );
}

function inspectNotificationMessage(message, options) {
  const parsed = parseMimeMessage(message.raw);
  const subject = normalizeHeaderText(parsed.subject);
  const decodedContent = [subject, parsed.text, parsed.html].filter(Boolean).join('\n');
  const receivedTimestamp = Date.parse(message.receivedAt || parsed.date || '');
  const e2eStartTimestamp = Date.parse(options.e2eStartedAt);
  const e2eStartSecond = Math.floor(e2eStartTimestamp / 1000) * 1000;
  const evidence = {
    uid: String(message.uid),
    subject,
    subjectPrefixMatches: subject.startsWith(options.subjectPrefix),
    exactRunIdMatches: exactTokenPresent(decodedContent, options.runId),
    receivedAt: Number.isFinite(receivedTimestamp)
      ? new Date(receivedTimestamp).toISOString()
      : null,
    afterE2EStart: Number.isFinite(receivedTimestamp) &&
      Number.isFinite(e2eStartTimestamp) && receivedTimestamp >= e2eStartSecond,
    contentTypes: parsed.textParts.map(part => part.contentType),
    transferEncodings: parsed.textParts.map(part => part.transferEncoding),
  };
  return {
    ...evidence,
    matches: evidence.subjectPrefixMatches &&
      evidence.exactRunIdMatches &&
      evidence.afterE2EStart,
  };
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
  const retryCounts = {};
  logger.log(`[PASS] branch=${branch}; SHA=${sha}`);

  return withProductionRestore(async () => {
    run('docker', ['compose', '-f', BACKEND_COMPOSE, 'up', '-d', '--build', '--wait'], { env: productionEnv });
    await verifyBackend(config, sha);
    logger.log('[PASS] purchasing backend healthy');
    intakeStarted = true;
    run('docker', ['compose', '-f', INTAKE_COMPOSE, 'up', '-d', '--build', '--wait'], { env: e2eEnv });
    const health = await waitForHealth(sha, config.e2e.timeoutMs, e2eFilters);
    logger.log(`[PASS] intake healthy with isolated E2E filters; poll=${health.last_poll_time}`);
    const e2eDeadline = Date.now() + config.e2e.timeoutMs;

    const filename = `${marker}.xlsx`;
    const workbook = fs.readFileSync(WORKBOOK);
    const workbookSha = crypto.createHash('sha256').update(workbook).digest('hex');
    const sentAt = new Date().toISOString();
    let emailSubmitted = false;
    const correlateStage = await waitForStage('correlate_e2e_mail', async ({ remainingMs }) => {
      if (!emailSubmitted) {
        try {
          await sendExcelMail({
            host: config.e2e.smtpHost,
            port: config.e2e.smtpPort,
            timeoutMs: Math.min(30000, remainingMs),
            socketTimeoutMs: Math.min(30000, remainingMs),
            user: config.e2e.user,
            password: config.e2e.password,
            from: config.e2e.user,
            to: config.direct.imap.user,
            marker,
            subject: marker,
            fileName: filename,
            file: workbook,
          });
          emailSubmitted = true;
          logger.log(`[PASS] one E2E email sent; marker=${marker}`);
        } catch (error) {
          if (error.deliveryAccepted || error.deliveryUncertain) {
            emailSubmitted = true;
            logger.warn(
              `[RETRY] stage=correlate_e2e_mail; SMTP delivery uncertain; ` +
              'message will be correlated by marker without resending'
            );
          } else {
            throw error;
          }
        }
      }
      return waitForMailboxText({
        host: config.direct.imap.host,
        port: config.direct.imap.port,
        timeoutMs: remainingMs,
        socketTimeoutMs: Math.min(30000, remainingMs),
        pollIntervalMs: 3000,
        user: config.direct.imap.user,
        password: config.direct.imap.password,
        mailbox: config.direct.imap.mailbox,
        since: sentAt,
        text: marker,
      });
    }, { deadline: e2eDeadline, logger, intervalMs: 1000 });
    retryCounts.correlate_e2e_mail = correlateStage.retryCount;
    const delivered = correlateStage.value;
    const mimeDiagnostics = verifyDeliveredMessage(delivered.raw, e2eFilters, marker);
    logger.log(`[PASS] E2E MIME correlated; uid=${delivered.uid}; ${JSON.stringify(mimeDiagnostics)}`);

    const serviceStage = await waitForStage('wait_service_event', async () => {
      const candidate = await eventByUid(delivered.uid);
      if (
        candidate?.messageUid === delivered.uid &&
        candidate?.correlationMarker === marker
      ) return candidate;
      return null;
    }, { deadline: e2eDeadline, logger, intervalMs: 1000 });
    retryCounts.wait_service_event = serviceStage.retryCount;
    const serviceEvent = serviceStage.value;
    const serviceEventId = serviceEvent.eventId;

    const runStage = await waitForStage('wait_run', async () => {
      const candidate = await eventByUid(delivered.uid);
      if (
        candidate?.messageUid !== delivered.uid ||
        candidate?.correlationMarker !== marker ||
        candidate?.eventId !== serviceEventId
      ) return null;
      if (candidate.status === 'completed') return candidate;
      if (candidate.status === 'failed') {
        const failure = new Error(candidate.error?.message || 'service event failed');
        failure.code = candidate.error?.code || 'SERVICE_EVENT_FAILED';
        throw failure;
      }
      return null;
    }, { deadline: e2eDeadline, logger, intervalMs: 1000 });
    retryCounts.wait_run = runStage.retryCount;
    const event = runStage.value;
    if (event.sourceArtifactSha256 !== workbookSha) {
      throw new Error('source artifact SHA differs from E2E workbook.');
    }
    if (!event.ownerReviewUrl?.includes(`runId=${event.runId}`)) {
      throw new Error('Owner Review URL does not contain the runId.');
    }
    const ownerStage = await waitForStage('owner_review_fetch', () =>
      verifyOwnerReview(event.ownerReviewUrl), {
      deadline: e2eDeadline, logger, intervalMs: 1000,
    });
    retryCounts.owner_review_fetch = ownerStage.retryCount;
    const ownerReview = ownerStage.value;
    let notificationEvidence = null;
    const notificationStage = await waitForStage(
      'wait_notification',
      ({ remainingMs }) => waitForMailboxText({
        host: config.e2e.notificationHost,
        port: config.e2e.notificationPort,
        timeoutMs: remainingMs,
        socketTimeoutMs: Math.min(30000, remainingMs),
        pollIntervalMs: 5000,
        user: config.e2e.notificationUser,
        password: config.e2e.notificationPassword,
        mailbox: 'INBOX',
        since: sentAt,
        text: event.runId,
        description: `notification for runId ${event.runId}`,
        matchMessage(message) {
          const evidence = inspectNotificationMessage(message, {
            runId: event.runId,
            subjectPrefix: NOTIFICATION_SUBJECT_PREFIX,
            e2eStartedAt: sentAt,
          });
          if (evidence.matches) notificationEvidence = evidence;
          return evidence.matches;
        },
      }),
      { deadline: e2eDeadline, logger, intervalMs: 1000 }
    );
    retryCounts.wait_notification = notificationStage.retryCount;
    logger.log(
      `[PASS] notification received; runId=${event.runId}; ` +
      `${JSON.stringify(notificationEvidence)}`
    );

    const beforeRestartEventCount = Number(health.event_count || 0);
    run('docker', ['restart', INTAKE_CONTAINER], { env: e2eEnv });
    const replayStage = await waitForStage('replay', async () => {
      const replayHealth = await jsonRequest('http://127.0.0.1:3220/health');
      if (
        replayHealth.status !== 200 ||
        replayHealth.json?.build_sha !== sha ||
        replayHealth.json?.allowed_sender !== e2eFilters.allowedSender ||
        replayHealth.json?.subject_pattern !== e2eFilters.subjectPattern ||
        replayHealth.json?.imap_connected !== true
      ) return null;
      const candidate = await eventByUid(delivered.uid);
      if (
        candidate?.messageUid === delivered.uid &&
        candidate?.correlationMarker === marker &&
        candidate?.eventId === serviceEventId &&
        candidate?.idempotencyKey === event.idempotencyKey &&
        candidate?.runId === event.runId &&
        candidate?.replay === true &&
        candidate?.notificationSuppressed === true
      ) return { event: candidate, health: replayHealth.json };
      return null;
    }, { deadline: e2eDeadline, logger, intervalMs: 1000 });
    retryCounts.replay = replayStage.retryCount;
    const replay = replayStage.value.event;
    if (replay.runId !== event.runId) throw new Error('Restart replay created another run.');
    const afterRestartHealth = replayStage.value.health;
    if (Number(afterRestartHealth.event_count || 0) <= beforeRestartEventCount) {
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
      notification: notificationEvidence,
      replay: { noDuplicate: true, runId: replay.runId },
      restart: 'healthy',
      retries: retryCounts,
      tests: 'PASS',
    };
  }, async () => {
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
  });
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
  eventByUid,
  exactTokenPresent,
  inspectNotificationMessage,
  isTransientNetworkError,
  main,
  NOTIFICATION_SUBJECT_PREFIX,
  productionConfig,
  redact,
  runProductionCheck,
  stageError,
  verifyDeliveredMessage,
  waitFor,
  waitForEvent,
  waitForHealth,
  waitForStage,
  withProductionRestore,
};
