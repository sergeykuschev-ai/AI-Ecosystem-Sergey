'use strict';

const { UnsupportedOperationError } = require('../../errors/arthur_errors');
const { DEFAULT_MAX_SNIPPET_LENGTH, normalizeMailMessage } = require('./message_normalizer');

const CAPABILITIES = Object.freeze([
  { id: 'listUnreadMail', readOnly: true },
]);

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const MAX_RESPONSE_LENGTH = 3500;
const DEFAULT_OWNER_TIMEZONE = 'Asia/Vladivostok';

function normalizeLimit(value) {
  if (value == null || value === '') return DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    throw new RangeError(`mail limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return parsed;
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

function senderName(message) {
  const sender = message.from[0];
  return sender?.name || sender?.address || 'Неизвестный отправитель';
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

function formatResponse({ messages, mailboxes, warnings, parameters, now, timeZone }) {
  const lines = messages.length === 0
    ? [emptyText(parameters)]
    : [resultTitle(parameters, messages.length), ''];
  const showMailbox = mailboxes.length > 1;
  const mailboxById = new Map(mailboxes.map(mailbox => [mailbox.mailboxId, mailbox]));

  messages.forEach((message, index) => {
    lines.push(`${index + 1}. ${senderName(message)}`);
    lines.push(`   ${message.subject || '(без темы)'}`);
    lines.push(`   ${formatReceivedAt(message.receivedAt, now, timeZone)}`);
    if (showMailbox) {
      lines.push(`   ${mailboxById.get(message.mailboxId)?.displayName || message.mailboxId}`);
    }
    if (index < messages.length - 1) lines.push('');
  });

  if (warnings.length > 0) {
    lines.push('', `Не удалось проверить: ${warnings.map(item => item.displayName).join(', ')}.`);
  }
  const response = lines.join('\n');
  if (response.length <= MAX_RESPONSE_LENGTH) return response;
  return `${response.slice(0, MAX_RESPONSE_LENGTH - 1).trimEnd()}…`;
}

function createMailSkill({
  mailboxRegistry,
  adapters = {},
  clock = () => new Date(),
  ownerTimezone = DEFAULT_OWNER_TIMEZONE,
  maxSnippetLength = DEFAULT_MAX_SNIPPET_LENGTH,
} = {}) {
  if (!mailboxRegistry || typeof mailboxRegistry.select !== 'function') {
    throw new TypeError('MailSkill mailboxRegistry is required');
  }

  async function listUnreadMail(parameters = {}) {
    const limit = normalizeLimit(parameters.limit);
    const mailboxes = mailboxRegistry.select({
      mailboxId: parameters.mailboxId,
      businessContext: parameters.businessContext,
    });

    const settled = await Promise.allSettled(mailboxes.map(async mailbox => {
      const adapter = getAdapter(adapters, mailbox.provider);
      if (!adapter || typeof adapter.listUnreadMail !== 'function') {
        const error = new Error(`Mail adapter unavailable for provider: ${mailbox.provider}`);
        error.code = 'MAIL_ADAPTER_UNAVAILABLE';
        throw error;
      }
      const providerMessages = await adapter.listUnreadMail({ mailbox, limit });
      if (!Array.isArray(providerMessages)) {
        throw new TypeError(`Mail adapter ${mailbox.provider} must return an array`);
      }
      return providerMessages
        .map(message => normalizeMailMessage(message, mailbox, { maxSnippetLength }))
        .filter(message => message.isUnread === true);
    }));

    const warnings = [];
    const merged = [];
    settled.forEach((result, index) => {
      const mailbox = mailboxes[index];
      if (result.status === 'fulfilled') {
        merged.push(...result.value);
      } else {
        warnings.push({
          mailboxId: mailbox.mailboxId,
          displayName: mailbox.displayName,
          provider: mailbox.provider,
          code: result.reason?.code || 'MAIL_PROVIDER_UNAVAILABLE',
        });
      }
    });

    const messages = merged
      .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))
      .slice(0, limit);
    const now = clock();
    const responseText = formatResponse({
      messages,
      mailboxes,
      warnings,
      parameters,
      now,
      timeZone: ownerTimezone,
    });

    return {
      status: 'success',
      data: {
        status: warnings.length === mailboxes.length ? 'unavailable' : 'available',
        summary: `Непрочитанных писем получено: ${messages.length}.`,
        responseText,
        count: messages.length,
        messages,
        warnings,
      },
      metadata: {
        source: 'mail',
        mailboxIds: mailboxes.map(mailbox => mailbox.mailboxId),
        degraded: warnings.length > 0,
      },
    };
  }

  return {
    id: 'mail',
    name: 'Arthur Mail',
    version: '1.0.0',
    capabilities: CAPABILITIES,
    readOnly: true,
    async execute(input = {}) {
      if (input.operation !== 'listUnreadMail') {
        throw new UnsupportedOperationError('mail', input.operation);
      }
      return listUnreadMail(input.parameters || {});
    },
    async health() {
      const mailboxes = mailboxRegistry.list();
      const configured = mailboxes.filter(mailbox => Boolean(getAdapter(adapters, mailbox.provider)));
      return {
        healthy: configured.length > 0,
        skill: 'mail',
        version: '1.0.0',
        configuredMailboxes: configured.length,
      };
    },
  };
}

module.exports = {
  CAPABILITIES,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_RESPONSE_LENGTH,
  createMailSkill,
  formatReceivedAt,
  formatResponse,
  normalizeLimit,
};
