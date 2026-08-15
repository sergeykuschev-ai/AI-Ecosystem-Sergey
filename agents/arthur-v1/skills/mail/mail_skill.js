'use strict';

const { UnsupportedOperationError } = require('../../errors/arthur_errors');
const { DEFAULT_MAX_SNIPPET_LENGTH, normalizeMailMessage } = require('./message_normalizer');
const {
  IMPORTANCE,
  analyzeImportantMail,
  groupRepeatedMessages,
  senderLabel,
} = require('./mail_analysis');
const {
  createMailTaskProposals,
  pendingMailAction,
} = require('./mail_task_proposal');
const { createSenderAliasRegistry, normalizeMatchText } = require('./sender_alias_registry');

const CAPABILITIES = Object.freeze([
  { id: 'listUnreadMail', readOnly: true },
  { id: 'listRecentMail', readOnly: true },
  { id: 'searchMail', readOnly: true },
  { id: 'findMessagesFromSender', readOnly: true },
  { id: 'summarizeImportantMail', readOnly: true },
]);

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const MAX_TELEGRAM_MESSAGES = 10;
const IMPORTANT_CANDIDATE_LIMIT = 20;
const IMPORTANT_DISPLAY_LIMIT = 5;
const MAX_RESPONSE_LENGTH = 3500;
const DEFAULT_OWNER_TIMEZONE = 'Asia/Vladivostok';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RECENT_WINDOW_MS = DAY_MS;
const DEFAULT_SEARCH_WINDOW_MS = 30 * DAY_MS;
const DEFAULT_SENDER_WINDOW_MS = 7 * DAY_MS;

const OPERATION_PARAMETERS = Object.freeze({
  listUnreadMail: Object.freeze(['mailboxId', 'businessContext', 'limit']),
  listRecentMail: Object.freeze(['mailboxId', 'businessContext', 'limit', 'since', 'view']),
  searchMail: Object.freeze([
    'mailboxId', 'businessContext', 'limit', 'from', 'subject', 'since', 'unreadOnly',
  ]),
  findMessagesFromSender: Object.freeze([
    'mailboxId', 'businessContext', 'limit', 'sender', 'since',
  ]),
  summarizeImportantMail: Object.freeze(['businessContext', 'limit', 'since']),
});

function normalizeLimit(value) {
  if (value == null || value === '') return DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    throw new RangeError(`mail limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return parsed;
}

function normalizeSince(value, defaultWindowMs, now) {
  if (value == null || value === '') return new Date(now.getTime() - defaultWindowMs).toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TypeError('mail since must be a valid date');
  if (parsed.getTime() > now.getTime()) throw new RangeError('mail since cannot be in the future');
  return parsed.toISOString();
}

function assertAllowedParameters(operation, parameters) {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw new TypeError('mail parameters must be an object');
  }
  const allowed = OPERATION_PARAMETERS[operation] || [];
  const unsupported = Object.keys(parameters).find(key => !allowed.includes(key));
  if (unsupported) throw new TypeError(`unsupported ${operation} parameter: ${unsupported}`);
}

function normalizeOptionalString(value, field) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function getAdapter(adapters, provider) {
  if (adapters instanceof Map) return adapters.get(provider) || null;
  return adapters?.[provider] || null;
}

function dateParts(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function dateKey(value, timeZone) {
  const parts = dateParts(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatReceivedAt(value, now, timeZone) {
  const receivedAt = new Date(value);
  const time = new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(receivedAt);
  if (dateKey(receivedAt, timeZone) === dateKey(now, timeZone)) {
    return `Сегодня ${time}`;
  }
  const date = new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(receivedAt);
  return `${date} ${time}`;
}

function resultTitle(parameters, count) {
  if (parameters.businessContext === 'miska') {
    return `Непрочитанные письма по Миске: ${count}`;
  }
  return `Непрочитанные письма: ${count}`;
}

function emptyText(parameters) {
  return parameters.businessContext === 'miska'
    ? 'Непрочитанных писем по Миске нет.'
    : 'Непрочитанных писем нет.';
}

function truncateResponse(lines) {
  const response = lines.join('\n');
  if (response.length <= MAX_RESPONSE_LENGTH) return response;
  return `${response.slice(0, MAX_RESPONSE_LENGTH - 1).trimEnd()}…`;
}

function appendMessages(lines, messages, { mailboxes, now, timeZone } = {}) {
  const showMailbox = mailboxes.length > 1;
  const mailboxById = new Map(mailboxes.map(mailbox => [mailbox.mailboxId, mailbox]));
  messages.slice(0, MAX_TELEGRAM_MESSAGES).forEach((message, index) => {
    lines.push(`${index + 1}. ${senderLabel(message)}`);
    lines.push(`   ${message.subject || '(без темы)'}`);
    lines.push(`   ${formatReceivedAt(message.receivedAt, now, timeZone)}`);
    if (showMailbox) {
      lines.push(`   ${mailboxById.get(message.mailboxId)?.displayName || message.mailboxId}`);
    }
    if (index < Math.min(messages.length, MAX_TELEGRAM_MESSAGES) - 1) lines.push('');
  });
}

function appendNoise(lines, noiseGroups) {
  if (noiseGroups.length === 0) return;
  lines.push('', 'Шум:');
  for (const group of noiseGroups.slice(0, 5)) {
    lines.push(`${group.sender} — ${group.count} уведомлений: ${group.subject}`);
  }
}

function appendWarnings(lines, warnings) {
  if (warnings.length > 0) {
    lines.push('', `Не удалось проверить: ${warnings.map(item => item.displayName).join(', ')}.`);
  }
}

function importantWindowLabel(since, now, timeZone) {
  const todayStart = dateKey(new Date(since), timeZone) === dateKey(now, timeZone)
    && new Date(since).getTime() <= now.getTime();
  if (todayStart) return 'сегодня';
  const windowMs = now.getTime() - Date.parse(since);
  if (Math.abs(windowMs - DAY_MS) < 60000) return 'за последние 24 часа';
  if (Math.abs(windowMs - 7 * DAY_MS) < 60000) return 'за последние 7 дней';
  return 'за выбранный период';
}

function joinTopics(topics) {
  if (topics.length <= 1) return topics[0] || '';
  return `${topics.slice(0, -1).join(', ')} и ${topics.at(-1)}`;
}

function importantSender(item) {
  const sender = senderLabel(item.message);
  const company = item.analysis.knownCompany;
  if (!company || normalizeMatchText(company) === normalizeMatchText(sender)) return sender;
  return `${company} / ${sender}`;
}

function importantGist(item) {
  const topics = item.analysis.topics;
  const subject = String(item.message.subject || '(без темы)').trim();
  const gist = topics.length > 0
    ? `Письмо по теме: ${joinTopics(topics)}.`
    : `Тема: ${subject.slice(0, 140)}${subject.length > 140 ? '…' : ''}`;
  return item.analysis.responseCandidate
    ? `Возможно требует внимания: ${gist.charAt(0).toLocaleLowerCase('ru-RU')}${gist.slice(1)}`
    : gist;
}

function appendImportantItems(lines, items, { now, timeZone }) {
  items.slice(0, IMPORTANT_DISPLAY_LIMIT).forEach((item, index) => {
    lines.push(`${index + 1}. ${importantSender(item)}`);
    lines.push(`   ${importantGist(item)}`);
    lines.push(`   ${formatReceivedAt(item.message.receivedAt, now, timeZone)}`);
    if (index < Math.min(items.length, IMPORTANT_DISPLAY_LIMIT) - 1) lines.push('');
  });
}

function formatOtherGroup(group) {
  const sender = normalizeMatchText(group.sender);
  const subject = normalizeMatchText(group.subject);
  if (sender.includes('paymaster') && /платеж/u.test(subject)) {
    return `${group.sender} — ${group.count} уведомлений о платежах.`;
  }
  return `${group.sender} — ${group.count} уведомлений: ${group.subject}`;
}

function formatOtherItem(item) {
  const sender = senderLabel(item.message);
  const subject = String(item.message.subject || '(без темы)').trim();
  if (item.analysis.reason === 'system_notification') {
    return `${sender} — системное уведомление: ${subject}`;
  }
  return `${sender} — ${subject}`;
}

function formatImportantSummary({ analysis, warnings, parameters, now, timeZone, truncated }) {
  const importantGroups = analysis.groups.filter(group => group.importance === IMPORTANCE.HIGH);
  const otherGroups = analysis.groups.filter(group => group.importance !== IMPORTANCE.HIGH);
  const importantCount = analysis.important.length
    + importantGroups.reduce((total, group) => total + group.count, 0);
  const otherCount = analysis.other.length
    + otherGroups.reduce((total, group) => total + group.count, 0);
  const lines = [
    `Что важного в почте Миски ${importantWindowLabel(parameters.since, now, timeZone)}:`,
    '',
    'ВАЖНО',
  ];

  if (analysis.important.length === 0 && importantGroups.length === 0) {
    lines.push('Важных писем не нашёл.');
  } else {
    appendImportantItems(lines, analysis.important, { now, timeZone });
    const remainingImportantSlots = Math.max(0, IMPORTANT_DISPLAY_LIMIT - analysis.important.length);
    for (const group of importantGroups.slice(0, remainingImportantSlots)) {
      lines.push(`• ${formatOtherGroup(group)}`);
    }
  }

  if (analysis.other.length > 0 || otherGroups.length > 0) {
    lines.push('', 'ОСТАЛЬНОЕ');
    for (const group of otherGroups.slice(0, IMPORTANT_DISPLAY_LIMIT)) {
      lines.push(`• ${formatOtherGroup(group)}`);
    }
    const remainingOtherSlots = Math.max(0, IMPORTANT_DISPLAY_LIMIT - otherGroups.length);
    for (const item of analysis.other.slice(0, remainingOtherSlots)) {
      lines.push(`• ${formatOtherItem(item)}`);
    }
  }

  lines.push('', `Всего: важных — ${importantCount}, остальных — ${otherCount}.`);
  if (truncated) {
    lines.push(`Сводка ограничена последними ${parameters.limit} письмами за период.`);
  }
  appendWarnings(lines, warnings);
  return truncateResponse(lines);
}

function formatResponse({ messages, mailboxes, warnings, parameters, now, timeZone }) {
  const noiseGroups = groupRepeatedMessages(messages);
  const groupedIds = new Set(noiseGroups.flatMap(group => group.messageIds));
  const visibleMessages = messages.filter(message => !groupedIds.has(message.messageId));
  const lines = messages.length === 0
    ? [emptyText(parameters)]
    : [resultTitle(parameters, messages.length), ''];
  appendMessages(lines, visibleMessages, { mailboxes, now, timeZone });
  appendNoise(lines, noiseGroups);
  appendWarnings(lines, warnings);
  return truncateResponse(lines);
}

function formatRecentResponse({ messages, mailboxes, warnings, parameters, now, timeZone, analysis }) {
  if (parameters.view === 'important') {
    return formatImportantSummary({
      analysis,
      warnings,
      parameters,
      now,
      timeZone,
      truncated: messages.length >= parameters.limit,
    });
  }

  const noiseGroups = analysis.noiseGroups;
  const groupedIds = new Set(noiseGroups.flatMap(group => group.messageIds));
  const visibleMessages = messages.filter(message => !groupedIds.has(message.messageId));
  const context = parameters.businessContext === 'miska' ? ' по Миске' : '';
  const lines = messages.length === 0
    ? [`За выбранный период писем${context} не нашёл.`]
    : [`Последние письма${context}: ${messages.length}`, ''];
  appendMessages(lines, visibleMessages, { mailboxes, now, timeZone });
  appendNoise(lines, noiseGroups);
  appendWarnings(lines, warnings);
  return truncateResponse(lines);
}

function formatSearchResponse({ messages, mailboxes, warnings, parameters, now, timeZone, analysis }) {
  const noiseGroups = analysis.noiseGroups;
  const groupedIds = new Set(noiseGroups.flatMap(group => group.messageIds));
  const visibleMessages = messages.filter(message => !groupedIds.has(message.messageId));
  const lines = messages.length === 0
    ? ['По заданным условиям писем не нашёл.']
    : [`Найдено писем: ${messages.length}`, ''];
  appendMessages(lines, visibleMessages, { mailboxes, now, timeZone });
  appendNoise(lines, noiseGroups);
  appendWarnings(lines, warnings);
  return truncateResponse(lines);
}

function formatSenderResponse({ messages, mailboxes, warnings, parameters, now, timeZone, sender }) {
  const days = Math.max(1, Math.round((now.getTime() - Date.parse(parameters.since)) / DAY_MS));
  const lines = [];
  if (messages.length === 0) {
    lines.push(`За последние ${days} дней писем от ${sender.displayName} не нашёл.`);
  } else if (parameters.limit === 1) {
    const message = messages[0];
    lines.push(`Да. Последнее письмо от ${sender.displayName}:`);
    lines.push(message.subject || '(без темы)');
    lines.push(formatReceivedAt(message.receivedAt, now, timeZone));
  } else {
    lines.push(`Письма от ${sender.displayName}: ${messages.length}`, '');
    appendMessages(lines, messages, { mailboxes, now, timeZone });
  }
  appendWarnings(lines, warnings);
  return truncateResponse(lines);
}

function warningFor(mailbox, error) {
  return {
    mailboxId: mailbox.mailboxId,
    displayName: mailbox.displayName,
    provider: mailbox.provider,
    code: error?.code || 'MAIL_PROVIDER_UNAVAILABLE',
  };
}

function aggregationMetadata(noiseGroups) {
  return {
    groups: noiseGroups.map(group => ({
      sender: group.sender,
      subject: group.subject,
      normalizedSubject: group.normalizedSubject,
      count: group.count,
      latestReceivedAt: group.latestReceivedAt,
      importance: group.importance || null,
      reason: group.reason || null,
    })),
    groupedMessageCount: noiseGroups.reduce((total, group) => total + group.count, 0),
  };
}

function createMailSkill({
  mailboxRegistry,
  adapters = {},
  senderAliasRegistry = createSenderAliasRegistry(),
  clock = () => new Date(),
  ownerTimezone = DEFAULT_OWNER_TIMEZONE,
  maxSnippetLength = DEFAULT_MAX_SNIPPET_LENGTH,
} = {}) {
  if (!mailboxRegistry || typeof mailboxRegistry.select !== 'function') {
    throw new TypeError('MailSkill mailboxRegistry is required');
  }

  function selectMailboxes(parameters) {
    return mailboxRegistry.select({
      mailboxId: parameters.mailboxId,
      businessContext: parameters.businessContext,
    });
  }

  async function collect(mailboxes, operation, requestForMailbox) {
    const settled = await Promise.allSettled(mailboxes.map(async mailbox => {
      const adapter = getAdapter(adapters, mailbox.provider);
      if (!adapter || typeof adapter[operation] !== 'function') {
        const error = new Error(`Mail adapter unavailable for operation: ${operation}`);
        error.code = 'MAIL_ADAPTER_UNAVAILABLE';
        throw error;
      }
      const providerMessages = await adapter[operation](requestForMailbox(mailbox));
      if (!Array.isArray(providerMessages)) {
        throw new TypeError(`Mail adapter ${mailbox.provider} must return an array`);
      }
      return providerMessages.map(message => normalizeMailMessage(message, mailbox, { maxSnippetLength }));
    }));

    const warnings = [];
    const messages = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') messages.push(...result.value);
      else warnings.push(warningFor(mailboxes[index], result.reason));
    });
    return { messages, warnings };
  }

  function finalize({
    operation,
    messages,
    warnings,
    mailboxes,
    parameters,
    responseText,
    metadata = {},
    pendingAction = null,
  }) {
    return {
      status: 'success',
      data: {
        status: warnings.length === mailboxes.length ? 'unavailable' : 'available',
        summary: `Писем получено: ${messages.length}.`,
        responseText,
        count: messages.length,
        messages,
        warnings,
        ...(pendingAction ? { pendingMailAction: pendingAction } : {}),
      },
      metadata: {
        source: 'mail',
        operation,
        mailboxIds: mailboxes.map(mailbox => mailbox.mailboxId),
        degraded: warnings.length > 0,
        ...metadata,
      },
    };
  }

  async function listUnreadMail(parameters = {}) {
    assertAllowedParameters('listUnreadMail', parameters);
    const limit = normalizeLimit(parameters.limit);
    const mailboxes = selectMailboxes(parameters);
    const { messages: collected, warnings } = await collect(
      mailboxes,
      'listUnreadMail',
      mailbox => ({ mailbox, limit })
    );
    const messages = collected
      .filter(message => message.isUnread === true)
      .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))
      .slice(0, limit);
    const now = clock();
    const noiseGroups = groupRepeatedMessages(messages);
    return finalize({
      operation: 'listUnreadMail',
      messages,
      warnings,
      mailboxes,
      parameters,
      responseText: formatResponse({ messages, mailboxes, warnings, parameters, now, timeZone: ownerTimezone }),
      metadata: { aggregation: aggregationMetadata(noiseGroups) },
    });
  }

  async function listRecentMail(parameters = {}) {
    assertAllowedParameters('listRecentMail', parameters);
    const limit = normalizeLimit(parameters.limit);
    const now = clock();
    const since = normalizeSince(parameters.since, DEFAULT_RECENT_WINDOW_MS, now);
    const normalized = { ...parameters, since, limit };
    if (normalized.view != null && normalized.view !== 'important') {
      throw new TypeError('unsupported recent mail view');
    }
    const mailboxes = selectMailboxes(normalized);
    const { messages: collected, warnings } = await collect(
      mailboxes,
      'listRecentMail',
      mailbox => ({ mailbox, limit, since })
    );
    const messages = collected
      .filter(message => Date.parse(message.receivedAt) >= Date.parse(since))
      .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))
      .slice(0, limit);
    const analysis = analyzeImportantMail(messages, {
      now,
      ownerTimezone,
      aliasRegistry: senderAliasRegistry,
    });
    return finalize({
      operation: 'listRecentMail',
      messages,
      warnings,
      mailboxes,
      parameters: normalized,
      responseText: formatRecentResponse({
        messages,
        mailboxes,
        warnings,
        parameters: normalized,
        now,
        timeZone: ownerTimezone,
        analysis,
      }),
      metadata: {
        aggregation: aggregationMetadata(analysis.noiseGroups),
        importance: {
          importantCount: analysis.important.length,
          responseCandidateCount: analysis.responseCandidates.length,
          scores: analysis.scored.map(item => ({
            messageId: item.message.messageId,
            score: item.analysis.score,
            signals: [...item.analysis.signals],
          })),
        },
      },
    });
  }

  async function summarizeImportantMail(parameters = {}) {
    assertAllowedParameters('summarizeImportantMail', parameters);
    if (parameters.businessContext != null && parameters.businessContext !== 'miska') {
      throw new TypeError('important mail summary supports only businessContext=miska');
    }
    const limit = normalizeLimit(parameters.limit ?? IMPORTANT_CANDIDATE_LIMIT);
    const now = clock();
    const since = normalizeSince(parameters.since, DEFAULT_RECENT_WINDOW_MS, now);
    const normalized = { ...parameters, businessContext: 'miska', since, limit };
    const mailboxes = selectMailboxes(normalized);
    const { messages: collected, warnings } = await collect(
      mailboxes,
      'listRecentMail',
      mailbox => ({ mailbox, limit, since })
    );
    const messages = collected
      .filter(message => Date.parse(message.receivedAt) >= Date.parse(since))
      .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))
      .slice(0, limit);
    const truncated = collected.length >= limit;
    const analysis = analyzeImportantMail(messages, {
      now,
      ownerTimezone,
      aliasRegistry: senderAliasRegistry,
    });
    const groupedMessageCount = analysis.groups
      .reduce((total, group) => total + group.count, 0);
    const importantGroupCount = analysis.groups
      .filter(group => group.importance === IMPORTANCE.HIGH)
      .reduce((total, group) => total + group.count, 0);
    const otherGroupCount = groupedMessageCount - importantGroupCount;
    const proposals = createMailTaskProposals(
      analysis.important.map(item => item.message),
      senderAliasRegistry
    );
    const responseText = formatImportantSummary({
      analysis,
      warnings,
      parameters: normalized,
      now,
      timeZone: ownerTimezone,
      truncated,
    });
    return finalize({
      operation: 'summarizeImportantMail',
      messages,
      warnings,
      mailboxes,
      parameters: normalized,
      responseText,
      pendingAction: pendingMailAction(proposals),
      metadata: {
        candidateLimit: limit,
        truncated,
        aggregation: aggregationMetadata(analysis.groups),
        importance: {
          importantCount: analysis.important.length + importantGroupCount,
          otherCount: analysis.other.length + otherGroupCount,
          groupedMessageCount,
          responseCandidateCount: analysis.responseCandidates.length,
          scores: analysis.scored.map(item => ({
            messageId: item.message.messageId,
            score: item.analysis.score,
            importance: item.analysis.importance,
            reason: item.analysis.reason,
            signals: [...item.analysis.signals],
          })),
        },
      },
    });
  }

  async function searchMail(parameters = {}) {
    assertAllowedParameters('searchMail', parameters);
    const limit = normalizeLimit(parameters.limit);
    const now = clock();
    const since = normalizeSince(parameters.since, DEFAULT_SEARCH_WINDOW_MS, now);
    const from = normalizeOptionalString(parameters.from, 'mail from filter');
    const subject = normalizeOptionalString(parameters.subject, 'mail subject filter');
    if (parameters.unreadOnly != null && typeof parameters.unreadOnly !== 'boolean') {
      throw new TypeError('mail unreadOnly must be a boolean');
    }
    const filters = {
      ...(from ? { from } : {}),
      ...(subject ? { subject } : {}),
      since,
      ...(parameters.unreadOnly != null ? { unreadOnly: parameters.unreadOnly } : {}),
    };
    const normalized = { ...parameters, ...filters, limit };
    const mailboxes = selectMailboxes(normalized);
    const { messages: collected, warnings } = await collect(
      mailboxes,
      'searchMail',
      mailbox => ({ mailbox, limit, filters })
    );
    const messages = collected
      .filter(message => Date.parse(message.receivedAt) >= Date.parse(since))
      .filter(message => !from || (message.from || []).some(sender => {
        if (from.includes('@')) return String(sender.address || '').toLowerCase() === from.toLowerCase();
        return normalizeMatchText(sender.name).includes(normalizeMatchText(from));
      }))
      .filter(message => !subject
        || normalizeMatchText(message.subject).includes(normalizeMatchText(subject)))
      .filter(message => parameters.unreadOnly !== true || message.isUnread === true)
      .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))
      .slice(0, limit);
    const analysis = analyzeImportantMail(messages, {
      now,
      ownerTimezone,
      aliasRegistry: senderAliasRegistry,
    });
    return finalize({
      operation: 'searchMail',
      messages,
      warnings,
      mailboxes,
      parameters: normalized,
      responseText: formatSearchResponse({
        messages,
        mailboxes,
        warnings,
        parameters: normalized,
        now,
        timeZone: ownerTimezone,
        analysis,
      }),
      metadata: { aggregation: aggregationMetadata(analysis.noiseGroups) },
    });
  }

  async function findMessagesFromSender(parameters = {}) {
    assertAllowedParameters('findMessagesFromSender', parameters);
    const senderQuery = normalizeOptionalString(parameters.sender, 'mail sender');
    if (!senderQuery) throw new TypeError('mail sender is required');
    const limit = normalizeLimit(parameters.limit);
    const now = clock();
    const since = normalizeSince(parameters.since, DEFAULT_SENDER_WINDOW_MS, now);
    const sender = senderAliasRegistry.resolve(senderQuery);
    const normalized = {
      ...parameters,
      sender: senderQuery,
      since,
      limit,
      ...(!parameters.businessContext && sender.businessContext
        ? { businessContext: sender.businessContext }
        : {}),
    };
    const mailboxes = selectMailboxes(normalized);
    const adapterFilters = sender.known
      ? { companyTerms: [...new Set([...sender.aliases, ...sender.addresses])], since }
      : { since };
    const { messages: collected, warnings } = await collect(
      mailboxes,
      'searchMail',
      mailbox => ({
        mailbox,
        limit: sender.known ? limit : MAX_LIMIT,
        filters: adapterFilters,
      })
    );
    const messages = collected
      .filter(message => Date.parse(message.receivedAt) >= Date.parse(since))
      .filter(message => senderAliasRegistry.matchMessage(message, sender, {
        allowSubjectFallback: true,
      }))
      .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))
      .slice(0, limit);
    const proposals = createMailTaskProposals(messages, senderAliasRegistry);
    const responseText = formatSenderResponse({
      messages,
      mailboxes,
      warnings,
      parameters: normalized,
      now,
      timeZone: ownerTimezone,
      sender,
    });
    return finalize({
      operation: 'findMessagesFromSender',
      messages,
      warnings,
      mailboxes,
      parameters: normalized,
      responseText,
      pendingAction: pendingMailAction(proposals),
      metadata: {
        sender: {
          query: sender.query,
          knownAlias: sender.known,
          aliasId: sender.aliasId || null,
          generatedAddress: false,
        },
      },
    });
  }

  const operations = {
    listUnreadMail,
    listRecentMail,
    searchMail,
    findMessagesFromSender,
    summarizeImportantMail,
  };

  return {
    id: 'mail',
    name: 'Arthur Mail',
    version: '1.3.0',
    capabilities: CAPABILITIES,
    readOnly: true,
    async execute(input = {}) {
      const operation = operations[input.operation];
      if (!operation) throw new UnsupportedOperationError('mail', input.operation);
      return operation(input.parameters || {});
    },
    async health() {
      const mailboxes = mailboxRegistry.list();
      const configured = mailboxes.filter(mailbox => Boolean(getAdapter(adapters, mailbox.provider)));
      return {
        healthy: configured.length > 0,
        skill: 'mail',
        version: '1.3.0',
        configuredMailboxes: configured.length,
      };
    },
  };
}

module.exports = {
  CAPABILITIES,
  DAY_MS,
  DEFAULT_LIMIT,
  DEFAULT_OWNER_TIMEZONE,
  DEFAULT_RECENT_WINDOW_MS,
  DEFAULT_SEARCH_WINDOW_MS,
  DEFAULT_SENDER_WINDOW_MS,
  IMPORTANT_CANDIDATE_LIMIT,
  IMPORTANT_DISPLAY_LIMIT,
  MAX_LIMIT,
  MAX_RESPONSE_LENGTH,
  MAX_TELEGRAM_MESSAGES,
  OPERATION_PARAMETERS,
  assertAllowedParameters,
  createMailSkill,
  formatReceivedAt,
  formatImportantSummary,
  formatResponse,
  normalizeLimit,
  normalizeSince,
};
