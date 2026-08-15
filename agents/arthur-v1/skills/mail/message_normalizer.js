'use strict';

const DEFAULT_MAX_SNIPPET_LENGTH = 240;

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`mail message ${field} must be a non-empty string`);
  }
  return value.trim();
}

function boundedText(value, maxLength) {
  const normalized = String(value || '').replace(/\s+/gu, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeAddress(address) {
  if (typeof address === 'string') {
    return Object.freeze({ name: '', address: address.trim() || null });
  }
  if (!address || typeof address !== 'object' || Array.isArray(address)) {
    throw new TypeError('mail address must be a string or object');
  }
  return Object.freeze({
    name: String(address.name || '').trim(),
    address: String(address.address || '').trim() || null,
  });
}

function normalizeAddresses(value) {
  if (value == null) return Object.freeze([]);
  const addresses = Array.isArray(value) ? value : [value];
  return Object.freeze(addresses.map(normalizeAddress));
}

function normalizeLabels(value) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError('mail message labels must be an array');
  return Object.freeze([...new Set(value.map(label => String(label).trim()).filter(Boolean))]);
}

function normalizeMailMessage(message, mailbox, options = {}) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new TypeError('mail message must be an object');
  }
  if (!mailbox || typeof mailbox !== 'object') {
    throw new TypeError('mailbox is required to normalize a message');
  }

  const receivedAt = new Date(message.receivedAt);
  if (Number.isNaN(receivedAt.getTime())) {
    throw new TypeError('mail message receivedAt must be a valid date');
  }
  if (typeof message.isUnread !== 'boolean') {
    throw new TypeError('mail message isUnread must be a boolean');
  }

  const maxSnippetLength = options.maxSnippetLength ?? DEFAULT_MAX_SNIPPET_LENGTH;
  if (!Number.isInteger(maxSnippetLength) || maxSnippetLength < 1) {
    throw new RangeError('maxSnippetLength must be a positive integer');
  }

  return Object.freeze({
    messageId: requireNonEmptyString(message.messageId, 'messageId'),
    threadId: message.threadId == null || String(message.threadId).trim() === ''
      ? null
      : String(message.threadId).trim(),
    mailboxId: requireNonEmptyString(mailbox.mailboxId, 'mailboxId'),
    provider: requireNonEmptyString(mailbox.provider, 'provider'),
    from: normalizeAddresses(message.from),
    to: normalizeAddresses(message.to),
    subject: boundedText(message.subject, 500),
    receivedAt: receivedAt.toISOString(),
    snippet: boundedText(message.snippet, maxSnippetLength),
    isUnread: message.isUnread,
    labels: normalizeLabels(message.labels),
    folder: message.folder == null || String(message.folder).trim() === ''
      ? null
      : String(message.folder).trim(),
    sourceRef: requireNonEmptyString(message.sourceRef, 'sourceRef'),
  });
}

module.exports = {
  DEFAULT_MAX_SNIPPET_LENGTH,
  boundedText,
  normalizeAddress,
  normalizeAddresses,
  normalizeMailMessage,
};
