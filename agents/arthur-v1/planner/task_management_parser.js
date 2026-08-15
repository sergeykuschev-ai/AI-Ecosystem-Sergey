'use strict';

const {
  DEFAULT_OWNER_TIMEZONE,
  parseTaskDueExpression,
} = require('./task_request_parser');

const TASK_MANAGEMENT_ACTIONS = Object.freeze({
  COMPLETE: 'complete',
  CANCEL: 'cancel',
  RESCHEDULE: 'reschedule',
});

const PAST_ACTIONS = Object.freeze(new Map([
  ['позвонил', 'позвонить'],
  ['проверил', 'проверить'],
  ['купил', 'купить'],
  ['подготовил', 'подготовить'],
  ['написал', 'написать'],
  ['записался', 'записаться'],
  ['заказал', 'заказать'],
  ['оплатил', 'оплатить'],
  ['отправил', 'отправить'],
  ['забрал', 'забрать'],
  ['получил', 'получить'],
  ['уточнил', 'уточнить'],
  ['согласовал', 'согласовать'],
  ['обсудил', 'обсудить'],
  ['встретился', 'встретиться'],
  ['передал', 'передать'],
  ['договорился', 'договориться'],
  ['заполнил', 'заполнить'],
  ['собрал', 'собрать'],
  ['оформил', 'оформить'],
  ['обновил', 'обновить'],
  ['исправил', 'исправить'],
]));

const ARTHUR_ADDRESS_PREFIX = /^\s*артур\s*[,!:.-]?\s*/iu;
const UNSAFE_CONTEXT = /[\r\n?？"'«»„“]/u;
const DISCUSSION_PREFIX = /^\s*(?:как|почему|зачем|стоит\s+ли|можно\s+ли|следует\s+ли)(?![\p{L}\p{N}])/iu;
const CLARIFICATION_SELECTIONS = Object.freeze(new Map([
  ['первая', 1],
  ['первую', 1],
  ['вторая', 2],
  ['вторую', 2],
  ['третья', 3],
  ['третью', 3],
]));
const CLARIFICATION_CANCEL_WORDS = Object.freeze(new Set([
  'не надо',
  'отмена',
  'отбой',
]));

function cleanReference(value) {
  const cleaned = String(value || '')
    .replace(/^[\s,.:;!?—-]+|[\s,.:;!?—-]+$/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.charAt(0).toLocaleUpperCase('ru-RU') + cleaned.slice(1);
}

function canonicalTaskReference(value) {
  let cleaned = cleanReference(value);
  if (!cleaned) return '';

  const callMatch = cleaned.match(/^звонок\s+(.+)$/iu);
  if (callMatch) cleaned = `Позвонить ${callMatch[1]}`;

  const firstWord = cleaned.match(/^[\p{L}-]+/u)?.[0];
  const infinitive = firstWord && PAST_ACTIONS.get(firstWord.toLocaleLowerCase('ru-RU'));
  if (infinitive) cleaned = `${infinitive}${cleaned.slice(firstWord.length)}`;
  return cleanReference(cleaned);
}

function safeMessage(message) {
  if (typeof message !== 'string') return '';
  const trimmed = message.replace(ARTHUR_ADDRESS_PREFIX, '').trim();
  if (!trimmed || UNSAFE_CONTEXT.test(trimmed) || DISCUSSION_PREFIX.test(trimmed)) return '';
  return trimmed;
}

function completeMatch(message) {
  const past = message.match(/^я\s+([\p{L}-]+)(?:\s+(.+))$/iu);
  if (past && PAST_ACTIONS.has(past[1].toLocaleLowerCase('ru-RU')) && past[2]) {
    return canonicalTaskReference(`${past[1]} ${past[2]}`);
  }

  if (/^(?:(?:выполнил|завершил|закрой|заверши)(?:\s+задачу)?|отметь\s+задачу\s+как\s+выполненную)$/iu
    .test(message)) return null;

  const patterns = [
    /^задача\s+(.+?)\s+(?:выполнена|завершена)$/iu,
    /^(?:выполнил|завершил|закрой|заверши)\s+(?:задачу\s+)?(.+)$/iu,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) return canonicalTaskReference(match[1]);
  }
  return undefined;
}

function cancelMatch(message) {
  if (/^(?:отмени|удали)(?:\s+задачу)?$/iu.test(message)) return null;
  const match = message.match(/^(?:отмени|удали)\s+задачу\s+(.+)$/iu);
  return match ? canonicalTaskReference(match[1]) : undefined;
}

function rescheduleMatch(message) {
  const patterns = [
    /^перенеси\s+(?:задачу\s+)?(.+)\s+на\s+(.+)$/iu,
    /^(.+)\s+перенеси\s+на\s+(.+)$/iu,
    /^измени\s+срок\s+задачи\s+(.+)\s+на\s+(.+)$/iu,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return {
        title: canonicalTaskReference(match[1]),
        dueExpression: cleanReference(match[2]),
      };
    }
  }
  return null;
}

function detectTaskManagementAction(message) {
  const safe = safeMessage(message);
  if (!safe) return null;
  if (completeMatch(safe) !== undefined) return TASK_MANAGEMENT_ACTIONS.COMPLETE;
  if (cancelMatch(safe) !== undefined) return TASK_MANAGEMENT_ACTIONS.CANCEL;
  if (rescheduleMatch(safe)) return TASK_MANAGEMENT_ACTIONS.RESCHEDULE;
  return null;
}

function clarification(message, metadata = {}) {
  return { ok: false, clarification: message, ...metadata };
}

function selector(title) {
  return /^\d+$/u.test(title)
    ? { taskNumber: Number(title) }
    : { title };
}

function parseTaskManagementRequest(message, options = {}) {
  const safe = safeMessage(message);
  const action = options.action || detectTaskManagementAction(message);
  if (!safe || !action) return clarification('Не понял, какую задачу нужно изменить.');

  if (action === TASK_MANAGEMENT_ACTIONS.COMPLETE) {
    const title = completeMatch(safe);
    if (title === undefined) return clarification('Уточни, какую задачу отметить выполненной.');
    if (title === null) {
      return clarification('Что именно выполнить? Напиши название задачи.', {
        pendingTaskSelection: true,
      });
    }
    return { ok: true, action, ...(title ? selector(title) : {}) };
  }

  if (action === TASK_MANAGEMENT_ACTIONS.CANCEL) {
    const title = cancelMatch(safe);
    if (!title) {
      return clarification('Что именно отменить? Напиши название задачи.', {
        pendingTaskSelection: true,
      });
    }
    return { ok: true, action, ...selector(title) };
  }

  if (action === TASK_MANAGEMENT_ACTIONS.RESCHEDULE) {
    const match = rescheduleMatch(safe);
    if (!match?.title) return clarification('Уточни, какую задачу перенести.');
    const due = parseTaskDueExpression(match.dueExpression, {
      now: options.now,
      timezone: options.timezone || DEFAULT_OWNER_TIMEZONE,
    });
    if (!due.ok) return due;
    return {
      ok: true,
      action,
      ...selector(match.title),
      dueAt: due.dueAt,
      dueLabel: due.dueLabel,
    };
  }

  return clarification('Не понял, какую задачу нужно изменить.');
}

function parseTaskClarificationReply(message) {
  if (typeof message !== 'string') return null;
  const normalized = message
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/[.!?]+$/u, '')
    .trim();
  if (CLARIFICATION_CANCEL_WORDS.has(normalized)) return { type: 'cancel' };
  if (/^[1-9]\d*$/u.test(normalized)) {
    return { type: 'selection', taskNumber: Number(normalized) };
  }
  const taskNumber = CLARIFICATION_SELECTIONS.get(normalized);
  if (taskNumber) return { type: 'selection', taskNumber };
  if (detectTaskManagementAction(message)) return null;

  const numberedReferences = [...message.matchAll(/^\s*\d+[.)]\s+(.+?)\s*$/gmu)]
    .map(match => canonicalTaskReference(match[1]))
    .filter(Boolean);
  if (numberedReferences.length === 1) {
    return { type: 'reference', reference: numberedReferences[0] };
  }
  if (numberedReferences.length > 1 || /[?？]/u.test(message)) return null;

  const singleLine = message.trim();
  if (!singleLine || /[\r\n]/u.test(singleLine) || singleLine.length > 160) return null;
  const reference = canonicalTaskReference(singleLine.replace(/^задача\s+/iu, ''));
  return reference ? { type: 'reference', reference } : null;
}

module.exports = {
  TASK_MANAGEMENT_ACTIONS,
  canonicalTaskReference,
  detectTaskManagementAction,
  parseTaskClarificationReply,
  parseTaskManagementRequest,
};
