'use strict';

const { zonedDateTimeToIso } = require('./task_request_parser');
const { createSenderAliasRegistry } = require('../skills/mail/sender_alias_registry');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SEARCH_WINDOW_DAYS = 30;
const DEFAULT_SENDER_WINDOW_DAYS = 7;
const DEFAULT_RECENT_WINDOW_HOURS = 24;

function normalizedMessage(message) {
  return String(message || '').toLocaleLowerCase('ru-RU').replace(/ё/gu, 'е');
}

function mailBusinessContext(message) {
  return normalizedMessage(message).includes('миск') ? 'miska' : null;
}

function matchesImportantMailIntent(message) {
  const normalized = normalizedMessage(message);
  return /(важн\p{L}*)/u.test(normalized)
    && /(почт\p{L}*|письм\p{L}*)/u.test(normalized)
    && /миск/u.test(normalized);
}

function extractSenderQuery(message) {
  if (typeof message !== 'string') return null;
  const match = message.match(
    /(?:ответ\p{L}*|письм\p{L}*)\s+от\s+(.+?)(?=\s+(?:за|с)\s+(?:сегодня|последн\p{L}*|недел\p{L}*|\d+)|[?!.]|$)/iu
  );
  return match?.[1]?.replace(/[«»"']/gu, '').trim() || null;
}

function matchesSenderMailIntent(message) {
  return Boolean(extractSenderQuery(message));
}

function extractSubjectQuery(message) {
  if (typeof message !== 'string') return null;
  const match = message.match(
    /(?:с\s+темой|по\s+теме|тема)\s*[«"']?(.+?)[»"']?(?=\s+(?:за|с)\s+(?:сегодня|последн\p{L}*|недел\p{L}*|\d+)|[?!.]|$)/iu
  );
  return match?.[1]?.trim() || null;
}

function matchesSearchMailIntent(message) {
  const normalized = normalizedMessage(message);
  return Boolean(extractSubjectQuery(message))
    && /(найд\p{L}*|покаж\p{L}*|ищ\p{L}*)/u.test(normalized)
    && /(почт\p{L}*|письм\p{L}*)/u.test(normalized);
}

function matchesRecentMailIntent(message) {
  const normalized = normalizedMessage(message);
  if (!/(почт\p{L}*|письм\p{L}*)/u.test(normalized)) return false;
  return /(последн\p{L}*|недавн\p{L}*)/u.test(normalized)
    || /(?:за\s+)?(?:последн\p{L}*\s+)?24\s*час/u.test(normalized);
}

function timezoneDateParts(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
  };
}

function startOfTodayIso(now, timezone) {
  return zonedDateTimeToIso({
    ...timezoneDateParts(now, timezone),
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  }, timezone);
}

function sinceFromMessage(message, {
  now,
  timezone,
  defaultWindowMs,
} = {}) {
  const normalized = normalizedMessage(message);
  if (/сегодня/u.test(normalized)) return startOfTodayIso(now, timezone);
  const daysMatch = normalized.match(/(?:за\s+)?(?:последн\p{L}*\s+)?(\d{1,2})\s*дн/u);
  if (daysMatch) return new Date(now.getTime() - Number(daysMatch[1]) * DAY_MS).toISOString();
  if (/(?:за\s+)?недел\p{L}*/u.test(normalized)) {
    return new Date(now.getTime() - DEFAULT_SENDER_WINDOW_DAYS * DAY_MS).toISOString();
  }
  const hoursMatch = normalized.match(/(?:за\s+)?(?:последн\p{L}*\s+)?(\d{1,3})\s*час/u);
  if (hoursMatch) return new Date(now.getTime() - Number(hoursMatch[1]) * 60 * 60 * 1000).toISOString();
  return new Date(now.getTime() - defaultWindowMs).toISOString();
}

function importantMailParameters(message, options = {}) {
  const now = options.now || new Date();
  const timezone = options.timezone || 'Asia/Vladivostok';
  return {
    businessContext: 'miska',
    since: startOfTodayIso(now, timezone),
    limit: 20,
    view: 'important',
  };
}

function recentMailParameters(message, options = {}) {
  const now = options.now || new Date();
  const timezone = options.timezone || 'Asia/Vladivostok';
  return {
    ...(mailBusinessContext(message) ? { businessContext: 'miska' } : {}),
    since: sinceFromMessage(message, {
      now,
      timezone,
      defaultWindowMs: DEFAULT_RECENT_WINDOW_HOURS * 60 * 60 * 1000,
    }),
  };
}

function senderMailParameters(message, options = {}) {
  const sender = extractSenderQuery(message);
  if (!sender) throw new TypeError('sender query is required');
  const now = options.now || new Date();
  const timezone = options.timezone || 'Asia/Vladivostok';
  const aliasRegistry = options.aliasRegistry || createSenderAliasRegistry();
  const resolved = aliasRegistry.resolve(sender);
  const normalized = normalizedMessage(message);
  const lastOnly = /последн\p{L}*|приш\p{L}*\s+ответ|есть\s+письм/u.test(normalized);
  return {
    sender,
    ...(mailBusinessContext(message) || resolved.businessContext
      ? { businessContext: mailBusinessContext(message) || resolved.businessContext }
      : {}),
    since: sinceFromMessage(message, {
      now,
      timezone,
      defaultWindowMs: DEFAULT_SENDER_WINDOW_DAYS * DAY_MS,
    }),
    limit: lastOnly ? 1 : 10,
  };
}

function searchMailParameters(message, options = {}) {
  const subject = extractSubjectQuery(message);
  if (!subject) throw new TypeError('mail subject query is required');
  const now = options.now || new Date();
  const timezone = options.timezone || 'Asia/Vladivostok';
  return {
    subject,
    ...(mailBusinessContext(message) ? { businessContext: 'miska' } : {}),
    since: sinceFromMessage(message, {
      now,
      timezone,
      defaultWindowMs: DEFAULT_SEARCH_WINDOW_DAYS * DAY_MS,
    }),
  };
}

module.exports = {
  DAY_MS,
  DEFAULT_RECENT_WINDOW_HOURS,
  DEFAULT_SEARCH_WINDOW_DAYS,
  DEFAULT_SENDER_WINDOW_DAYS,
  extractSenderQuery,
  extractSubjectQuery,
  importantMailParameters,
  mailBusinessContext,
  matchesImportantMailIntent,
  matchesRecentMailIntent,
  matchesSearchMailIntent,
  matchesSenderMailIntent,
  recentMailParameters,
  searchMailParameters,
  senderMailParameters,
  sinceFromMessage,
  startOfTodayIso,
};
