'use strict';

const { extractDueDate, temporalContext } = require('./task_request_parser');
const { createSenderAliasRegistry } = require('../skills/mail/sender_alias_registry');

const ARTHUR_ADDRESS_PREFIX = /^\s*артур\s*[,!:.-]?\s*/iu;
const WAITING_PREFIX = /^(?:запомни\s*,\s*)?что\s+жду\s+|жду\s+ответ\s+|жду\s+/iu;
const TOPIC_SEPARATOR = /\s+по\s+/iu;
const WORD_BOUNDARY_BEFORE = '(?<![\\p{L}\\p{N}])';
const WORD_BOUNDARY_AFTER = '(?![\\p{L}\\p{N}])';

const DEFAULT_WAITING_CHECK_OFFSET_MS = 24 * 60 * 60 * 1000;
const ALIAS_PREFIX_MATCH_LENGTH = 4;

function cleanTitle(text) {
  const cleaned = String(text || '')
    .replace(/^[\s,.:;!?—-]+|[\s,.:;!?—-]+$/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.charAt(0).toLocaleUpperCase('ru-RU') + cleaned.slice(1);
}

function normalizeText(value) {
  return String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/gu, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s{2,}/g, ' ');
}

function commonPrefixLength(left, right) {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function resolveCompanyByPrefix(candidate, aliasRegistry) {
  const normalizedCandidate = normalizeText(candidate);
  if (!normalizedCandidate) return null;
  const entries = aliasRegistry.list ? aliasRegistry.list() : [];
  for (const entry of entries) {
    for (const alias of entry.aliases) {
      const normalizedAlias = normalizeText(alias);
      if (
        normalizedAlias.startsWith(normalizedCandidate)
        || normalizedCandidate.startsWith(normalizedAlias)
        || commonPrefixLength(normalizedCandidate, normalizedAlias) >= ALIAS_PREFIX_MATCH_LENGTH
      ) {
        return entry.displayName;
      }
    }
  }
  return null;
}

function extractCompanyAndTopic(subject, aliasRegistry) {
  const afterOt = subject.replace(/^от\s+/iu, '').trim();
  const words = afterOt.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  let company = null;
  let companyWordCount = 0;
  for (let i = Math.min(words.length, 4); i >= 1; i -= 1) {
    const candidate = words.slice(0, i).join(' ');
    const resolved = aliasRegistry.resolve(candidate);
    if (resolved.known) {
      company = resolved.displayName;
      companyWordCount = i;
      break;
    }
  }

  if (!company) {
    for (let i = Math.min(words.length, 4); i >= 1; i -= 1) {
      const candidate = words.slice(0, i).join(' ');
      const prefixMatch = resolveCompanyByPrefix(candidate, aliasRegistry);
      if (prefixMatch) {
        company = prefixMatch;
        companyWordCount = i;
        break;
      }
    }
  }

  if (!company) {
    company = cleanTitle(words[0]);
    companyWordCount = 1;
  }

  const rest = words.slice(companyWordCount).join(' ').trim();
  const topicMatch = rest.match(/^по\s+(.+)$/iu);
  if (topicMatch) {
    return { company, topic: topicMatch[1], topicPrefix: 'по' };
  }
  if (rest) {
    return { company, topic: rest, topicPrefix: null };
  }
  return { company, topic: null, topicPrefix: null };
}

function buildWaitingTitle(waitingFor, topic, topicPrefix, originalLower) {
  const hasAnswer = new RegExp(`${WORD_BOUNDARY_BEFORE}ответ${WORD_BOUNDARY_AFTER}`, 'iu').test(originalLower);
  const hasFrom = new RegExp(`${WORD_BOUNDARY_BEFORE}от${WORD_BOUNDARY_AFTER}`, 'iu').test(originalLower);
  const parts = ['Ждать'];
  if (hasAnswer) parts.push('ответ');
  if (hasFrom) parts.push('от');
  parts.push(waitingFor);
  if (topic) {
    parts.push(topicPrefix ? `${topicPrefix} ${topic}` : topic);
  }
  return cleanTitle(parts.join(' '));
}

function matchesWaitingTaskIntent(message) {
  if (typeof message !== 'string') return false;
  const trimmed = message.replace(ARTHUR_ADDRESS_PREFIX, '').trim();
  return WAITING_PREFIX.test(trimmed);
}

function parseWaitingRequest(message, options = {}) {
  if (typeof message !== 'string') return { ok: false, clarification: 'Не понял, от кого ждёшь ответ.' };

  const trimmed = message.replace(ARTHUR_ADDRESS_PREFIX, '').trim();
  if (!trimmed) return { ok: false, clarification: 'Не понял, от кого ждёшь ответ.' };

  if (!WAITING_PREFIX.test(trimmed)) {
    return { ok: false, clarification: 'Не понял, от кого ждёшь ответ.' };
  }

  const context = temporalContext(options);
  const dateResult = extractDueDate(trimmed, context);
  if (!dateResult.ok) return dateResult;

  let remainder = dateResult.remainder.trim();
  remainder = remainder.replace(WAITING_PREFIX, '').trim();

  if (!remainder) return { ok: false, clarification: 'Уточни, от кого ждёшь ответ.' };

  const aliasRegistry = options.aliasRegistry || createSenderAliasRegistry();
  const extracted = extractCompanyAndTopic(remainder, aliasRegistry);
  if (!extracted) return { ok: false, clarification: 'Не удалось определить, от кого ждёшь ответ.' };

  const { company: waitingFor, topic, topicPrefix } = extracted;
  const originalLower = trimmed.toLocaleLowerCase('ru-RU');
  const title = buildWaitingTitle(waitingFor, topic, topicPrefix, originalLower);
  const description = topic ? `topic: ${topic}` : null;

  const explicitCheckAt = dateResult.dueAt || null;
  const dueLabel = explicitCheckAt ? dateResult.dueLabel : null;
  const nextCheckAt = explicitCheckAt || null;

  return {
    ok: true,
    task: {
      title,
      status: 'waiting',
      waitingFor,
      ...(description ? { description } : {}),
      nextCheckAt,
      ...(dueLabel ? { dueLabel } : {}),
    },
  };
}

function waitingRequestHasExplicitCheckAt(result) {
  return result.ok && Boolean(result.task?.dueLabel);
}

function formatWaitingResponse(task) {
  const topic = task.description?.replace(/^topic:\s*/iu, '');
  const lines = [`Запомнил. Ждём ответ от ${task.waitingFor}${topic ? ` по ${topic}` : ''}.`];
  if (task.dueLabel) lines.push(`Проверить: ${task.dueLabel}.`);
  return lines.join('\n');
}

function formatDuplicateWaitingResponse(task) {
  const topic = task.description?.replace(/^topic:\s*/iu, '');
  return `Такое ожидание уже есть:\n${task.waitingFor}${topic ? ` — по ${topic}` : ''}.`;
}

function normalizeWaitingForDuplicate(value) {
  return normalizeText(value);
}

function normalizeTopicDuplicate(description) {
  if (!description) return '';
  const topic = String(description).replace(/^topic:\s*/iu, '');
  return normalizeText(topic);
}

function isDuplicateWaitingTask(existing, parameters) {
  if (existing.status !== 'waiting') return false;
  if (!parameters.waitingFor) return false;
  return normalizeWaitingForDuplicate(existing.waitingFor) === normalizeWaitingForDuplicate(parameters.waitingFor)
    && normalizeTopicDuplicate(existing.description) === normalizeTopicDuplicate(parameters.description);
}

function defaultNextCheckAt(now) {
  return new Date(now.getTime() + DEFAULT_WAITING_CHECK_OFFSET_MS).toISOString();
}

module.exports = {
  DEFAULT_WAITING_CHECK_OFFSET_MS,
  buildWaitingTitle,
  defaultNextCheckAt,
  formatDuplicateWaitingResponse,
  formatWaitingResponse,
  isDuplicateWaitingTask,
  matchesWaitingTaskIntent,
  parseWaitingRequest,
  waitingRequestHasExplicitCheckAt,
};
