'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  analyzeImportantMail,
  groupRepeatedMessages,
  scoreMailMessage,
} = require('../skills/mail/mail_analysis');
const {
  DEFAULT_SENDER_ALIASES,
  createSenderAliasRegistry,
} = require('../skills/mail/sender_alias_registry');

const NOW = new Date('2026-08-15T04:00:00.000Z');

function message(overrides = {}) {
  return {
    messageId: 'message-1',
    from: [{ name: 'Неизвестный отправитель', address: null }],
    subject: 'Обычное уведомление',
    receivedAt: '2026-08-15T03:00:00.000Z',
    isUnread: true,
    ...overrides,
  };
}

test('default supplier aliases contain text names but no invented email addresses', () => {
  assert.deepEqual(DEFAULT_SENDER_ALIASES.map(entry => entry.displayName), [
    'Валта',
    'Premium Pet',
    'Зооград',
    'Оникиенко',
  ]);
  assert.ok(DEFAULT_SENDER_ALIASES.every(entry => entry.addresses.length === 0));
});

test('configured confirmed sender address matches exactly', () => {
  const registry = createSenderAliasRegistry([{
    aliasId: 'valta',
    displayName: 'Валта',
    businessContext: 'miska',
    aliases: ['Валта'],
    addresses: ['confirmed@valta.example'],
  }]);
  const resolution = registry.resolve('confirmed@valta.example');

  assert.equal(resolution.known, true);
  assert.equal(registry.matchMessage(message({
    from: [{ name: 'Неважно', address: 'confirmed@valta.example' }],
  }), resolution), true);
  assert.equal(registry.matchMessage(message({
    from: [{ name: 'Неважно', address: 'other@valta.example' }],
  }), resolution), false);
});

test('known company alias can match Subject only when subject fallback is explicitly enabled', () => {
  const registry = createSenderAliasRegistry();
  const resolution = registry.resolve('Валта');
  const valtaSubject = message({
    from: [{ name: 'Анна Размовенко', address: null }],
    subject: 'Валта прайс 14.08.26 общ.xlsx, ПРОМО...',
    receivedAt: '2026-08-14T00:32:20.000Z',
  });
  const unrelatedSubject = message({
    from: [{ name: 'Анна Размовенко', address: null }],
    subject: 'Обновлённый прайс 14.08.26',
    receivedAt: '2026-08-14T00:32:20.000Z',
  });

  assert.equal(registry.matchMessage(valtaSubject, resolution), false);
  assert.equal(registry.matchMessage(valtaSubject, resolution, { allowSubjectFallback: true }), true);
  assert.equal(registry.matchMessage(unrelatedSubject, resolution, { allowSubjectFallback: true }), false);
});

test('known supplier and business subject produce explainable positive signals', () => {
  const aliasRegistry = createSenderAliasRegistry();
  const result = scoreMailMessage(message({
    from: [{ name: 'Валта', address: 'orders@example.invalid' }],
    subject: 'Новый прайс и цены',
  }), {
    now: NOW,
    ownerTimezone: 'Asia/Vladivostok',
    aliasRegistry,
  });

  assert.ok(result.score >= 4);
  assert.ok(result.signals.includes('known_sender:valta'));
  assert.ok(result.signals.some(signal => signal.startsWith('business_subject:')));
});

test('business subject alone raises relevance without inventing a supplier identity', () => {
  const result = scoreMailMessage(message({
    from: [{ name: 'Новая компания', address: null }],
    subject: 'Подтверждение поставки',
  }), {
    now: NOW,
    ownerTimezone: 'Asia/Vladivostok',
    aliasRegistry: createSenderAliasRegistry(),
  });

  assert.ok(result.score >= 4);
  assert.equal(result.knownSender, null);
  assert.ok(result.signals.some(signal => signal.startsWith('business_subject:')));
});

test('repeated PayMaster notifications aggregate with exact count and stay LOW', () => {
  const messages = Array.from({ length: 9 }, (_, index) => message({
    messageId: `paymaster-${index}`,
    from: [{ name: 'PayMaster', address: 'notify@paymaster.example' }],
    subject: 'Оповещение о принятом платеже',
    receivedAt: new Date(NOW.getTime() - index * 60000).toISOString(),
  }));
  const groups = groupRepeatedMessages(messages);
  const analysis = analyzeImportantMail(messages, {
    now: NOW,
    ownerTimezone: 'Asia/Vladivostok',
    aliasRegistry: createSenderAliasRegistry(),
  });

  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 9);
  assert.equal(groups[0].messageIds.length, 9);
  assert.equal(groups[0].normalizedSubject, 'оповещение о принятом платеже');
  assert.equal(groups[0].latestReceivedAt, NOW.toISOString());
  assert.equal(analysis.groups[0].importance, 'low');
  assert.equal(analysis.groups[0].reason, 'paymaster_notification');
  assert.equal(analysis.important.length, 0);
  assert.ok(analysis.scored.every(item => item.analysis.score < 4));
});

test('Valta in Subject identifies the company and produces HIGH importance without a known From', () => {
  const analysis = analyzeImportantMail([message({
    messageId: 'valta-price',
    from: [{ name: 'Анна Размовенко', address: null }],
    subject: 'Валта прайс 14.08.26 общ.xlsx, ПРОМО...',
    receivedAt: '2026-08-14T23:00:00.000Z',
    isUnread: false,
  })], {
    now: NOW,
    ownerTimezone: 'Asia/Vladivostok',
    aliasRegistry: createSenderAliasRegistry(),
  });

  assert.equal(analysis.important.length, 1);
  assert.equal(analysis.important[0].analysis.importance, 'high');
  assert.equal(analysis.important[0].analysis.knownCompany, 'Валта');
  assert.deepEqual(analysis.important[0].analysis.topics, ['прайс', 'PROMO']);
  assert.ok(analysis.important[0].analysis.signals.includes('known_company_subject:valta'));
});

test('same sender with different business subjects remains two separate important entries', () => {
  const analysis = analyzeImportantMail([
    message({ messageId: 'valta-price', from: [{ name: 'Валта' }], subject: 'Валта прайс' }),
    message({ messageId: 'valta-order', from: [{ name: 'Валта' }], subject: 'Валта заказ' }),
  ], {
    now: NOW,
    ownerTimezone: 'Asia/Vladivostok',
    aliasRegistry: createSenderAliasRegistry(),
  });

  assert.equal(analysis.groups.length, 0);
  assert.deepEqual(
    analysis.important.map(item => item.message.messageId).sort(),
    ['valta-order', 'valta-price']
  );
});

test('Yandex ID app-password notice stays below supplier business mail', () => {
  const analysis = analyzeImportantMail([
    message({
      messageId: 'yandex-id',
      from: [{ name: 'Яндекс ID', address: null }],
      subject: 'Вы создали пароль для приложения Arthur',
    }),
    message({
      messageId: 'valta-price',
      from: [{ name: 'Анна Размовенко', address: null }],
      subject: 'Валта прайс 14.08.26 общ.xlsx, ПРОМО...',
    }),
  ], {
    now: NOW,
    ownerTimezone: 'Asia/Vladivostok',
    aliasRegistry: createSenderAliasRegistry(),
  });

  const yandex = analysis.scored.find(item => item.message.messageId === 'yandex-id');
  const valta = analysis.scored.find(item => item.message.messageId === 'valta-price');
  assert.equal(yandex.analysis.importance, 'medium');
  assert.equal(yandex.analysis.reason, 'system_notification');
  assert.equal(valta.analysis.importance, 'high');
  assert.ok(valta.analysis.score > yandex.analysis.score);
});

test('response wording creates candidates while ordinary notification does not', () => {
  const analysis = analyzeImportantMail([
    message({ messageId: 'needs-reply', subject: 'Подтвердите заказ и пришлите договор' }),
    message({ messageId: 'ordinary', subject: 'Обычное notification' }),
  ], {
    now: NOW,
    ownerTimezone: 'Asia/Vladivostok',
    aliasRegistry: createSenderAliasRegistry(),
  });

  assert.deepEqual(
    analysis.responseCandidates.map(item => item.message.messageId),
    ['needs-reply']
  );
});
