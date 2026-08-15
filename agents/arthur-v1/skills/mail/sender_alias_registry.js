'use strict';

const DEFAULT_SENDER_ALIASES = Object.freeze([
  Object.freeze({
    aliasId: 'valta',
    displayName: 'Валта',
    taskName: 'Валты',
    businessContext: 'miska',
    aliases: Object.freeze(['Валта', 'Валты', 'Валте']),
    addresses: Object.freeze([]),
  }),
  Object.freeze({
    aliasId: 'premium-pet',
    displayName: 'Premium Pet',
    taskName: 'Premium Pet',
    businessContext: 'miska',
    aliases: Object.freeze(['Premium Pet']),
    addresses: Object.freeze([]),
  }),
  Object.freeze({
    aliasId: 'zoograd',
    displayName: 'Зооград',
    taskName: 'Зоограда',
    businessContext: 'miska',
    aliases: Object.freeze(['Зооград', 'Зоограда']),
    addresses: Object.freeze([]),
  }),
  Object.freeze({
    aliasId: 'onikienko',
    displayName: 'Оникиенко',
    taskName: 'Оникиенко',
    businessContext: 'miska',
    aliases: Object.freeze(['Оникиенко']),
    addresses: Object.freeze([]),
  }),
]);

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeMatchText(value) {
  return String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/gu, 'е')
    .replace(/[^\p{L}\p{N}@._+-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeAddress(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeAliasEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError('sender alias entry must be an object');
  }
  const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
  const addresses = Array.isArray(entry.addresses) ? entry.addresses : [];
  const normalizedAliases = [...new Set([
    requireNonEmptyString(entry.displayName, 'sender alias displayName'),
    ...aliases.map(alias => requireNonEmptyString(alias, 'sender alias')),
  ])];
  const normalizedAddresses = [...new Set(addresses
    .map(normalizeAddress)
    .filter(Boolean))];
  return Object.freeze({
    aliasId: requireNonEmptyString(entry.aliasId, 'sender aliasId'),
    displayName: requireNonEmptyString(entry.displayName, 'sender alias displayName'),
    taskName: requireNonEmptyString(entry.taskName || entry.displayName, 'sender alias taskName'),
    businessContext: requireNonEmptyString(entry.businessContext, 'sender alias businessContext'),
    aliases: Object.freeze(normalizedAliases),
    addresses: Object.freeze(normalizedAddresses),
  });
}

function phraseMatches(value, phrase) {
  const normalizedValue = normalizeMatchText(value);
  const normalizedPhrase = normalizeMatchText(phrase);
  if (!normalizedValue || !normalizedPhrase) return false;
  return ` ${normalizedValue} `.includes(` ${normalizedPhrase} `)
    || normalizedValue === normalizedPhrase;
}

function messageSenderValues(message) {
  return (Array.isArray(message?.from) ? message.from : []).map(sender => ({
    name: String(sender?.name || ''),
    address: normalizeAddress(sender?.address),
  }));
}

class SenderAliasRegistry {
  constructor(entries = DEFAULT_SENDER_ALIASES) {
    if (!Array.isArray(entries)) throw new TypeError('sender aliases must be an array');
    this.entries = entries.map(normalizeAliasEntry);
  }

  list() {
    return this.entries.map(entry => ({
      ...entry,
      aliases: [...entry.aliases],
      addresses: [...entry.addresses],
    }));
  }

  resolve(query) {
    const senderQuery = requireNonEmptyString(query, 'sender query');
    const normalizedQuery = normalizeMatchText(senderQuery);
    const addressQuery = senderQuery.includes('@') ? normalizeAddress(senderQuery) : null;
    const entry = this.entries.find(candidate => (
      candidate.aliases.some(alias => normalizeMatchText(alias) === normalizedQuery)
      || candidate.addresses.includes(addressQuery)
    ));

    if (!entry) {
      return Object.freeze({
        known: false,
        query: senderQuery,
        displayName: senderQuery,
        businessContext: null,
        aliases: Object.freeze([senderQuery]),
        addresses: Object.freeze(addressQuery ? [addressQuery] : []),
        searchTerm: senderQuery,
      });
    }

    return Object.freeze({
      known: true,
      query: senderQuery,
      aliasId: entry.aliasId,
      displayName: entry.displayName,
      taskName: entry.taskName,
      businessContext: entry.businessContext,
      aliases: entry.aliases,
      addresses: entry.addresses,
      searchTerm: entry.addresses[0] || entry.displayName,
    });
  }

  matchMessage(message, resolution, { allowSubjectFallback = false } = {}) {
    const resolved = resolution?.query ? resolution : this.resolve(resolution);
    const senders = messageSenderValues(message);
    if (resolved.addresses.length > 0
      && senders.some(sender => resolved.addresses.includes(sender.address))) {
      return true;
    }
    if (senders.some(sender => resolved.aliases.some(alias => phraseMatches(sender.name, alias)))) {
      return true;
    }
    if (allowSubjectFallback) {
      const subjectAliases = resolved.known ? resolved.aliases : [resolved.query];
      if (subjectAliases.some(alias => (
        normalizeMatchText(alias).length >= 5 && phraseMatches(message?.subject, alias)
      ))) return true;
    }
    return false;
  }

  findKnownSender(message) {
    return this.entries.find(entry => this.matchMessage(message, {
      known: true,
      query: entry.displayName,
      aliases: entry.aliases,
      addresses: entry.addresses,
    })) || null;
  }

  findKnownCompany(message) {
    return this.entries.find(entry => this.matchMessage(message, {
      known: true,
      query: entry.displayName,
      aliases: entry.aliases,
      addresses: entry.addresses,
    }, { allowSubjectFallback: true })) || null;
  }
}

function createSenderAliasRegistry(entries = DEFAULT_SENDER_ALIASES) {
  return new SenderAliasRegistry(entries);
}

module.exports = {
  DEFAULT_SENDER_ALIASES,
  SenderAliasRegistry,
  createSenderAliasRegistry,
  normalizeAliasEntry,
  normalizeMatchText,
  phraseMatches,
};
