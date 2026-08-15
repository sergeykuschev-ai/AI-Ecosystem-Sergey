'use strict';

function cloneMessage(message) {
  return {
    ...message,
    from: Array.isArray(message.from) ? message.from.map(address => ({ ...address })) : message.from,
    to: Array.isArray(message.to) ? message.to.map(address => ({ ...address })) : message.to,
    labels: Array.isArray(message.labels) ? [...message.labels] : message.labels,
  };
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
    this.calls.push({ mailboxId: mailbox?.mailboxId || null, limit });
    if (this.error) throw this.error;
    return this.messages
      .filter(message => message.isUnread === true)
      .slice(0, limit)
      .map(cloneMessage);
  }
}

module.exports = {
  FakeMailAdapter,
  cloneMessage,
};
