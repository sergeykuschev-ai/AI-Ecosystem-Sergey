'use strict';

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { normalizeMatchText } = require('../sender_alias_registry');

const DEFAULT_FOLDER = 'INBOX';
const DEFAULT_PORT = 993;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10000;
const DEFAULT_SOCKET_TIMEOUT_MS = 30000;
const DEFAULT_MAX_MESSAGE_BYTES = 128 * 1024;
const MAX_LIMIT = 20;
const MAX_COMPANY_TERMS = 10;
const SEARCH_FILTER_KEYS = Object.freeze([
  'from',
  'subject',
  'since',
  'unreadOnly',
  'companyTerms',
]);

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function requirePositiveInteger(value, field, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${field} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function safeMailError(code, message, retryable = false) {
  const error = new Error(message);
  error.name = 'MailProviderError';
  error.code = code;
  error.retryable = retryable;
  return error;
}

function classifyMailError(error) {
  if (typeof error?.code === 'string' && error.code.startsWith('MAIL_')) return error;

  const code = String(error?.code || '').toUpperCase();
  const name = String(error?.name || '').toUpperCase();
  const responseStatus = String(error?.responseStatus || '').toUpperCase();

  if (error?.authenticationFailed === true
    || ['EAUTH', 'AUTHENTICATIONFAILED'].includes(code)
    || responseStatus.includes('AUTHENTICATIONFAILED')) {
    return safeMailError('MAIL_AUTH_FAILED', 'Mail authentication failed.');
  }
  if (['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(code) || name.includes('TIMEOUT')) {
    return safeMailError('MAIL_TIMEOUT', 'Mail provider timed out.', true);
  }
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return safeMailError('MAIL_DNS_FAILED', 'Mail provider address could not be resolved.', true);
  }
  if (code.includes('CERT') || code.includes('TLS') || name.includes('TLS')) {
    return safeMailError('MAIL_TLS_FAILED', 'Mail provider TLS validation failed.');
  }
  return safeMailError('MAIL_PROVIDER_UNAVAILABLE', 'Mail provider is unavailable.', true);
}

function findBodyPart(bodyStructure, contentType) {
  if (!bodyStructure || typeof bodyStructure !== 'object') return null;
  const disposition = String(bodyStructure.disposition || '').toLowerCase();
  if (disposition === 'attachment') return null;
  if (String(bodyStructure.type || '').toLowerCase() === contentType) {
    return bodyStructure;
  }
  for (const child of bodyStructure.childNodes || []) {
    const match = findBodyPart(child, contentType);
    if (match) return match;
  }
  return null;
}

function selectBodyPart(bodyStructure) {
  return findBodyPart(bodyStructure, 'text/plain')
    || findBodyPart(bodyStructure, 'text/html');
}

async function readBoundedStream(stream, maxBytes) {
  if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
    throw safeMailError('MAIL_MESSAGE_PARSE_FAILED', 'Mail message content is unavailable.');
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw safeMailError('MAIL_MESSAGE_TOO_LARGE', 'Mail message content exceeded the safe limit.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

function buildBoundedMimeSource(headers, content, contentType) {
  const headerText = (Buffer.isBuffer(headers) ? headers.toString('utf8') : String(headers || ''))
    .replace(/\r?\n\r?\n[\s\S]*$/u, '')
    .trimEnd();
  const mimeHeader = `${headerText}${headerText ? '\r\n' : ''}`
    + `Content-Type: ${contentType}; charset=utf-8\r\n`
    + 'Content-Transfer-Encoding: 8bit\r\n\r\n';
  return Buffer.concat([Buffer.from(mimeHeader), content]);
}

function parsedAddresses(addressObject) {
  if (!addressObject || !Array.isArray(addressObject.value)) return [];
  return addressObject.value.map(address => ({
    name: String(address.name || '').trim(),
    address: String(address.address || '').trim() || null,
  }));
}

function stableMessageId(folder, uidValidity, uid) {
  return `${folder}:${String(uidValidity)}:${String(uid)}`;
}

function normalizeSearchFilters(filters = {}) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
    throw new TypeError('mail search filters must be an object');
  }
  const unknownKeys = Object.keys(filters).filter(key => !SEARCH_FILTER_KEYS.includes(key));
  if (unknownKeys.length > 0) {
    throw new TypeError(`unsupported mail search filter: ${unknownKeys[0]}`);
  }
  const normalized = {};
  if (filters.from != null && filters.from !== '') {
    normalized.from = requireNonEmptyString(filters.from, 'mail search from');
  }
  if (filters.subject != null && filters.subject !== '') {
    normalized.subject = requireNonEmptyString(filters.subject, 'mail search subject');
  }
  if (filters.since != null && filters.since !== '') {
    const since = new Date(filters.since);
    if (Number.isNaN(since.getTime())) throw new TypeError('mail search since must be a valid date');
    normalized.since = since.toISOString();
  }
  if (filters.unreadOnly != null) {
    if (typeof filters.unreadOnly !== 'boolean') {
      throw new TypeError('mail search unreadOnly must be a boolean');
    }
    normalized.unreadOnly = filters.unreadOnly;
  }
  if (filters.companyTerms != null) {
    if (!Array.isArray(filters.companyTerms)
      || filters.companyTerms.length === 0
      || filters.companyTerms.length > MAX_COMPANY_TERMS) {
      throw new TypeError(
        `mail search companyTerms must contain between 1 and ${MAX_COMPANY_TERMS} strings`
      );
    }
    normalized.companyTerms = Object.freeze([...new Set(filters.companyTerms.map(term => (
      requireNonEmptyString(term, 'mail search company term')
    )))].slice(0, MAX_COMPANY_TERMS));
  }
  return Object.freeze(normalized);
}

function buildSearchCriteria(filters = {}) {
  const normalized = normalizeSearchFilters(filters);
  const criteria = {};
  if (normalized.from) criteria.from = normalized.from;
  if (normalized.subject) criteria.subject = normalized.subject;
  if (normalized.since) criteria.since = new Date(normalized.since);
  if (normalized.unreadOnly === true) criteria.seen = false;
  if (normalized.companyTerms) {
    const alternatives = normalized.companyTerms.flatMap(term => [
      { from: term },
      ...(term.includes('@') ? [] : [{ subject: term }]),
    ]);
    if (alternatives.length === 1) Object.assign(criteria, alternatives[0]);
    else criteria.or = alternatives;
  }
  return criteria;
}

function companyTermMatchesMessage(message, term) {
  const normalizedTerm = normalizeMatchText(term);
  const isEmail = term.includes('@');
  const senderMatches = (Array.isArray(message.from) ? message.from : []).some(sender => {
    const address = String(sender?.address || '').trim().toLowerCase();
    if (isEmail) return address === term.toLowerCase();
    return normalizeMatchText(sender?.name).includes(normalizedTerm)
      || normalizeMatchText(address).includes(normalizedTerm);
  });
  if (senderMatches) return true;
  return !isEmail && normalizeMatchText(message.subject).includes(normalizedTerm);
}

function messageMatchesFilters(message, filters = {}) {
  const normalized = normalizeSearchFilters(filters);
  if (normalized.unreadOnly === true && message.isUnread !== true) return false;
  if (normalized.since && Date.parse(message.receivedAt) < Date.parse(normalized.since)) return false;
  if (normalized.from) {
    const normalizedFrom = normalizeMatchText(normalized.from);
    const isEmail = normalized.from.includes('@');
    const matches = (Array.isArray(message.from) ? message.from : []).some(sender => {
      const address = String(sender?.address || '').trim().toLowerCase();
      if (isEmail) return address === normalized.from.toLowerCase();
      return normalizeMatchText(sender?.name).includes(normalizedFrom)
        || normalizeMatchText(address).includes(normalizedFrom);
    });
    if (!matches) return false;
  }
  if (normalized.subject
    && !normalizeMatchText(message.subject).includes(normalizeMatchText(normalized.subject))) {
    return false;
  }
  if (normalized.companyTerms
    && !normalized.companyTerms.some(term => companyTermMatchesMessage(message, term))) {
    return false;
  }
  return true;
}

async function parseFetchedMessage({
  client,
  message,
  folder,
  uidValidity,
  maxMessageBytes,
  parseMessage,
}) {
  try {
    const bodyPart = selectBodyPart(message.bodyStructure);
    let content = Buffer.alloc(0);
    let contentType = 'text/plain';

    if (bodyPart) {
      contentType = String(bodyPart.type || 'text/plain').toLowerCase();
      const download = await client.download(message.uid, bodyPart.part, {
        uid: true,
        maxBytes: maxMessageBytes,
      });
      content = await readBoundedStream(download?.content, maxMessageBytes);
    }

    const parsed = await parseMessage(
      buildBoundedMimeSource(message.headers, content, contentType),
      {
        skipHtmlToText: false,
        skipTextToHtml: true,
        skipImageLinks: true,
        maxHtmlLengthToParse: maxMessageBytes,
      }
    );
    const receivedAt = parsed.date || message.envelope?.date || message.internalDate;
    if (!(receivedAt instanceof Date) || Number.isNaN(receivedAt.getTime())) {
      throw new TypeError('missing valid message date');
    }
    const messageId = stableMessageId(folder, uidValidity, message.uid);

    return {
      messageId,
      threadId: null,
      from: parsedAddresses(parsed.from),
      to: parsedAddresses(parsed.to),
      subject: String(parsed.subject || ''),
      receivedAt: receivedAt.toISOString(),
      snippet: String(parsed.text || ''),
      isUnread: !(message.flags instanceof Set) || !message.flags.has('\\Seen'),
      labels: [],
      folder,
      sourceRef: `imap:${messageId}`,
    };
  } catch (error) {
    if (typeof error?.code === 'string' && error.code.startsWith('MAIL_')) throw error;
    throw safeMailError('MAIL_MESSAGE_PARSE_FAILED', 'Mail message could not be parsed.');
  }
}

function createIMAPAdapter(options = {}) {
  const provider = requireNonEmptyString(options.provider || 'imap', 'provider');
  const host = requireNonEmptyString(options.host, 'host');
  const port = requirePositiveInteger(options.port ?? DEFAULT_PORT, 'port', 65535);
  if (options.secure !== true) {
    throw new TypeError('secure must be true for the IMAP adapter');
  }
  const folder = requireNonEmptyString(options.folder || DEFAULT_FOLDER, 'folder');
  const username = requireNonEmptyString(options.username, 'username');
  const password = requireNonEmptyString(options.password, 'password');
  const connectionTimeoutMs = requirePositiveInteger(
    options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS,
    'connectionTimeoutMs'
  );
  const socketTimeoutMs = requirePositiveInteger(
    options.socketTimeoutMs ?? DEFAULT_SOCKET_TIMEOUT_MS,
    'socketTimeoutMs'
  );
  const maxMessageBytes = requirePositiveInteger(
    options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES,
    'maxMessageBytes'
  );
  const clientFactory = options.clientFactory || (config => new ImapFlow(config));
  const parseMessage = options.parseMessage || simpleParser;

  async function readMessages({ limit = 10, filters = {} } = {}) {
    requirePositiveInteger(limit, 'limit', MAX_LIMIT);
    const normalizedFilters = normalizeSearchFilters(filters);
    const searchCriteria = buildSearchCriteria(normalizedFilters);
    const client = clientFactory({
      host,
      port,
      secure: true,
      auth: { user: username, pass: password },
      tls: {
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
      },
      connectionTimeout: connectionTimeoutMs,
      socketTimeout: socketTimeoutMs,
      disableAutoIdle: true,
      logger: false,
      logRaw: false,
      emitLogs: false,
    });
    let connected = false;

    try {
      await client.connect();
      connected = true;
      const openedMailbox = await client.mailboxOpen(folder, { readOnly: true });
      const uidValidity = openedMailbox?.uidValidity ?? client.mailbox?.uidValidity;
      if (uidValidity == null) {
        throw safeMailError('MAIL_PROTOCOL_ERROR', 'Mail provider did not return UIDVALIDITY.');
      }

      const matchedUids = await client.search(searchCriteria, { uid: true });
      if (!Array.isArray(matchedUids) || matchedUids.length === 0) return [];
      const boundedUids = matchedUids.slice(-limit);
      const fetched = await client.fetchAll(boundedUids, {
        uid: true,
        flags: true,
        envelope: true,
        internalDate: true,
        bodyStructure: true,
        headers: ['from', 'to', 'subject', 'date'],
      }, { uid: true });
      if (!Array.isArray(fetched)) {
        throw safeMailError('MAIL_PROTOCOL_ERROR', 'Mail provider returned an invalid response.');
      }

      const messages = [];
      for (const message of fetched.slice(0, limit)) {
        messages.push(await parseFetchedMessage({
          client,
          message,
          folder,
          uidValidity,
          maxMessageBytes,
          parseMessage,
        }));
      }
      return messages
        .filter(message => messageMatchesFilters(message, normalizedFilters))
        .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))
        .slice(0, limit);
    } catch (error) {
      throw classifyMailError(error);
    } finally {
      if (connected && typeof client.logout === 'function') {
        await client.logout().catch(() => {});
      } else if (typeof client.close === 'function') {
        client.close();
      }
    }
  }

  async function listUnreadMail({ limit = 10 } = {}) {
    return readMessages({ limit, filters: { unreadOnly: true } });
  }

  async function listRecentMail({ limit = 10, since } = {}) {
    if (since == null || since === '') throw new TypeError('recent mail since is required');
    return readMessages({ limit, filters: { since } });
  }

  async function searchMail({ limit = 10, filters = {} } = {}) {
    if (!filters || typeof filters !== 'object' || Object.keys(filters).length === 0) {
      throw new TypeError('mail search requires at least one safe filter');
    }
    return readMessages({ limit, filters });
  }

  return Object.freeze({
    provider,
    listUnreadMail,
    listRecentMail,
    searchMail,
  });
}

module.exports = {
  DEFAULT_CONNECTION_TIMEOUT_MS,
  DEFAULT_FOLDER,
  DEFAULT_MAX_MESSAGE_BYTES,
  DEFAULT_PORT,
  MAX_COMPANY_TERMS,
  DEFAULT_SOCKET_TIMEOUT_MS,
  MAX_LIMIT,
  SEARCH_FILTER_KEYS,
  buildSearchCriteria,
  buildBoundedMimeSource,
  classifyMailError,
  createIMAPAdapter,
  findBodyPart,
  messageMatchesFilters,
  normalizeSearchFilters,
  readBoundedStream,
  selectBodyPart,
  stableMessageId,
};
