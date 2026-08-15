'use strict';

const DEFAULT_MAILBOXES = Object.freeze([
  Object.freeze({
    mailboxId: 'personal-gmail',
    provider: 'gmail',
    accountType: 'personal',
    businessContext: 'personal',
    displayName: 'Личная почта',
  }),
  Object.freeze({
    mailboxId: 'miska-yandex',
    provider: 'yandex',
    accountType: 'work',
    businessContext: 'miska',
    displayName: 'Почта Миски',
  }),
]);

const REQUIRED_FIELDS = Object.freeze([
  'mailboxId',
  'provider',
  'accountType',
  'businessContext',
  'displayName',
]);

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`mailbox.${field} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeMailbox(mailbox) {
  if (!mailbox || typeof mailbox !== 'object' || Array.isArray(mailbox)) {
    throw new TypeError('mailbox must be an object');
  }

  const normalized = {};
  for (const field of REQUIRED_FIELDS) {
    normalized[field] = requireNonEmptyString(mailbox[field], field);
  }
  return Object.freeze(normalized);
}

class MailboxRegistry {
  constructor(mailboxes = DEFAULT_MAILBOXES) {
    if (!Array.isArray(mailboxes) || mailboxes.length === 0) {
      throw new TypeError('mailboxes must be a non-empty array');
    }

    this.mailboxes = new Map();
    for (const mailbox of mailboxes) {
      const normalized = normalizeMailbox(mailbox);
      if (this.mailboxes.has(normalized.mailboxId)) {
        throw new Error(`Duplicate mailboxId: ${normalized.mailboxId}`);
      }
      this.mailboxes.set(normalized.mailboxId, normalized);
    }
  }

  list() {
    return Array.from(this.mailboxes.values(), mailbox => ({ ...mailbox }));
  }

  get(mailboxId) {
    const normalizedId = requireNonEmptyString(mailboxId, 'mailboxId');
    const mailbox = this.mailboxes.get(normalizedId);
    return mailbox ? { ...mailbox } : null;
  }

  select({ mailboxId, businessContext } = {}) {
    if (mailboxId != null && String(mailboxId).trim() !== '') {
      const mailbox = this.get(mailboxId);
      if (!mailbox) throw new Error(`Mailbox not found: ${String(mailboxId).trim()}`);
      return [mailbox];
    }

    if (businessContext != null && String(businessContext).trim() !== '') {
      const normalizedContext = String(businessContext).trim();
      return this.list().filter(mailbox => mailbox.businessContext === normalizedContext);
    }

    return this.list();
  }
}

function createMailboxRegistry(mailboxes = DEFAULT_MAILBOXES) {
  return new MailboxRegistry(mailboxes);
}

module.exports = {
  DEFAULT_MAILBOXES,
  REQUIRED_FIELDS,
  MailboxRegistry,
  createMailboxRegistry,
  normalizeMailbox,
};
