'use strict';

const { normalizeMatchText } = require('./sender_alias_registry');

const BUSINESS_SUBJECT_TOKENS = Object.freeze([
  'прайс',
  'цена',
  'цены',
  'заказ',
  'поставка',
  'наличие',
  'договор',
  'документ',
  'акт',
  'накладная',
  'счёт',
  'счет',
  'оплата',
  'задолженность',
  'возврат',
  'претензия',
  'акция',
  'промо',
  'promo',
  'подтверждение',
  'отгрузка',
]);

const BUSINESS_TOPICS = Object.freeze([
  Object.freeze({ label: 'прайс', tokens: Object.freeze(['прайс']) }),
  Object.freeze({ label: 'цены', tokens: Object.freeze(['цена', 'цены']) }),
  Object.freeze({ label: 'заказ', tokens: Object.freeze(['заказ']) }),
  Object.freeze({ label: 'поставка', tokens: Object.freeze(['поставка', 'отгрузка']) }),
  Object.freeze({ label: 'наличие', tokens: Object.freeze(['наличие']) }),
  Object.freeze({ label: 'договор', tokens: Object.freeze(['договор']) }),
  Object.freeze({ label: 'документы', tokens: Object.freeze(['документ', 'акт', 'накладная']) }),
  Object.freeze({ label: 'счёт', tokens: Object.freeze(['счёт', 'счет']) }),
  Object.freeze({ label: 'оплата', tokens: Object.freeze(['оплата', 'задолженность']) }),
  Object.freeze({ label: 'возврат/претензия', tokens: Object.freeze(['возврат', 'претензия']) }),
  Object.freeze({ label: 'акция', tokens: Object.freeze(['акция']) }),
  Object.freeze({ label: 'PROMO', tokens: Object.freeze(['промо', 'promo']) }),
  Object.freeze({ label: 'подтверждение', tokens: Object.freeze(['подтверждение']) }),
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
  'пароль для приложения',
  'яндекс id',
]);

const MARKETING_TOKENS = Object.freeze([
  'newsletter',
  'рассылка',
  'подписка',
  'дайджест',
]);

const IMPORTANCE = Object.freeze({
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
});

const NOISE_GROUP_THRESHOLD = 3;

function senderLabel(message) {
  const sender = Array.isArray(message?.from) ? message.from[0] : null;
  return String(sender?.name || sender?.address || 'Неизвестный отправитель').trim();
}

function senderGroupKey(message) {
  const sender = Array.isArray(message?.from) ? message.from[0] : null;
  return normalizeMatchText(sender?.address || sender?.name || 'unknown');
}

function subjectContains(subject, tokens) {
  const normalized = ` ${normalizeMatchText(subject).replace(/[.@_+-]+/gu, ' ')} `;
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
      normalizedSubject: normalizeMatchText(message.subject),
      count: 0,
      messageIds: [],
      latestReceivedAt: message.receivedAt,
    };
    existing.count += 1;
    existing.messageIds.push(message.messageId);
    if (Date.parse(message.receivedAt) > Date.parse(existing.latestReceivedAt)) {
      existing.latestReceivedAt = message.receivedAt;
      existing.sender = senderLabel(message);
      existing.subject = message.subject || '(без темы)';
    }
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

function businessTopics(message) {
  const content = `${message?.subject || ''} ${message?.snippet || ''}`;
  return BUSINESS_TOPICS
    .filter(topic => subjectContains(content, topic.tokens).length > 0)
    .map(topic => topic.label);
}

function importanceReason({ knownCompany, topics, responseTokens, paymaster, systemNotice, marketing, repeatedCount }) {
  if (responseTokens.length > 0) return 'explicit_business_action';
  if (paymaster) return 'paymaster_notification';
  if (systemNotice) return 'system_notification';
  if (marketing) return 'marketing_notification';
  if (knownCompany && topics.length > 0) return 'known_company_business_mail';
  if (knownCompany) return 'known_company';
  if (topics.length > 0) return 'business_subject_or_snippet';
  if (repeatedCount >= NOISE_GROUP_THRESHOLD) return 'repeated_sender_subject';
  return 'working_mail';
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
  const knownCompany = knownSender || aliasRegistry.findKnownCompany(message);
  if (knownCompany) {
    score += 4;
    signals.push(`${knownSender ? 'known_sender' : 'known_company_subject'}:${knownCompany.aliasId}`);
  }

  const businessContent = `${message.subject || ''} ${message.snippet || ''}`;
  const businessTokens = subjectContains(businessContent, BUSINESS_SUBJECT_TOKENS);
  const topics = businessTopics(message);
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
  const paymaster = normalizedSender.includes('paymaster') || normalizedSubject.includes('paymaster');
  const systemNotice = subjectContains(businessContent, SYSTEM_NOTICE_TOKENS).length > 0
    || normalizedSender.includes('яндекс id');
  const marketing = subjectContains(businessContent, MARKETING_TOKENS).length > 0;
  if (paymaster) {
    score -= 6;
    signals.push('noise:paymaster');
  }
  if (repeatedCount >= NOISE_GROUP_THRESHOLD) {
    score -= 4;
    signals.push(`noise:repeated:${repeatedCount}`);
  }
  if (systemNotice) {
    score -= 2;
    signals.push('noise:system_notice');
  }
  if (marketing) {
    score -= 2;
    signals.push('noise:marketing');
  }

  const importance = responseTokens.length > 0
    ? IMPORTANCE.HIGH
    : (paymaster || marketing
      ? IMPORTANCE.LOW
      : (knownCompany || topics.length > 0
        ? IMPORTANCE.HIGH
        : (repeatedCount >= NOISE_GROUP_THRESHOLD ? IMPORTANCE.LOW : IMPORTANCE.MEDIUM)));

  return Object.freeze({
    messageId: message.messageId,
    score,
    signals: Object.freeze(signals),
    importance,
    reason: importanceReason({
      knownCompany,
      topics,
      responseTokens,
      paymaster,
      systemNotice,
      marketing,
      repeatedCount,
    }),
    knownSender: knownSender ? knownSender.displayName : null,
    knownCompany: knownCompany ? knownCompany.displayName : null,
    topics: Object.freeze(topics),
    responseCandidate: responseTokens.length > 0,
  });
}

function analyzeImportantMail(messages, {
  now = new Date(),
  ownerTimezone = 'Asia/Vladivostok',
  aliasRegistry,
  noiseThreshold = NOISE_GROUP_THRESHOLD,
} = {}) {
  if (!aliasRegistry
    || typeof aliasRegistry.findKnownSender !== 'function'
    || typeof aliasRegistry.findKnownCompany !== 'function') {
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
  const groupedIds = new Set(noiseGroups.flatMap(group => group.messageIds));
  const groups = noiseGroups.map(group => {
    const representative = scored.find(item => item.message.messageId === group.messageIds[0]);
    return Object.freeze({
      ...group,
      importance: representative.analysis.importance,
      reason: representative.analysis.reason,
    });
  });
  const important = scored
    .filter(item => !groupedIds.has(item.message.messageId))
    .filter(item => item.analysis.importance === IMPORTANCE.HIGH)
    .sort((left, right) => (
      right.analysis.score - left.analysis.score
      || Date.parse(right.message.receivedAt) - Date.parse(left.message.receivedAt)
    ));
  const other = scored
    .filter(item => !groupedIds.has(item.message.messageId))
    .filter(item => item.analysis.importance !== IMPORTANCE.HIGH)
    .sort((left, right) => Date.parse(right.message.receivedAt) - Date.parse(left.message.receivedAt));
  const responseCandidates = scored
    .filter(item => item.analysis.responseCandidate)
    .sort((left, right) => Date.parse(right.message.receivedAt) - Date.parse(left.message.receivedAt));

  return Object.freeze({
    important: Object.freeze(important),
    other: Object.freeze(other),
    responseCandidates: Object.freeze(responseCandidates),
    groups: Object.freeze(groups),
    noiseGroups: Object.freeze(groups),
    scored: Object.freeze(scored),
  });
}

module.exports = {
  BUSINESS_SUBJECT_TOKENS,
  BUSINESS_TOPICS,
  IMPORTANCE,
  MARKETING_TOKENS,
  NOISE_GROUP_THRESHOLD,
  RESPONSE_CANDIDATE_TOKENS,
  SYSTEM_NOTICE_TOKENS,
  analyzeImportantMail,
  businessTopics,
  groupRepeatedMessages,
  scoreMailMessage,
  senderGroupKey,
  senderLabel,
  subjectContains,
};
