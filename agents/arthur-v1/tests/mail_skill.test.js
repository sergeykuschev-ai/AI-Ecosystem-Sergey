'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createArthurV1 } = require('../index');
const { UnsupportedOperationError } = require('../errors/arthur_errors');
const { createSynthesizer } = require('../orchestrator/synthesizer');
const { createMailboxRegistry, DEFAULT_MAILBOXES } = require('../skills/mail/mailbox_registry');
const {
  DEFAULT_MAX_SNIPPET_LENGTH,
  normalizeMailMessage,
} = require('../skills/mail/message_normalizer');
const {
  CAPABILITIES,
  MAX_RESPONSE_LENGTH,
  createMailSkill,
} = require('../skills/mail/mail_skill');
const { createFakeGmailAdapter } = require('../skills/mail/providers/fake_gmail_adapter');
const { createFakeYandexAdapter } = require('../skills/mail/providers/fake_yandex_adapter');

const FIXED_NOW = new Date('2026-08-15T04:00:00.000Z');
const SILENT_LOGGER = Object.freeze({
  info() {},
  warn() {},
  error() {},
  debug() {},
});

function gmailMessage(overrides = {}) {
  return {
    messageId: 'gmail-message-1',
    threadId: 'gmail-thread-1',
    from: [{ name: 'Личный контакт', address: 'contact@personal.example' }],
    to: [{ name: 'Сергей', address: 'sergey@personal.example' }],
    subject: 'Личное напоминание',
    receivedAt: '2026-08-15T02:00:00+00:00',
    snippet: 'Короткий фрагмент личного письма.',
    isUnread: true,
    labels: ['INBOX', 'UNREAD'],
    folder: 'INBOX',
    sourceRef: 'gmail:message:gmail-message-1',
    ...overrides,
  };
}

function yandexMessage(overrides = {}) {
  return {
    messageId: 'INBOX:42:1001',
    threadId: null,
    from: [{ name: 'Валта', address: 'orders@valta.example' }],
    to: [{ name: 'Миска', address: 'mail@miska.example' }],
    subject: 'Новый прайс',
    receivedAt: '2026-08-15T03:42:00+00:00',
    snippet: 'Обновлённый прайс доступен для проверки.',
    isUnread: true,
    labels: [],
    folder: 'INBOX',
    sourceRef: 'yandex:INBOX:42:1001',
    ...overrides,
  };
}

function createTestMail(options = {}) {
  const gmail = options.gmail || createFakeGmailAdapter({
    messages: options.gmailMessages || [gmailMessage()],
  });
  const yandex = options.yandex || createFakeYandexAdapter({
    messages: options.yandexMessages || [yandexMessage()],
  });
  const mailboxRegistry = options.mailboxRegistry || createMailboxRegistry();
  const skill = createMailSkill({
    mailboxRegistry,
    adapters: { gmail, yandex },
    clock: () => FIXED_NOW,
  });
  return { gmail, mailboxRegistry, skill, yandex };
}

test('mailbox registry returns the two Stage 1 mailboxes without provider credentials', () => {
  const registry = createMailboxRegistry();
  assert.deepEqual(registry.list(), DEFAULT_MAILBOXES.map(mailbox => ({ ...mailbox })));
  for (const mailbox of registry.list()) {
    assert.deepEqual(Object.keys(mailbox), [
      'mailboxId',
      'provider',
      'accountType',
      'businessContext',
      'displayName',
    ]);
  }
});

test('mailbox registry selects Miska context and an explicit mailbox ID', () => {
  const registry = createMailboxRegistry();
  assert.deepEqual(registry.select({ businessContext: 'miska' }).map(item => item.mailboxId), [
    'miska-yandex',
  ]);
  assert.deepEqual(registry.select({ mailboxId: 'personal-gmail' }).map(item => item.mailboxId), [
    'personal-gmail',
  ]);
});

test('Gmail and Yandex candidates normalize to the same public message contract', () => {
  const registry = createMailboxRegistry();
  const gmail = normalizeMailMessage(gmailMessage({ raw: { provider: 'gmail' } }), registry.get('personal-gmail'));
  const yandex = normalizeMailMessage(yandexMessage({ raw: { provider: 'yandex' } }), registry.get('miska-yandex'));
  const expectedKeys = [
    'messageId',
    'threadId',
    'mailboxId',
    'provider',
    'from',
    'to',
    'subject',
    'receivedAt',
    'snippet',
    'isUnread',
    'labels',
    'folder',
    'sourceRef',
  ];

  assert.deepEqual(Object.keys(gmail), expectedKeys);
  assert.deepEqual(Object.keys(yandex), expectedKeys);
  assert.equal(gmail.receivedAt, '2026-08-15T02:00:00.000Z');
  assert.equal(yandex.receivedAt, '2026-08-15T03:42:00.000Z');
  assert.equal(yandex.threadId, null);
  assert.equal(gmail.raw, undefined);
  assert.equal(yandex.raw, undefined);
});

test('message normalization bounds snippets and allows null threadId', () => {
  const registry = createMailboxRegistry();
  const normalized = normalizeMailMessage(yandexMessage({
    threadId: null,
    snippet: 'x'.repeat(DEFAULT_MAX_SNIPPET_LENGTH + 100),
  }), registry.get('miska-yandex'));

  assert.equal(normalized.snippet.length, DEFAULT_MAX_SNIPPET_LENGTH);
  assert.equal(normalized.snippet.endsWith('…'), true);
  assert.equal(normalized.threadId, null);
});

test('businessContext=miska reads only the Yandex mailbox', async () => {
  const { gmail, skill, yandex } = createTestMail();
  const result = await skill.execute({
    operation: 'listUnreadMail',
    parameters: { businessContext: 'miska' },
  });

  assert.equal(gmail.calls.length, 0);
  assert.equal(yandex.calls.length, 1);
  assert.equal(result.data.count, 1);
  assert.equal(result.data.messages[0].mailboxId, 'miska-yandex');
  assert.match(result.data.responseText, /^Непрочитанные письма по Миске: 1/);
  assert.doesNotMatch(result.data.responseText, /miska-yandex|INBOX:42:1001/);
});

test('mailboxId reads only the selected mailbox', async () => {
  const { gmail, skill, yandex } = createTestMail();
  const result = await skill.execute({
    operation: 'listUnreadMail',
    parameters: { mailboxId: 'personal-gmail' },
  });

  assert.equal(gmail.calls.length, 1);
  assert.equal(yandex.calls.length, 0);
  assert.equal(result.data.messages[0].mailboxId, 'personal-gmail');
});

test('unfiltered read merges both mailboxes and sorts receivedAt descending', async () => {
  const { gmail, skill, yandex } = createTestMail();
  const result = await skill.execute({ operation: 'listUnreadMail', parameters: {} });

  assert.equal(gmail.calls.length, 1);
  assert.equal(yandex.calls.length, 1);
  assert.deepEqual(result.data.messages.map(message => message.mailboxId), [
    'miska-yandex',
    'personal-gmail',
  ]);
  assert.match(result.data.responseText, /Почта Миски/);
  assert.match(result.data.responseText, /Личная почта/);
});

test('global result limit is bounded and applied after merge', async () => {
  const { skill } = createTestMail({
    gmailMessages: [
      gmailMessage({ messageId: 'g1', sourceRef: 'gmail:g1', receivedAt: '2026-08-15T01:00:00Z' }),
      gmailMessage({ messageId: 'g2', sourceRef: 'gmail:g2', receivedAt: '2026-08-15T04:00:00Z' }),
    ],
    yandexMessages: [
      yandexMessage({ messageId: 'y1', sourceRef: 'yandex:y1', receivedAt: '2026-08-15T03:00:00Z' }),
    ],
  });
  const result = await skill.execute({
    operation: 'listUnreadMail',
    parameters: { limit: 2 },
  });

  assert.deepEqual(result.data.messages.map(message => message.messageId), ['g2', 'y1']);
  await assert.rejects(
    () => skill.execute({ operation: 'listUnreadMail', parameters: { limit: 21 } }),
    /between 1 and 20/
  );
});

test('deterministic response is bounded independently of provider text size', async () => {
  const { skill } = createTestMail({
    gmailMessages: Array.from({ length: 20 }, (_, index) => gmailMessage({
      messageId: `g-${index}`,
      sourceRef: `gmail:g-${index}`,
      from: [{ name: `Отправитель ${'x'.repeat(500)}`, address: null }],
      subject: `Тема ${'y'.repeat(500)}`,
      receivedAt: new Date(FIXED_NOW.getTime() - index * 60000).toISOString(),
    })),
    yandexMessages: [],
  });
  const result = await skill.execute({
    operation: 'listUnreadMail',
    parameters: { mailboxId: 'personal-gmail', limit: 20 },
  });

  assert.ok(result.data.responseText.length <= MAX_RESPONSE_LENGTH);
  assert.equal(result.data.responseText.endsWith('…'), true);
});

test('provider failure returns available mailbox results and a bounded warning', async () => {
  const gmail = createFakeGmailAdapter({ error: Object.assign(new Error('token=secret raw body'), {
    code: 'FAKE_GMAIL_DOWN',
  }) });
  const { skill } = createTestMail({ gmail });
  const result = await skill.execute({ operation: 'listUnreadMail', parameters: {} });

  assert.equal(result.status, 'success');
  assert.equal(result.data.status, 'available');
  assert.equal(result.data.count, 1);
  assert.equal(result.data.messages[0].provider, 'yandex');
  assert.deepEqual(result.data.warnings, [{
    mailboxId: 'personal-gmail',
    displayName: 'Личная почта',
    provider: 'gmail',
    code: 'FAKE_GMAIL_DOWN',
  }]);
  assert.equal(result.metadata.degraded, true);
  assert.match(result.data.responseText, /Не удалось проверить: Личная почта\./);
  assert.doesNotMatch(result.data.responseText, /secret|raw body|token=/);
});

test('MailSkill exposes only listUnreadMail and no write operations', async () => {
  const { skill } = createTestMail();
  assert.deepEqual(CAPABILITIES, [{ id: 'listUnreadMail', readOnly: true }]);
  assert.deepEqual(skill.capabilities, [{ id: 'listUnreadMail', readOnly: true }]);
  assert.equal(skill.readOnly, true);
  for (const operation of ['send', 'reply', 'delete', 'archive', 'move', 'markRead']) {
    assert.equal(skill.capabilities.some(capability => capability.id === operation), false);
    await assert.rejects(
      () => skill.execute({ operation, parameters: {} }),
      UnsupportedOperationError
    );
  }
});

test('MailSkill output excludes provider raw payload, body, HTML, attachments and tokens', async () => {
  const { skill } = createTestMail({
    gmailMessages: [gmailMessage({
      body: 'full body',
      html: '<p>full body</p>',
      attachments: [{ filename: 'secret.pdf' }],
      token: 'secret-token',
      raw: { headers: 'raw headers' },
    })],
  });
  const result = await skill.execute({
    operation: 'listUnreadMail',
    parameters: { mailboxId: 'personal-gmail' },
  });
  const serialized = JSON.stringify(result);

  assert.doesNotMatch(serialized, /full body|secret\.pdf|secret-token|raw headers/);
  assert.doesNotMatch(result.data.responseText, /gmail-message-1|contact@personal\.example/);
});

test('mail-enabled Arthur returns a deterministic bounded Telegram response without AI synthesis', async () => {
  const { skill } = createTestMail();
  let synthesized = false;
  const arthur = createArthurV1({
    mailSkill: skill,
    knowledgeDirectories: [],
    logger: SILENT_LOGGER,
    aiProvider: {
      async generate() {
        throw new Error('AI must not plan a deterministic mail request');
      },
      async synthesize() {
        synthesized = true;
        throw new Error('AI must not synthesize a deterministic mail response');
      },
      async health() {
        return { healthy: true, provider: 'test' };
      },
    },
  });

  const response = await arthur.handle({
    message: 'Покажи непрочитанные письма по Миске',
    userId: 'sergey',
    channel: 'telegram',
  });

  assert.equal(response.status, 'success');
  assert.deepEqual(response.modulesUsed, ['mail']);
  assert.match(response.answer.text, /Непрочитанные письма по Миске: 1/);
  assert.match(response.answer.text, /Валта/);
  assert.match(response.answer.text, /Новый прайс/);
  assert.equal(synthesized, false);
});

test('Arthur keeps the available mailbox when the other fake provider fails', async () => {
  const gmail = createFakeGmailAdapter({ error: Object.assign(new Error('offline'), {
    code: 'FAKE_GMAIL_DOWN',
  }) });
  const { skill } = createTestMail({ gmail });
  const arthur = createArthurV1({
    mailSkill: skill,
    knowledgeDirectories: [],
    logger: SILENT_LOGGER,
  });

  const response = await arthur.handle({
    message: 'Есть непрочитанные письма?',
    userId: 'sergey',
    channel: 'telegram',
  });

  assert.equal(response.status, 'success');
  assert.deepEqual(response.modulesUsed, ['mail']);
  assert.match(response.answer.text, /Валта/);
  assert.match(response.answer.text, /Не удалось проверить: Личная почта\./);
});

test('production composition does not register fake MailSkill without explicit injection', async () => {
  const arthur = createArthurV1({ knowledgeDirectories: [] });
  const diagnostics = await arthur.getDiagnostics();
  assert.equal(diagnostics.skills.includes('mail'), false);
});

test('multi-skill synthesis never sends mail messages, addresses or snippets to AI', async () => {
  let capturedInput;
  const synthesizer = createSynthesizer({
    aiProvider: {
      async synthesize(input) {
        capturedInput = input;
        return { text: 'Безопасный ответ', confidence: 'high' };
      },
    },
    skills: [],
  });
  await synthesizer.synthesize({
    message: 'Покажи почту и закупки',
    intent: 'combined',
    context: { userId: 'sergey', channel: 'telegram' },
  }, {
    status: 'success',
    stepResults: {
      mail: {
        status: 'success',
        skill: 'mail',
        operation: 'listUnreadMail',
        data: {
          status: 'available',
          summary: 'Непрочитанных писем получено: 1.',
          responseText: 'Непрочитанные письма: 1',
          count: 1,
          messages: [{
            from: [{ address: 'private@example.invalid' }],
            to: [{ address: 'owner@example.invalid' }],
            snippet: 'private snippet',
            raw: 'raw MIME',
          }],
          warnings: [],
        },
      },
      purchasing: {
        status: 'success',
        skill: 'purchasing',
        operation: 'getStatus',
        data: { summary: 'Закупки доступны.' },
      },
    },
  }, { entries: [] });

  const serialized = JSON.stringify(capturedInput);
  assert.match(serialized, /Непрочитанные письма: 1/);
  assert.doesNotMatch(serialized, /private@example|owner@example|private snippet|raw MIME|messages/);
});
