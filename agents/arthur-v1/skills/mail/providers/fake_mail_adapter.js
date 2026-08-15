'use strict';

const { normalizeMatchText } = require('../sender_alias_registry');

function cloneMessage(message) {
  return {
    ...message,
    from: Array.isArray(message.from) ? message.from.map(address => ({ ...address })) : message.from,
    to: Array.isArray(message.to) ? message.to.map(address => ({ ...address })) : message.to,
    labels: Array.isArray(message.labels) ? [...message.labels] : message.labels,
  };
}

function includesNormalized(value, query) {
  const normalizedQuery = normalizeMatchText(query);
  return normalizedQuery !== '' && normalizeMatchText(value).includes(normalizedQuery);
}

function filterMessages(messages, filters = {}) {
  const since = filters.since ? Date.parse(filters.since) : null;
  return messages.filter(message => {
    if (filters.unreadOnly === true && message.isUnread !== true) return false;
    if (since != null && Date.parse(message.receivedAt) < since) return false;
    if (filters.from) {
      const senderMatch = (Array.isArray(message.from) ? message.from : []).some(sender => (
        includesNormalized(sender?.name, filters.from)
        || includesNormalized(sender?.address, filters.from)
      ));
      if (!senderMatch) return false;
    }
    if (filters.subject && !includesNormalized(message.subject, filters.subject)) return false;
    if (filters.companyTerms) {
      const companyMatch = filters.companyTerms.some(term => {
        const senderMatch = (Array.isArray(message.from) ? message.from : []).some(sender => (
          term.includes('@')
            ? String(sender?.address || '').trim().toLowerCase() === term.toLowerCase()
            : includesNormalized(sender?.name, term) || includesNormalized(sender?.address, term)
        ));
        return senderMatch || (!term.includes('@') && includesNormalized(message.subject, term));
      });
      if (!companyMatch) return false;
    }
    return true;
  });
}

class FakeMailAdapter {
  constructor({ provider, messages = [], error = null } = {}) {
    if (typeof provider !== 'string' || provider.trim() === '') {
      throw new TypeError('Fake mail adapter provider is required');
    }
    if (!Array.isArray(messages)) throw new TypeError('Fake mail adapter messages must be an array');
    this.provider = provider.trim();
    this.messages = messages.map(cloneMessage);
    this.error = error;
    this.calls = [];
  }

  async listUnreadMail({ mailbox, limit } = {}) {
    this.calls.push({ operation: 'listUnreadMail', mailboxId: mailbox?.mailboxId || null, limit });
    if (this.error) throw this.error;
    return filterMessages(this.messages, { unreadOnly: true })
      .slice(0, limit)
      .map(cloneMessage);
  }

  async listRecentMail({ mailbox, limit, since } = {}) {
    this.calls.push({
      operation: 'listRecentMail',
      mailboxId: mailbox?.mailboxId || null,
      limit,
      since,
    });
    if (this.error) throw this.error;
    return filterMessages(this.messages, { since })
      .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))
      .slice(0, limit)
      .map(cloneMessage);
  }

  async searchMail({ mailbox, limit, filters = {} } = {}) {
    this.calls.push({
      operation: 'searchMail',
      mailboxId: mailbox?.mailboxId || null,
      limit,
      filters: { ...filters },
    });
    if (this.error) throw this.error;
    return filterMessages(this.messages, filters)
      .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))
      .slice(0, limit)
      .map(cloneMessage);
  }
}

module.exports = {
  FakeMailAdapter,
  cloneMessage,
  filterMessages,
};
