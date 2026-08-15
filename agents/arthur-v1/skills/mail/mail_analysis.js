'use strict';

const { normalizeMatchText } = require('./sender_alias_registry');

const BUSINESS_SUBJECT_TOKENS = Object.freeze([
  'прайс',
  'заказ',
  'поставка',
  'договор',
  'счёт',
  'счет',
  'оплата',
  'задолженность',
  'возврат',
  'подтверждение',
  'наличие',
  'цены',
  'отгрузка',
]);

const RESPONSE_CANDIDATE_TOKENS = Object.freeze([
  'требуется',
  'подтвердите',
  'пришлите',
  'ответьте',
  'согласуйте',
  'уточните',
  'подпишите',
]);

const SYSTEM_NOTICE_TOKENS = Object.freeze([
  'security notice',
  'уведомление безопасности',
  'системное уведомление',
  'system notification',
]);

const NOISE_GROUP_THRESHOLD = 3;
const IMPORTANT_SCORE_THRESHOLD = 4;

function senderLabel(message) {
  const sender = Array.isArray(message?.from) ? message.from[0] : null;
  return String(sender?.name || sender?.address || 'Неизвестный отправитель').trim();
}

function senderGroupKey(message) {
  const sender = Array.isArray(message?.from) ? message.from[0] : null;
  return normalizeMatchText(sender?.address || sender?.name || 'unknown');
}

function subjectContains(subject, tokens) {
  const normalized = ` ${normalizeMatchText(subject)} `;
  return tokens.filter(token => normalized.includes(` ${normalizeMatchText(token)} `));
}

function dateKey(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function groupRepeatedMessages(messages, { threshold = NOISE_GROUP_THRESHOLD } = {}) {
  if (!Number.isInteger(threshold) || threshold < 2) {
    throw new RangeError('mail noise threshold must be an integer of at least 2');
  }
  const groups = new Map();
  for (const message of messages) {
    const key = `${senderGroupKey(message)}\u0000${normalizeMatchText(message.subject)}`;
    const existing = groups.get(key) || {
      key,
      sender: senderLabel(message),
      subject: message.subject || '(без темы)',
      count: 0,
      messageIds: [],
    };
    existing.count += 1;
    existing.messageIds.push(message.messageId);
    groups.set(key, existing);
  }
  return Array.from(groups.values())
    .filter(group => group.count >= threshold)
    .sort((left, right) => right.count - left.count)
    .map(group => Object.freeze({
      ...group,
      messageIds: Object.freeze([...group.messageIds]),
    }));
}

function scoreMailMessage(message, {
  now,
  ownerTimezone,
  aliasRegistry,
  repeatedCount = 0,
} = {}) {
  const signals = [];
  let score = 0;
  const receivedAt = new Date(message.receivedAt);
  const today = dateKey(receivedAt, ownerTimezone) === dateKey(now, ownerTimezone);
  if (today) {
    score += 1;
    signals.push('today');
  }
  if (message.isUnread === true) {
    score += 1;
    signals.push('unread');
  }

  const knownSender = aliasRegistry.findKnownSender(message);
  if (knownSender) {
    score += 4;
    signals.push(`known_sender:${knownSender.aliasId}`);
  }

  const businessTokens = subjectContains(message.subject, BUSINESS_SUBJECT_TOKENS);
  if (businessTokens.length > 0) {
    score += 3;
    signals.push(`business_subject:${businessTokens.join(',')}`);
  }

  const responseTokens = subjectContains(message.subject, RESPONSE_CANDIDATE_TOKENS);
  if (responseTokens.length > 0) {
    score += 2;
    signals.push(`response_candidate:${responseTokens.join(',')}`);
  }

  const normalizedSender = normalizeMatchText(senderLabel(message));
  const normalizedSubject = normalizeMatchText(message.subject);
  if (normalizedSender.includes('paymaster') || normalizedSubject.includes('paymaster')) {
    score -= 6;
    signals.push('noise:paymaster');
  }
  if (repeatedCount >= NOISE_GROUP_THRESHOLD) {
    score -= 4;
    signals.push(`noise:repeated:${repeatedCount}`);
  }
  if (subjectContains(message.subject, SYSTEM_NOTICE_TOKENS).length > 0) {
    score -= 2;
    signals.push('noise:system_notice');
  }

  return Object.freeze({
    messageId: message.messageId,
    score,
    signals: Object.freeze(signals),
    knownSender: knownSender ? knownSender.displayName : null,
    responseCandidate: responseTokens.length > 0,
  });
}

function analyzeImportantMail(messages, {
  now = new Date(),
  ownerTimezone = 'Asia/Vladivostok',
  aliasRegistry,
  noiseThreshold = NOISE_GROUP_THRESHOLD,
} = {}) {
  if (!aliasRegistry || typeof aliasRegistry.findKnownSender !== 'function') {
    throw new TypeError('sender alias registry is required for mail analysis');
  }
  const noiseGroups = groupRepeatedMessages(messages, { threshold: noiseThreshold });
  const repeatedByMessage = new Map();
  for (const group of noiseGroups) {
    for (const messageId of group.messageIds) repeatedByMessage.set(messageId, group.count);
  }

  const scored = messages.map(message => ({
    message,
    analysis: scoreMailMessage(message, {
      now,
      ownerTimezone,
      aliasRegistry,
      repeatedCount: repeatedByMessage.get(message.messageId) || 0,
    }),
  }));
  const important = scored
    .filter(item => item.analysis.score >= IMPORTANT_SCORE_THRESHOLD)
    .sort((left, right) => (
      right.analysis.score - left.analysis.score
      || Date.parse(right.message.receivedAt) - Date.parse(left.message.receivedAt)
    ));
  const responseCandidates = scored
    .filter(item => item.analysis.responseCandidate)
    .sort((left, right) => Date.parse(right.message.receivedAt) - Date.parse(left.message.receivedAt));

  return Object.freeze({
    important: Object.freeze(important),
    responseCandidates: Object.freeze(responseCandidates),
    noiseGroups: Object.freeze(noiseGroups),
    scored: Object.freeze(scored),
  });
}

module.exports = {
  BUSINESS_SUBJECT_TOKENS,
  IMPORTANT_SCORE_THRESHOLD,
  NOISE_GROUP_THRESHOLD,
  RESPONSE_CANDIDATE_TOKENS,
  SYSTEM_NOTICE_TOKENS,
  analyzeImportantMail,
  groupRepeatedMessages,
  scoreMailMessage,
  senderGroupKey,
  senderLabel,
  subjectContains,
};
