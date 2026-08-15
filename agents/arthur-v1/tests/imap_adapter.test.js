'use strict';

const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { test } = require('node:test');

const { loadYandexMailConfig } = require('../telegram/config');
const { createMailSkill } = require('../skills/mail/mail_skill');
const { createMailboxRegistry } = require('../skills/mail/mailbox_registry');
const { createYandexMailSkillFromConfig } = require('../skills/mail/mail_runtime');
const { createFakeGmailAdapter } = require('../skills/mail/providers/fake_gmail_adapter');
const {
  DEFAULT_MAX_MESSAGE_BYTES,
  createIMAPAdapter,
} = require('../skills/mail/providers/imap_adapter');

const USERNAME = 'mailbox@example.invalid';
const PASSWORD = 'test-app-password';

function messageHeaders(uid) {
  return Buffer.from([
    `From: Валта ${uid} <orders${uid}@valta.example>`,
    'To: Миска <mail@miska.example>',
    `Subject: Новый прайс ${uid}`,
    'Date: Sat, 15 Aug 2026 03:42:00 +0000',
    '',
    '',
  ].join('\r\n'));
}

function createFakeClient(options = {}) {
  const calls = [];
  const client = {
    calls,
    mailbox: null,
    async connect() {
      calls.push({ method: 'connect' });
      if (options.connectError) throw options.connectError;
    },
    async mailboxOpen(folder, openOptions) {
      calls.push({ method: 'mailboxOpen', folder, options: openOptions });
      this.mailbox = { uidValidity: options.uidValidity ?? 42n };
      return this.mailbox;
    },
    async search(query, searchOptions) {
      calls.push({ method: 'search', query, options: searchOptions });
      return options.unseenUids || [1001, 1002, 1003];
    },
    async fetchAll(uids, query, fetchOptions) {
      calls.push({ method: 'fetchAll', uids, query, options: fetchOptions });
      if (options.fetchResult !== undefined) return options.fetchResult;
      return uids.map(uid => ({
        uid,
        flags: new Set(),
        envelope: { date: new Date('2026-08-15T03:42:00.000Z') },
        internalDate: new Date('2026-08-15T03:42:00.000Z'),
        headers: messageHeaders(uid),
        bodyStructure: options.htmlOnly
          ? {
              part: 'root',
              type: 'multipart/mixed',
              childNodes: [
                { part: '1', type: 'text/html' },
                { part: '2', type: 'application/pdf', disposition: 'attachment' },
              ],
            }
          : {
              part: 'root',
              type: 'multipart/mixed',
              childNodes: [
                { part: '1', type: 'text/plain' },
                { part: '2', type: 'application/pdf', disposition: 'attachment' },
              ],
            },
      }));
    },
    async download(uid, part, downloadOptions) {
      calls.push({ method: 'download', uid, part, options: downloadOptions });
      const body = options.htmlOnly
        ? '<html><body><script>window.bad = true</script><p>Безопасный текст</p></body></html>'
        : `Короткий фрагмент письма ${uid}.`;
      return { content: Readable.from([Buffer.from(body)]) };
    },
    async logout() {
      calls.push({ method: 'logout' });
    },
    close() {
      calls.push({ method: 'close' });
    },
  };
  return client;
}

function createAdapter(client, overrides = {}) {
  let clientOptions;
  const adapter = createIMAPAdapter({
    provider: 'yandex',
    host: 'imap.yandex.ru',
    port: 993,
    secure: true,
    folder: 'INBOX',
    username: USERNAME,
    password: PASSWORD,
    clientFactory(options) {
      clientOptions = options;
      return client;
    },
    ...overrides,
  });
  return { adapter, getClientOptions: () => clientOptions };
}

test('IMAP adapter uses validated TLS, read-only INBOX and bounded unseen fetches', async () => {
  const client = createFakeClient();
  const { adapter, getClientOptions } = createAdapter(client);
  const messages = await adapter.listUnreadMail({ limit: 2 });
  const config = getClientOptions();

  assert.equal(config.host, 'imap.yandex.ru');
  assert.equal(config.port, 993);
  assert.equal(config.secure, true);
  assert.equal(config.tls.rejectUnauthorized, true);
  assert.equal(config.tls.minVersion, 'TLSv1.2');
  assert.equal(config.connectionTimeout, 10000);
  assert.equal(config.socketTimeout, 30000);
  assert.equal(config.disableAutoIdle, true);
  assert.equal(config.logger, false);
  assert.equal(config.logRaw, false);
  assert.equal(config.emitLogs, false);

  assert.deepEqual(client.calls.find(call => call.method === 'mailboxOpen'), {
    method: 'mailboxOpen',
    folder: 'INBOX',
    options: { readOnly: true },
  });
  assert.deepEqual(client.calls.find(call => call.method === 'search'), {
    method: 'search',
    query: { seen: false },
    options: { uid: true },
  });
  const fetchCall = client.calls.find(call => call.method === 'fetchAll');
  assert.deepEqual(fetchCall.uids, [1002, 1003]);
  assert.equal(fetchCall.query.source, undefined);
  assert.deepEqual(fetchCall.query.headers, ['from', 'to', 'subject', 'date']);
  assert.deepEqual(fetchCall.options, { uid: true });
  const downloads = client.calls.filter(call => call.method === 'download');
  assert.deepEqual(downloads.map(call => call.part), ['1', '1']);
  assert.ok(downloads.every(call => call.options.maxBytes === DEFAULT_MAX_MESSAGE_BYTES));

  assert.equal(messages.length, 2);
  assert.equal(messages[0].messageId, 'INBOX:42:1002');
  assert.equal(messages[0].sourceRef, 'imap:INBOX:42:1002');
  assert.equal(messages[0].threadId, null);
  assert.equal(messages[0].subject, 'Новый прайс 1002');
  assert.equal(messages[0].from[0].address, 'orders1002@valta.example');
  assert.equal(messages[0].to[0].address, 'mail@miska.example');
  assert.match(messages[0].snippet, /Короткий фрагмент письма 1002/);
  assert.equal(messages[0].isUnread, true);
});

test('HTML fallback is bounded and attachments, raw MIME and HTML stay private', async () => {
  const client = createFakeClient({ htmlOnly: true, unseenUids: [2001] });
  const { adapter } = createAdapter(client);
  const [message] = await adapter.listUnreadMail({ limit: 1 });
  const serialized = JSON.stringify(message);

  assert.match(message.snippet, /Безопасный текст/);
  assert.doesNotMatch(message.snippet, /<html|<script|window\.bad/);
  assert.deepEqual(client.calls.filter(call => call.method === 'download').map(call => call.part), ['1']);
  assert.doesNotMatch(serialized, /application\/pdf|attachments|raw|<html/);
});

test('IMAP adapter exposes no mutation or SMTP operations', () => {
  const { adapter } = createAdapter(createFakeClient());
  assert.deepEqual(Object.keys(adapter), ['provider', 'listUnreadMail']);
  for (const operation of [
    'store', 'expunge', 'move', 'copy', 'append', 'send', 'reply', 'markRead', 'createTransport',
  ]) {
    assert.equal(adapter[operation], undefined);
  }
});

for (const scenario of [
  { name: 'authentication', source: { code: 'AUTHENTICATIONFAILED' }, code: 'MAIL_AUTH_FAILED' },
  { name: 'timeout', source: { code: 'ETIMEDOUT' }, code: 'MAIL_TIMEOUT' },
  { name: 'TLS', source: { code: 'CERT_HAS_EXPIRED' }, code: 'MAIL_TLS_FAILED' },
  { name: 'DNS', source: { code: 'ENOTFOUND' }, code: 'MAIL_DNS_FAILED' },
]) {
  test(`${scenario.name} failure is classified without credential leakage`, async () => {
    const sourceError = Object.assign(
      new Error(`failed for ${USERNAME} with ${PASSWORD}`),
      scenario.source
    );
    const { adapter } = createAdapter(createFakeClient({ connectError: sourceError }));
    await assert.rejects(
      () => adapter.listUnreadMail({ limit: 1 }),
      error => {
        assert.equal(error.code, scenario.code);
        assert.doesNotMatch(error.message, new RegExp(`${USERNAME}|${PASSWORD}`));
        return true;
      }
    );
    assert.doesNotMatch(JSON.stringify(adapter), new RegExp(`${USERNAME}|${PASSWORD}`));
  });
}

test('malformed MIME parser failure is safe and does not expose parser details', async () => {
  const client = createFakeClient({ unseenUids: [3001] });
  const { adapter } = createAdapter(client, {
    async parseMessage() {
      throw new Error(`malformed raw body ${PASSWORD}`);
    },
  });
  await assert.rejects(
    () => adapter.listUnreadMail({ limit: 1 }),
    error => {
      assert.equal(error.code, 'MAIL_MESSAGE_PARSE_FAILED');
      assert.equal(error.message, 'Mail message could not be parsed.');
      assert.doesNotMatch(error.message, /raw body|test-app-password/);
      return true;
    }
  );
});

test('Yandex adapter failure degrades MailSkill without breaking another mailbox', async () => {
  const yandexClient = createFakeClient({
    connectError: Object.assign(new Error(`bad password ${PASSWORD}`), { code: 'EAUTH' }),
  });
  const { adapter: yandex } = createAdapter(yandexClient);
  const gmail = createFakeGmailAdapter({
    messages: [{
      messageId: 'gmail-1',
      threadId: null,
      from: [{ name: 'Контакт', address: 'contact@example.invalid' }],
      to: [],
      subject: 'Доступное письмо',
      receivedAt: '2026-08-15T03:00:00.000Z',
      snippet: 'Безопасный фрагмент.',
      isUnread: true,
      labels: [],
      folder: 'INBOX',
      sourceRef: 'gmail:gmail-1',
    }],
  });
  const skill = createMailSkill({
    mailboxRegistry: createMailboxRegistry(),
    adapters: { gmail, yandex },
    clock: () => new Date('2026-08-15T04:00:00.000Z'),
  });
  const result = await skill.execute({ operation: 'listUnreadMail', parameters: {} });

  assert.equal(result.status, 'success');
  assert.equal(result.data.status, 'available');
  assert.equal(result.data.count, 1);
  assert.deepEqual(result.data.warnings.map(item => item.code), ['MAIL_AUTH_FAILED']);
  assert.match(result.data.responseText, /Доступное письмо/);
  assert.doesNotMatch(JSON.stringify(result), /bad password|test-app-password/);
});

function configuredEnv(overrides = {}) {
  return {
    ARTHUR_MAILBOX_MISKA_YANDEX_ENABLED: 'true',
    ARTHUR_MAILBOX_MISKA_YANDEX_USERNAME_SECRET_FILE: '/run/secrets/username',
    ARTHUR_MAILBOX_MISKA_YANDEX_APP_PASSWORD_SECRET_FILE: '/run/secrets/password',
    ...overrides,
  };
}

function fakeSecretFileSystem(values) {
  return {
    statSync(filePath) {
      if (!(filePath in values)) throw new Error('missing');
      return { isFile: () => true };
    },
    readFileSync(filePath) {
      if (!(filePath in values)) throw new Error('missing');
      return values[filePath];
    },
  };
}

test('real Yandex MailSkill registers only when enabled and both secret files are available', async () => {
  let adapterOptions;
  const config = loadYandexMailConfig(configuredEnv());
  const skill = createYandexMailSkillFromConfig(config, {
    fileSystem: fakeSecretFileSystem({
      '/run/secrets/username': `${USERNAME}\n`,
      '/run/secrets/password': `${PASSWORD}\n`,
    }),
    createAdapter(options) {
      adapterOptions = options;
      return { async listUnreadMail() { return []; } };
    },
  });

  assert.equal(config.host, 'imap.yandex.ru');
  assert.equal(config.port, 993);
  assert.equal(config.tls, true);
  assert.equal(config.folder, 'INBOX');
  assert.equal(adapterOptions.username, USERNAME);
  assert.equal(adapterOptions.password, PASSWORD);
  assert.deepEqual(skill.capabilities, [{ id: 'listUnreadMail', readOnly: true }]);
  assert.equal(skill.readOnly, true);
  const result = await skill.execute({ operation: 'listUnreadMail', parameters: {} });
  assert.equal(result.data.count, 0);
});

test('disabled or incomplete Yandex config cannot register the real adapter', () => {
  let adapterCreated = false;
  const disabled = createYandexMailSkillFromConfig(loadYandexMailConfig({}), {
    createAdapter() {
      adapterCreated = true;
    },
  });
  assert.equal(disabled, null);
  assert.equal(adapterCreated, false);

  const enabled = loadYandexMailConfig(configuredEnv());
  assert.throws(
    () => createYandexMailSkillFromConfig(enabled, {
      fileSystem: fakeSecretFileSystem({ '/run/secrets/username': USERNAME }),
    }),
    error => error.code === 'MAIL_CONFIG_INVALID'
      && !error.message.includes(USERNAME)
      && !error.message.includes(PASSWORD)
  );
});
