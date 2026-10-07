'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadConfig } = require('../config');
const { MinmaxMailWorker, evaluateMessage } = require('../worker');

const XLS = Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  Buffer.from('fixture'),
]);

function cfg(overrides = {}) {
  const env = {
    MINMAX_BUILD_SHA: 'prod-test',
    MINMAX_ALLOWED_SENDER: 'rsk21vek.khv@yandex.ru',
    MINMAX_SUBJECT_PATTERN: 'валта заказывать по нему',
    MINMAX_ATTACHMENT_PREFIX: 'Отчет_Валта',
    MINMAX_START_AFTER_UID: '6385',
    MINMAX_IMAP_USER: 'mail@example.test',
    MINMAX_IMAP_PASSWORD: 'secret',
    MINMAX_SMTP_USER: 'mail@example.test',
    MINMAX_SMTP_PASSWORD: 'secret',
    MINMAX_SMTP_FROM: 'mail@example.test',
    MINMAX_NOTIFY_EMAIL: 'owner@example.test',
    MINMAX_PURCHASING_API_BASE_URL: 'http://host.docker.internal:3210',
    PURCHASING_API_TOKEN: 'token',
    MINMAX_OWNER_UI_BASE_URL: 'http://host.docker.internal:3210',
    ...overrides,
  };
  return loadConfig(env);
}

test('Valta production mail selects only Отчет_ attachment from two XLS files', () => {
  const message = {
    from: 'Заявки на поставки <rsk21vek.khv@yandex.ru>',
    sender: 'rsk21vek.khv@yandex.ru',
    subject: 'Валта заказывать по нему',
    attachments: [
      { filename: 'Отчет_Валта заказывать по нему_2026-10-07 06-00-51.xls', content: XLS, contentType: 'application/vnd.ms-excel' },
      { filename: 'КЗаказу_Валта заказывать по нему_2026-10-07 06-00-52.xls', content: XLS, contentType: 'application/vnd.ms-excel' },
    ],
  };
  const decision = evaluateMessage(message, cfg());
  assert.equal(decision.outcome, 'process');
  assert.match(decision.attachment.filename, /^Отчет_Валта/);
});

test('Zoograd production mail selects only Отчет_ attachment', () => {
  const message = {
    from: 'Заявки на поставки <rsk21vek.khv@yandex.ru>',
    sender: 'rsk21vek.khv@yandex.ru',
    subject: 'Оникиенко Зооград',
    attachments: [
      { filename: 'Отчет_Оникиенко Зооград_2026-10-07 08-00-37.xls', content: XLS, contentType: 'application/vnd.ms-excel' },
      { filename: 'КЗаказу_Оникиенко Зооград_2026-10-07 08-00-37.xls', content: XLS, contentType: 'application/vnd.ms-excel' },
    ],
  };
  const decision = evaluateMessage(message, cfg({
    MINMAX_SUBJECT_PATTERN: 'Оникиенко Зооград',
    MINMAX_ATTACHMENT_PREFIX: 'Отчет_Оникиенко Зооград',
  }));
  assert.equal(decision.outcome, 'process');
  assert.match(decision.attachment.filename, /^Отчет_Оникиенко Зооград/);
});

test('startAfterUid prevents replay of historical mail', async () => {
  const state = { recentEvents: [], eventCount: 0 };
  const worker = new MinmaxMailWorker({
    config: cfg(),
    state,
    imapClient: { async fetchRecent() { return []; } },
    purchasingClient: {
      async registryRecord() { throw new Error('must not be called'); },
    },
    mailer: {},
    logger: { log() {}, warn() {}, error() {} },
    parseMime: () => { throw new Error('must not parse skipped uid'); },
  });
  const event = await worker.processFetchedMessage({ uid: '6385', raw: Buffer.from('raw') });
  assert.equal(event.status, 'ignored');
  assert.equal(event.reasonCode, 'BEFORE_START_UID');
});
