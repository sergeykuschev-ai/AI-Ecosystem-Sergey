'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');

const { loadConfig } = require('../config');
const { eventForMessageUid, healthPayload } = require('../health_server');
const {
  ImapClient,
  extractFetchedMessage,
  parseSearch,
  sinceDate,
} = require('../imap_client');
const {
  normalizeEmailAddress,
  normalizeHeaderText,
  parseMimeMessage,
} = require('../mime_parser');
const { NotificationMailer } = require('../notification_mailer');
const {
  PurchasingClient,
  PurchasingHttpError,
} = require('../purchasing_client');
const {
  MinmaxMailWorker,
  buildIdempotencyKey,
  evaluateMessage,
  filterDiagnostics,
} = require('../worker');
const {
  inspectNotificationMessage,
  isTransientNetworkError,
  NOTIFICATION_SUBJECT_PREFIX,
  productionConfig,
  redact,
  verifyDeliveredMessage,
  waitForStage,
  withProductionRestore,
} = require('../../../scripts/arthur/minmax-direct-production-check');
const {
  buildExcelMessage,
  imapInternalDate,
} = require('../../../scripts/arthur/minmax-mail-protocol');

const ROOT = path.resolve(__dirname, '../../..');
const XLSX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('fixture')]);

function environment(overrides = {}) {
  return {
    MINMAX_BUILD_SHA: 'abcdef1',
    MINMAX_ALLOWED_SENDER: 'supplier@example.test',
    MINMAX_SUBJECT_PATTERN: 'minmax report',
    MINMAX_IMAP_USER: 'mail@example.test',
    MINMAX_IMAP_PASSWORD: 'imap-password',
    MINMAX_SMTP_USER: 'mail@example.test',
    MINMAX_SMTP_PASSWORD: 'smtp-password',
    MINMAX_SMTP_FROM: 'robot@example.test',
    MINMAX_NOTIFY_EMAIL: 'owner@example.test',
    MINMAX_PURCHASING_API_BASE_URL: 'http://host.docker.internal:3210',
    PURCHASING_API_TOKEN: 'api-token',
    MINMAX_OWNER_UI_BASE_URL: 'http://server.example:3210',
    ...overrides,
  };
}

function config(overrides = {}) {
  return { ...loadConfig(environment()), ...overrides };
}

function mime(options = {}) {
  const boundary = 'fixture-boundary';
  const attachments = options.attachments ?? [{
    filename: options.filename || 'Отчёт МинМакс.xlsx',
    content: options.content || XLSX,
    encoding: options.encoding || 'base64',
  }];
  const subjectLines = options.subjectLines || [
    `Subject: ${options.subject || 'Еженедельный MinMax report'}`,
  ];
  const lines = [
    `From: ${options.from || 'Supplier <supplier@example.test>'}`,
    ...subjectLines,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    'body',
  ];
  for (const attachment of attachments) {
    const name = attachment.encodedFilename ||
      `=?UTF-8?B?${Buffer.from(attachment.filename).toString('base64')}?=`;
    lines.push(
      `--${boundary}`,
      'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      `Content-Disposition: attachment; filename="${name}"`,
      `Content-Transfer-Encoding: ${attachment.encoding}`,
      '',
      attachment.encoding === 'quoted-printable'
        ? [...attachment.content].map(byte => `=${byte.toString(16).padStart(2, '0')}`).join('')
        : attachment.content.toString('base64')
    );
  }
  lines.push(`--${boundary}--`, '');
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

function quotedPrintable(value) {
  return [...Buffer.from(value, 'utf8')].map(byte =>
    (byte >= 0x21 && byte <= 0x7e && byte !== 0x3d)
      ? String.fromCharCode(byte)
      : `=${byte.toString(16).padStart(2, '0').toUpperCase()}`
  ).join('');
}

function notificationMime(options = {}) {
  const runId = options.runId || 'e54dfafb-25ff-4575-88d4-940e50116bf3';
  const subject = options.subject || `${NOTIFICATION_SUBJECT_PREFIX} (${runId})`;
  const subjectValue = options.encodedSubject
    ? `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`
    : subject;
  const body = options.body || `Run: ${runId}`;
  const encoding = options.encoding || '8bit';
  const encodedBody = encoding === 'base64'
    ? Buffer.from(body).toString('base64').replace(/.{1,32}/g, '$&\r\n')
    : encoding === 'quoted-printable'
      ? quotedPrintable(body)
      : body;
  return Buffer.from([
    'From: Robot <robot@example.test>',
    `Subject: ${subjectValue}`,
    `Date: ${options.date || 'Sun, 02 Aug 2026 00:00:01 GMT'}`,
    'MIME-Version: 1.0',
    `Content-Type: ${options.contentType || 'text/plain'}; charset=utf-8`,
    `Content-Transfer-Encoding: ${encoding}`,
    '',
    encodedBody,
    '',
  ].join('\r\n'), 'utf8');
}

function inspectNotification(raw, overrides = {}) {
  return inspectNotificationMessage({
    uid: overrides.uid || '5909',
    raw,
    receivedAt: overrides.receivedAt || null,
  }, {
    runId: overrides.runId || 'e54dfafb-25ff-4575-88d4-940e50116bf3',
    subjectPrefix: NOTIFICATION_SUBJECT_PREFIX,
    e2eStartedAt: overrides.e2eStartedAt || '2026-08-02T00:00:00.500Z',
  });
}

function fakeResponse(status, body, headers = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(
    typeof body === 'string' ? body : JSON.stringify(body)
  );
  return {
    status,
    headers: new Headers(headers),
    async text() { return bytes.toString('utf8'); },
    async arrayBuffer() { return bytes; },
  };
}

test('config requires secrets and forbids accept-all filters', () => {
  assert.equal(loadConfig(environment()).imap.host, 'imap.yandex.ru');
  assert.throws(() => loadConfig(environment({ MINMAX_IMAP_PASSWORD: '' })),
    /MINMAX_IMAP_PASSWORD is required/);
  assert.throws(() => loadConfig(environment({ MINMAX_ALLOWED_SENDER: '*' })),
    /accept-all/);
  assert.throws(() => loadConfig(environment({ MINMAX_SUBJECT_PATTERN: '.*' })),
    /accept-all/);
});

test('MIME parses one base64 xlsx and Unicode filename', () => {
  const parsed = parseMimeMessage(mime());
  assert.equal(parsed.from, 'Supplier <supplier@example.test>');
  assert.equal(parsed.attachments.length, 1);
  assert.equal(parsed.attachments[0].filename, 'Отчёт МинМакс.xlsx');
  assert.deepEqual(parsed.attachments[0].content, XLSX);
});

test('MIME parses quoted-printable attachment content', () => {
  const parsed = parseMimeMessage(mime({ encoding: 'quoted-printable' }));
  assert.deepEqual(parsed.attachments[0].content, XLSX);
});

test('MIME normalizes display name, angle brackets and email case', () => {
  const parsed = parseMimeMessage(mime({
    from: 'Supplier Name <MAIL@Example.COM>',
  }));
  assert.equal(parsed.from, 'Supplier Name <MAIL@Example.COM>');
  assert.equal(parsed.sender, 'mail@example.com');
  assert.equal(normalizeEmailAddress('  MAIL@Example.COM  '), 'mail@example.com');
});

test('MIME decodes an encoded sender address', () => {
  const encodedAddress = `=?UTF-8?B?${Buffer.from('MAIL@Example.COM').toString('base64')}?=`;
  const parsed = parseMimeMessage(mime({ from: encodedAddress }));
  assert.equal(parsed.sender, 'mail@example.com');
});

test('MIME unfolds and decodes UTF-8 encoded Subject with stable spaces', () => {
  const first = `=?UTF-8?B?${Buffer.from('Еженедельный ').toString('base64')}?=`;
  const second = `=?UTF-8?B?${Buffer.from('MinMax отчёт').toString('base64')}?=`;
  const marker = 'minmax-direct-e2e-1720000000000-a1b2c3d4';
  const parsed = parseMimeMessage(mime({
    subjectLines: [`Subject: ${first}`, `\t${second}   ${marker}`],
  }));
  assert.equal(parsed.subject, `Еженедельный MinMax отчёт ${marker}`);
  assert.equal(parseMimeMessage(mime({
    subject: '  Прямой   UTF-8 отчёт  ',
  })).subject, 'Прямой UTF-8 отчёт');
  assert.equal(normalizeHeaderText('  Отчёт\t  MinMax  '), 'Отчёт MinMax');
});

test('notification correlation finds exact runId in plain text', () => {
  const evidence = inspectNotification(notificationMime());
  assert.equal(evidence.matches, true);
  assert.equal(evidence.uid, '5909');
  assert.deepEqual(evidence.contentTypes, ['text/plain']);
  assert.deepEqual(evidence.transferEncodings, ['8bit']);
});

test('notification correlation decodes a base64 body', () => {
  const evidence = inspectNotification(notificationMime({
    encoding: 'base64',
    subject: NOTIFICATION_SUBJECT_PREFIX,
  }));
  assert.equal(evidence.matches, true);
  assert.deepEqual(evidence.transferEncodings, ['base64']);
});

test('notification correlation decodes a quoted-printable body', () => {
  const evidence = inspectNotification(notificationMime({
    encoding: 'quoted-printable',
    subject: NOTIFICATION_SUBJECT_PREFIX,
  }));
  assert.equal(evidence.matches, true);
  assert.deepEqual(evidence.transferEncodings, ['quoted-printable']);
});

test('notification correlation finds runId only in decoded HTML', () => {
  const evidence = inspectNotification(notificationMime({
    contentType: 'text/html',
    subject: NOTIFICATION_SUBJECT_PREFIX,
    body: '<html><body><strong>Run:</strong> e54dfafb-25ff-4575-88d4-940e50116bf3</body></html>',
  }));
  assert.equal(evidence.matches, true);
  assert.deepEqual(evidence.contentTypes, ['text/html']);
});

test('notification correlation decodes the encoded-word Subject', () => {
  const evidence = inspectNotification(notificationMime({
    encodedSubject: true,
    encoding: 'base64',
  }));
  assert.equal(evidence.matches, true);
  assert.equal(
    evidence.subject,
    `${NOTIFICATION_SUBJECT_PREFIX} (e54dfafb-25ff-4575-88d4-940e50116bf3)`
  );
});

test('notification received before E2E start is ignored', () => {
  const evidence = inspectNotification(notificationMime({
    date: 'Sat, 01 Aug 2026 23:59:59 GMT',
  }));
  assert.equal(evidence.exactRunIdMatches, true);
  assert.equal(evidence.afterE2EStart, false);
  assert.equal(evidence.matches, false);
  assert.equal(imapInternalDate(Buffer.from(
    '* 1 FETCH (INTERNALDATE "02-Aug-2026 00:00:01 +0000")\r\n'
  )), '2026-08-02T00:00:01.000Z');
});

test('filter covers attachment count, sender, subject, size and signature', () => {
  const cfg = config({ maxAttachmentBytes: 20 });
  const good = parseMimeMessage(mime());
  assert.equal(evaluateMessage(good, cfg).outcome, 'process');
  assert.equal(evaluateMessage({ ...good, from: 'other@example.test' }, cfg).reasonCode,
    'SENDER_NOT_ALLOWED');
  assert.equal(evaluateMessage({ ...good, subject: 'other' }, cfg).reasonCode,
    'SUBJECT_MISMATCH');
  assert.equal(evaluateMessage({ ...good, attachments: [] }, cfg).reasonCode,
    'NO_ATTACHMENT');
  assert.equal(evaluateMessage({ ...good, attachments: [good.attachments[0], good.attachments[0]] }, cfg).reasonCode,
    'MULTIPLE_ATTACHMENTS');
  assert.equal(evaluateMessage({ ...good, attachments: [{ ...good.attachments[0], filename: 'bad.txt' }] }, cfg).reasonCode,
    'ATTACHMENT_TYPE_UNSUPPORTED');
  assert.equal(evaluateMessage({ ...good, attachments: [{ ...good.attachments[0], content: Buffer.alloc(21) }] }, cfg).reasonCode,
    'ATTACHMENT_TOO_LARGE');
  assert.equal(evaluateMessage({ ...good, attachments: [{ ...good.attachments[0], content: Buffer.from('not excel') }] }, cfg).reasonCode,
    'ATTACHMENT_SIGNATURE_INVALID');
});

test('production runner message marker passes filters while unrelated mail stays ignored', () => {
  const marker = 'minmax-direct-e2e-1720000000000-a1b2c3d4';
  const raw = Buffer.from(buildExcelMessage({
    marker,
    from: 'MAIL@Example.COM',
    to: 'intake@example.test',
    subject: marker,
    fileName: `${marker}.xlsx`,
    file: XLSX,
    date: '2026-08-02T00:00:00.000Z',
  }), 'utf8');
  const expected = { allowedSender: 'mail@example.com', subjectPattern: marker };
  const parsed = parseMimeMessage(raw);
  assert.equal(evaluateMessage(parsed, config(expected)).outcome, 'process');
  assert.deepEqual(verifyDeliveredMessage(raw, expected, marker), {
    normalizedSender: 'mail@example.com',
    expectedSender: 'mail@example.com',
    normalizedSubject: marker,
    expectedSubjectPattern: marker,
    markerPresent: true,
  });

  const unrelated = parseMimeMessage(mime({
    from: 'Other <other@example.test>',
    subject: 'Ordinary supplier update',
  }));
  const decision = evaluateMessage(unrelated, config(expected));
  assert.equal(decision.outcome, 'ignored');
  assert.deepEqual(decision.reasonCodes, ['SENDER_NOT_ALLOWED', 'SUBJECT_MISMATCH']);
  assert.deepEqual(filterDiagnostics(unrelated, config(expected)), {
    normalizedSender: 'other@example.test',
    expectedSender: 'mail@example.com',
    normalizedSubject: 'Ordinary supplier update',
    expectedSubjectPattern: marker,
    markerPresent: false,
    correlationMarker: null,
  });
});

test('UID correlation finds the E2E event after a later ignored event', () => {
  const state = {
    lastEvent: { messageUid: '5904', status: 'ignored' },
    recentEvents: [
      {
        messageUid: '5903',
        correlationMarker: 'minmax-direct-e2e-1720000000000-a1b2c3d4',
        status: 'completed',
        eventId: 'e2e-event',
      },
      { messageUid: '5904', status: 'ignored', eventId: 'unrelated-event' },
    ],
  };
  assert.deepEqual(eventForMessageUid(state, '5903'), {
    messageUid: '5903',
    correlationMarker: 'minmax-direct-e2e-1720000000000-a1b2c3d4',
    status: 'completed',
    eventId: 'e2e-event',
  });
  assert.equal(eventForMessageUid(state, '5999'), null);
});

test('ignored worker event exposes safe normalized filter diagnostics', async () => {
  const harness = workerHarness();
  const event = await harness.worker.processFetchedMessage({
    uid: '5904',
    raw: mime({
      from: 'Unrelated <OTHER@Example.TEST>',
      subject: '  Ordinary   update  ',
    }),
  });
  assert.deepEqual({
    status: event.status,
    reasonCodes: event.reasonCodes,
    normalizedSender: event.normalizedSender,
    expectedSender: event.expectedSender,
    normalizedSubject: event.normalizedSubject,
    expectedSubjectPattern: event.expectedSubjectPattern,
    markerPresent: event.markerPresent,
  }, {
    status: 'ignored',
    reasonCodes: ['SENDER_NOT_ALLOWED', 'SUBJECT_MISMATCH'],
    normalizedSender: 'other@example.test',
    expectedSender: 'supplier@example.test',
    normalizedSubject: 'Ordinary update',
    expectedSubjectPattern: 'minmax report',
    markerPresent: false,
  });
  assert.equal(JSON.stringify(event).includes('password'), false);
  assert.equal(JSON.stringify(event).includes('api-token'), false);
});

function stageHarness() {
  let clock = 0;
  const logs = [];
  return {
    logs,
    options: {
      deadline: 100,
      now: () => clock,
      delay: async milliseconds => { clock += milliseconds; },
      intervalMs: 10,
      logger: {
        log(value) { logs.push(value); },
        warn(value) { logs.push(value); },
      },
    },
  };
}

test('ECONNRESET during IMAP correlation reconnects and passes', async () => {
  const harness = stageHarness();
  let searches = 0;
  const result = await waitForStage('correlate_e2e_mail', async () => {
    searches += 1;
    if (searches === 1) {
      const error = new Error('read ECONNRESET');
      error.code = 'ECONNRESET';
      throw error;
    }
    return { uid: '5906', marker: 'minmax-direct-e2e-marker' };
  }, harness.options);
  assert.equal(result.value.uid, '5906');
  assert.equal(result.retryCount, 1);
  assert.equal(searches, 2);
  assert.ok(harness.logs.some(line => line.includes('stage=correlate_e2e_mail')));
});

test('ECONNRESET after UID correlation still finds the exact service event', async () => {
  const harness = stageHarness();
  let requests = 0;
  const result = await waitForStage('wait_service_event', async () => {
    requests += 1;
    if (requests === 1) {
      const cause = new Error('TLS connection reset');
      cause.code = 'ECONNRESET';
      throw new TypeError('fetch failed', { cause });
    }
    return {
      messageUid: '5906',
      correlationMarker: 'minmax-direct-e2e-marker',
      eventId: 'minmax-event-5906',
    };
  }, harness.options);
  assert.equal(result.value.eventId, 'minmax-event-5906');
  assert.equal(result.retryCount, 1);
});

test('notification IMAP reset retries without creating a second run', async () => {
  const harness = stageHarness();
  const workerState = workerHarness();
  await workerState.worker.pollOnce();
  assert.equal(workerState.calls.upload, 1);
  let notificationSearches = 0;
  const result = await waitForStage('wait_notification', async () => {
    notificationSearches += 1;
    if (notificationSearches === 1) {
      const error = new Error('socket closed');
      error.code = 'EPIPE';
      throw error;
    }
    return { found: true, uid: '5907' };
  }, harness.options);
  assert.equal(result.value.found, true);
  assert.equal(result.retryCount, 1);
  assert.equal(workerState.calls.upload, 1);
});

test('transient network error does not restore filters before retry succeeds', async () => {
  const harness = stageHarness();
  let attempts = 0;
  let restores = 0;
  await withProductionRestore(async () => waitForStage('wait_service_event', async () => {
    attempts += 1;
    assert.equal(restores, 0);
    if (attempts === 1) {
      const error = new Error('read ECONNRESET');
      error.code = 'ECONNRESET';
      throw error;
    }
    return { eventId: 'event-1' };
  }, harness.options), async () => { restores += 1; });
  assert.equal(attempts, 2);
  assert.equal(restores, 1);
});

test('overall timeout restores production filters', async () => {
  const harness = stageHarness();
  let restores = 0;
  await assert.rejects(() => withProductionRestore(
    () => waitForStage('wait_run', async () => null, harness.options),
    async () => { restores += 1; }
  ), error => error.stage === 'wait_run' && error.code === 'E2E_STAGE_TIMEOUT');
  assert.equal(restores, 1);
});

test('terminal PASS restores production filters exactly once', async () => {
  let restores = 0;
  const result = await withProductionRestore(
    async () => ({ result: 'PASS' }),
    async () => { restores += 1; }
  );
  assert.equal(result.result, 'PASS');
  assert.equal(restores, 1);
  assert.equal(isTransientNetworkError(Object.assign(new Error('timed out'), {
    code: 'ETIMEDOUT',
  })), true);
});

test('idempotency key includes mailbox UID name size and full sha256', () => {
  const hash = crypto.createHash('sha256').update(XLSX).digest('hex');
  const key = buildIdempotencyKey({
    mailbox: 'INBOX', messageUid: '42', attachmentName: 'report.xlsx',
    attachmentSize: XLSX.length, sha256: hash,
  });
  assert.match(key, /^minmax-INBOX-42-report\.xlsx-/);
  assert.ok(key.endsWith(hash));
  assert.ok(key.length <= 512);
});

test('IMAP parsers handle duplicate UID and exact FETCH literal', () => {
  assert.deepEqual(parseSearch(Buffer.from('* SEARCH 7 7 9\r\nA003 OK\r\n')), ['7', '9']);
  const raw = mime();
  const response = Buffer.concat([
    Buffer.from(`* 1 FETCH (UID 7 BODY[] {${raw.length}}\r\n`, 'latin1'),
    raw,
    Buffer.from('\r\n)\r\nA004 OK\r\n', 'latin1'),
  ]);
  const fetched = extractFetchedMessage(response, '7');
  assert.equal(fetched.uid, '7');
  assert.deepEqual(fetched.raw, raw);
  assert.throws(() => extractFetchedMessage(Buffer.from('* BAD\r\n'), '7'),
    /did not contain a literal/);
});

test('IMAP client performs login select search fetch and logout', async () => {
  const raw = mime();
  const commands = [];
  const socket = new EventEmitter();
  socket.destroy = () => {};
  const client = new ImapClient({
    user: 'user', password: 'pass', mailbox: 'INBOX', recentWindowHours: 48,
    maxMessages: 10,
  }, {
    connect: async () => socket,
    readUntil: async () => Buffer.from('* OK ready\r\n'),
    command: async (_socket, tag, value) => {
      commands.push([tag, value]);
      if (value.startsWith('UID SEARCH')) return Buffer.from('* SEARCH 12\r\nA003 OK\r\n');
      if (value.startsWith('UID FETCH')) return Buffer.concat([
        Buffer.from(`* 1 FETCH (UID 12 BODY[] {${raw.length}}\r\n`), raw,
        Buffer.from(`\r\n)\r\n${tag} OK\r\n`),
      ]);
      return Buffer.from(`${tag} OK\r\n`);
    },
  });
  const result = await client.fetchRecent();
  assert.equal(result[0].uid, '12');
  assert.deepEqual(commands.map(item => item[1].split(' ')[0]),
    ['LOGIN', 'SELECT', 'UID', 'UID', 'LOGOUT']);
  assert.match(sinceDate(48, Date.UTC(2026, 7, 2)), /31-Jul-2026/);
});

test('IMAP timeout and malformed greeting are surfaced', async () => {
  const base = {
    user: 'user', password: 'pass', mailbox: 'INBOX', recentWindowHours: 48,
    maxMessages: 10,
  };
  const timeout = new ImapClient(base, {
    connect: async () => { throw new Error('IMAP timeout'); },
  });
  await assert.rejects(() => timeout.fetchRecent(), /timeout/);
  const socket = new EventEmitter();
  socket.destroy = () => {};
  const malformed = new ImapClient(base, {
    connect: async () => socket,
    readUntil: async () => Buffer.from('* BAD greeting\r\n'),
  });
  await assert.rejects(() => malformed.fetchRecent(), /greeting is malformed/);
});

test('Purchasing client accepts 201 and 200 replay', async () => {
  for (const [status, replay] of [[201, false], [200, true]]) {
    const client = new PurchasingClient({
      baseUrl: 'http://backend', apiToken: 'token', retryAttempts: 1,
      requestTimeoutMs: 1000, pollTimeoutMs: 1000, pollIntervalMs: 1,
    }, {
      fetch: async () => fakeResponse(status, {
        data: { run_id: 'run-1', status: 'completed', idempotent_replay: replay },
      }),
    });
    const result = await client.upload({
      content: XLSX, contentType: 'application/xlsx', filename: 'report.xlsx',
      idempotencyKey: 'minmax-key', mailbox: 'INBOX', messageUid: '1',
    });
    assert.equal(result.replay, replay);
  }
});

test('Purchasing client handles 401, 409 and retries 5xx/network', async () => {
  for (const status of [401, 409]) {
    const client = new PurchasingClient({
      baseUrl: 'http://backend', apiToken: 'token', retryAttempts: 1,
      requestTimeoutMs: 1000,
    }, { fetch: async () => fakeResponse(status, { error: { code: 'FAIL' } }) });
    await assert.rejects(() => client.upload({
      content: XLSX, contentType: 'x', filename: 'r.xlsx',
      idempotencyKey: 'minmax-key', mailbox: 'INBOX', messageUid: '1',
    }), PurchasingHttpError);
  }
  let calls = 0;
  const retryClient = new PurchasingClient({
    baseUrl: 'http://backend', apiToken: 'token', retryAttempts: 3,
    requestTimeoutMs: 1000,
  }, {
    delay: async () => {},
    fetch: async () => {
      calls += 1;
      if (calls === 1) throw new Error('connection refused');
      if (calls === 2) return fakeResponse(503, 'unavailable');
      return fakeResponse(200, { data: { state: 'completed' } });
    },
  });
  assert.equal((await retryClient.registryRecord('minmax-key')).state, 'completed');
  assert.equal(calls, 3);
});

test('run polling handles completed, failed and timeout', async () => {
  const client = new PurchasingClient({
    baseUrl: 'http://backend', apiToken: 'token', retryAttempts: 1,
    requestTimeoutMs: 1000, pollTimeoutMs: 100, pollIntervalMs: 1,
  }, { fetch: async () => fakeResponse(200, { data: { status: 'completed' } }) });
  assert.equal((await client.waitForRun('run')).status, 'completed');
  client.fetch = async () => fakeResponse(200, { data: { status: 'failed' } });
  await assert.rejects(() => client.waitForRun('run'), /failed/);
  client.config.pollTimeoutMs = 0;
  await assert.rejects(() => client.waitForRun('run'), /timed out/);
});

test('artifact SHA mismatch is rejected', async () => {
  const client = new PurchasingClient({
    baseUrl: 'http://backend', apiToken: 'token', retryAttempts: 1,
    requestTimeoutMs: 1000,
  }, { fetch: async () => fakeResponse(200, { data: { artifacts: [
    { name: 'source-report.xlsx', sha256: '0'.repeat(64) },
  ] } }) });
  await assert.rejects(() => client.verifySourceArtifact('run', '1'.repeat(64)),
    /SHA mismatch/);
});

test('SMTP wrapper covers success, auth failure and timeout', async () => {
  const mailer = new NotificationMailer({}, { send: async () => ({ accepted: true }) });
  assert.equal((await mailer.sendCompleted({
    runId: 'run', filename: 'report.xlsx', summary: {},
    ownerReviewUrl: 'http://owner/?runId=run',
  })).accepted, true);
  const auth = new NotificationMailer({}, { send: async () => {
    const error = new Error('SMTP 535'); error.code = 'SMTP_COMMAND_FAILED'; throw error;
  } });
  await assert.rejects(() => auth.sendCompleted({ runId: 'run', summary: {} }), /535/);
  const timeout = new NotificationMailer({}, { send: async () => {
    throw new Error('SMTP timeout');
  } });
  await assert.rejects(() => timeout.sendCompleted({ runId: 'run', summary: {} }), /timeout/);
});

function workerHarness(overrides = {}) {
  const cfg = config();
  const state = {
    imapConnected: false, lastPollAt: null, lastProcessedUid: null,
    lastSuccessfulRunId: null, lastError: null, lastEvent: null, eventCount: 0,
  };
  const calls = { upload: 0, notification: 0, marker: 0 };
  let record = overrides.record || null;
  const purchasingClient = {
    async registryRecord() { return record; },
    async upload() { calls.upload += 1; return { runId: 'run-1', replay: false }; },
    async waitForRun() { return { status: 'completed' }; },
    async verifySourceArtifact(_runId, expected) {
      return { name: 'source-report.xlsx', downloadedSha256: expected };
    },
    async runSummary() { return { warnings: [] }; },
    async markNotification() { calls.marker += 1; record = { ...(record || {}), notification_sent_at: new Date().toISOString() }; },
    async registerFiltered() {},
  };
  const worker = new MinmaxMailWorker({
    config: cfg,
    state,
    imapClient: overrides.imapClient || { async fetchRecent() { return [{ uid: '42', raw: mime() }]; } },
    purchasingClient,
    mailer: { async sendCompleted() { calls.notification += 1; } },
    logger: { log() {}, warn() {}, error() {} },
  });
  return { calls, purchasingClient, state, worker };
}

test('worker creates one run, sends notification and emits Owner Review URL', async () => {
  const harness = workerHarness();
  const [event] = await harness.worker.pollOnce();
  assert.equal(event.status, 'completed');
  assert.equal(event.runId, 'run-1');
  assert.equal(harness.calls.upload, 1);
  assert.equal(harness.calls.notification, 1);
  assert.equal(harness.calls.marker, 1);
  assert.equal(event.ownerReviewUrl, 'http://server.example:3210/?runId=run-1');
});

test('worker replay and restart suppress duplicate run and notification', async () => {
  const hash = crypto.createHash('sha256').update(XLSX).digest('hex');
  const record = {
    run_id: 'run-existing',
    notification_sent_at: '2026-08-02T00:00:00.000Z',
    sha256: hash,
  };
  const first = workerHarness({ record });
  const [event] = await first.worker.pollOnce();
  assert.equal(event.replay, true);
  assert.equal(first.calls.upload, 0);
  assert.equal(first.calls.notification, 0);
  const restarted = workerHarness({ record });
  const [restartEvent] = await restarted.worker.pollOnce();
  assert.equal(restartEvent.runId, 'run-existing');
  assert.equal(restartEvent.eventId, event.eventId);
  assert.equal(restarted.calls.upload, 0);
});

test('SMTP failure retries notification without creating another run', async () => {
  const cfg = config();
  const state = {
    imapConnected: false, lastPollAt: null, lastProcessedUid: null,
    lastSuccessfulRunId: null, lastError: null, lastEvent: null, eventCount: 0,
  };
  let record = null;
  let uploads = 0;
  let sends = 0;
  const worker = new MinmaxMailWorker({
    config: cfg,
    state,
    imapClient: { async fetchRecent() { return []; } },
    purchasingClient: {
      async registryRecord() { return record; },
      async upload() {
        uploads += 1;
        record = { run_id: 'run-1', notification_sent_at: null };
        return { runId: 'run-1', replay: false };
      },
      async waitForRun() { return { status: 'completed' }; },
      async verifySourceArtifact(_runId, expected) {
        return { downloadedSha256: expected };
      },
      async runSummary() { return { warnings: [] }; },
      async markNotification() {
        record.notification_sent_at = new Date().toISOString();
      },
    },
    mailer: { async sendCompleted() {
      sends += 1;
      if (sends === 1) throw new Error('SMTP timeout');
    } },
    logger: { log() {}, warn() {}, error() {} },
  });
  await assert.rejects(() => worker.processFetchedMessage({ uid: '42', raw: mime() }),
    /SMTP timeout/);
  assert.equal(worker.handledUids.has('42'), false);
  const event = await worker.processFetchedMessage({ uid: '42', raw: mime() });
  assert.equal(event.replay, true);
  assert.equal(uploads, 1);
  assert.equal(sends, 2);
  assert.ok(record.notification_sent_at);
  assert.equal(worker.handledUids.has('42'), true);
});

test('worker deduplicates duplicate UID in one poll and reconnects after failure', async () => {
  let polls = 0;
  const harness = workerHarness({
    imapClient: { async fetchRecent() {
      polls += 1;
      if (polls === 1) throw new Error('timeout');
      return [{ uid: '42', raw: mime() }, { uid: '42', raw: mime() }];
    } },
  });
  await assert.rejects(() => harness.worker.pollOnce(), /timeout/);
  const events = await harness.worker.pollOnce();
  assert.equal(events.length, 1);
  assert.equal(harness.calls.upload, 1);
});

test('worker graceful shutdown interrupts reconnect and poll waits', async () => {
  const harness = workerHarness({
    imapClient: { async fetchRecent() { return []; } },
  });
  harness.worker.delay = () => new Promise(() => {});
  const running = harness.worker.run();
  await new Promise(resolve => setImmediate(resolve));
  harness.worker.stop();
  await running;
  assert.equal(harness.worker.running, false);
});

test('Docker definition has restart, localhost-only health port and no inline Node execution', () => {
  const compose = fs.readFileSync(path.join(ROOT,
    'docker/minmax-direct-mail-intake/compose.yml'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(ROOT,
    'docker/minmax-direct-mail-intake/Dockerfile'), 'utf8');
  assert.match(compose, /restart: unless-stopped/);
  assert.match(compose, /^\s+-\s+"127\.0\.0\.1:3220:3220"\s*$/m);
  assert.doesNotMatch(compose, /^\s+-\s+"3220:3220"\s*$/m);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.doesNotMatch(`${compose}\n${dockerfile}`, /node\s+-(?:e|\s)/);
  assert.doesNotMatch(compose, /data\/purchasing/);
});

test('health contract exposes safe service state and build SHA', () => {
  const payload = healthPayload(config(), {
    imapConnected: true,
    lastPollAt: '2026-08-02T00:00:00.000Z',
    lastProcessedUid: '42',
    lastSuccessfulRunId: 'run-1',
    lastError: null,
    eventCount: 1,
    lastEvent: { eventId: 'event-1' },
  });
  assert.equal(payload.status, 'ok');
  assert.equal(payload.service, 'minmax-direct-mail-intake');
  assert.equal(payload.build_sha, 'abcdef1');
  assert.equal(JSON.stringify(payload).includes('api-token'), false);
});

test('direct production-check validates E2E mailbox and one-command stages', () => {
  const env = environment({
    MINMAX_E2E_MAIL_USER: 'supplier@example.test',
    MINMAX_E2E_MAIL_PASSWORD: 'e2e-password',
  });
  assert.equal(productionConfig(env).e2e.user, 'supplier@example.test');
  assert.throws(() => productionConfig({ ...env, MINMAX_E2E_MAIL_USER: '' }),
    /MINMAX_E2E_MAIL_USER is required/);
  assert.equal(productionConfig({
    ...env,
    MINMAX_E2E_MAIL_USER: 'other@example.test',
  }).e2e.user, 'other@example.test');
  const packageJson = require('../../../package.json');
  assert.equal(
    packageJson.scripts['arthur:minmax:direct:production-check'],
    'node scripts/arthur/minmax-direct-production-check.js'
  );
  const source = fs.readFileSync(path.join(ROOT,
    'scripts/arthur/minmax-direct-production-check.js'), 'utf8');
  for (const stage of [
    'docker', 'sendExcelMail', 'waitForEvent', 'waitForMailboxText',
    'verifyOwnerReview', "run('npm', ['test']", "run('docker', ['restart'",
    'production intake filters restored after E2E',
    'correlate_e2e_mail', 'wait_service_event', 'wait_run',
    'wait_notification', 'owner_review_fetch', 'replay',
  ]) assert.ok(source.includes(stage), `missing production stage ${stage}`);
  assert.doesNotMatch(source, /node\s+-(?:e|\s)/);
  assert.match(source, /shell: false/);
  assert.equal(
    redact('failure api-token smtp-password', env),
    'failure [REDACTED] [REDACTED]'
  );
});
