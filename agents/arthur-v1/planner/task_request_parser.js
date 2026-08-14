'use strict';

const DEFAULT_OWNER_TIMEZONE = 'Asia/Vladivostok';
const DATE_ONLY_HOUR = 23;
const DATE_ONLY_MINUTE = 59;
const DATE_ONLY_SECOND = 59;
const DATE_ONLY_MILLISECOND = 999;
const MAX_IMPLICIT_TASK_LENGTH = 160;

const ARTHUR_ADDRESS_PREFIX = /^\s*артур\s*[,!:.-]?\s*/iu;
const CREATE_TASK_PREFIX = /^\s*(?:артур\s*[,!:.-]?\s*)?(?:(?:создай|добавь|поставь|запиши)\s+(?:мне\s+)?задач(?:у|ку)|напомни\s+мне|надо\s+сделать|мне\s+нужно\s+сделать)\s*[:,-]?\s*/iu;
const TIME_PATTERN = /(?:^|\s)в?\s*([01]?\d|2[0-3]):([0-5]\d)(?!\d)/iu;
const DATE_PATTERN = /(?<![\p{L}\p{N}])(?:(?:до|на)\s+)?(?:(сегодня|завтра|послезавтра)|(в\s+)?(понедельник|понедельника|вторник|вторника|среду|среда|четверг|четверга|пятницу|пятница|субботу|суббота|воскресенье)|([0-3]?\d)\.([01]?\d)(?:\.(\d{4}))?|([0-3]?\d)\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+(\d{4})(?:\s+года)?)?)(?![\p{L}\p{N}])/giu;
const IMPLICIT_TASK_DISCUSSION_PATTERN = /(?:—|--|(?<![\p{L}\p{N}])(?:было\s+бы|хорошая\s+идея|кажется|думаю|возможно|может\s+быть|стоит\s+ли|можно\s+ли)(?![\p{L}\p{N}]))/iu;

// Keep implicit writes deliberately narrow: every accepted word is an
// unambiguous action commonly used as a personal task in Arthur.
const IMPLICIT_TASK_ACTIONS = Object.freeze(new Set([
  'позвонить',
  'проверить',
  'купить',
  'подготовить',
  'написать',
  'записаться',
  'заказать',
  'оплатить',
  'отправить',
  'забрать',
  'получить',
  'уточнить',
  'согласовать',
  'обсудить',
  'встретиться',
  'передать',
  'договориться',
  'заполнить',
  'собрать',
  'оформить',
  'обновить',
  'исправить',
]));

const MONTHS = Object.freeze({
  января: 1,
  февраля: 2,
  марта: 3,
  апреля: 4,
  мая: 5,
  июня: 6,
  июля: 7,
  августа: 8,
  сентября: 9,
  октября: 10,
  ноября: 11,
  декабря: 12,
});

const WEEKDAYS = Object.freeze({
  понедельник: 1,
  понедельника: 1,
  вторник: 2,
  вторника: 2,
  среда: 3,
  среду: 3,
  четверг: 4,
  четверга: 4,
  пятница: 5,
  пятницу: 5,
  суббота: 6,
  субботу: 6,
  воскресенье: 0,
});

const PRIORITY_PATTERNS = Object.freeze([
  { pattern: /(?<![\p{L}\p{N}])срочно(?![\p{L}\p{N}])/iu, priority: 'critical' },
  { pattern: /(?<![\p{L}\p{N}])высок(?:ий|ого)\s+приоритет(?:а)?(?![\p{L}\p{N}])/iu, priority: 'high' },
  { pattern: /(?<![\p{L}\p{N}])низк(?:ий|ого)\s+приоритет(?:а)?(?![\p{L}\p{N}])/iu, priority: 'low' },
  { pattern: /(?<![\p{L}\p{N}])обычн(?:ая|ый)(?:\s+приоритет)?(?![\p{L}\p{N}])/iu, priority: 'normal' },
]);

function matchesExplicitCreateTaskIntent(message) {
  return typeof message === 'string' && CREATE_TASK_PREFIX.test(message);
}

function trimImplicitMarker(text) {
  return text.replace(/^[\s,.:;!—-]+/gu, '').trimStart();
}

function implicitActionCandidate(message) {
  let remainder = message.replace(ARTHUR_ADDRESS_PREFIX, '').trim();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let markerRemoved = false;
    const dateMatch = [...remainder.matchAll(DATE_PATTERN)][0];
    if (dateMatch?.index === 0) {
      remainder = trimImplicitMarker(remainder.slice(dateMatch[0].length));
      markerRemoved = true;
    }

    const timeMatch = remainder.match(TIME_PATTERN);
    if (timeMatch?.index === 0) {
      remainder = trimImplicitMarker(remainder.slice(timeMatch[0].length));
      markerRemoved = true;
    }

    const priorityMatch = PRIORITY_PATTERNS
      .map(item => remainder.match(item.pattern))
      .find(match => match?.index === 0);
    if (priorityMatch) {
      remainder = trimImplicitMarker(remainder.slice(priorityMatch[0].length));
      markerRemoved = true;
    }

    if (!markerRemoved) break;
  }

  return remainder;
}

function matchesImplicitTaskIntent(message) {
  if (typeof message !== 'string') return false;
  const trimmed = message.trim();
  if (!trimmed
    || trimmed.length > MAX_IMPLICIT_TASK_LENGTH
    || /[\r\n?？]/u.test(trimmed)
    || /["'«»„“]/u.test(trimmed)
    || IMPLICIT_TASK_DISCUSSION_PATTERN.test(trimmed)) {
    return false;
  }

  const candidate = implicitActionCandidate(trimmed);
  const words = candidate.match(/[\p{L}\p{N}]+/gu) || [];
  if (words.length < 2) return false;
  return IMPLICIT_TASK_ACTIONS.has(words[0].toLocaleLowerCase('ru-RU'));
}

function matchesCreateTaskIntent(message) {
  return matchesExplicitCreateTaskIntent(message) || matchesImplicitTaskIntent(message);
}

function timezoneParts(value, timezone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(value);
  } catch (error) {
    throw new RangeError(`Invalid owner timezone: ${timezone}`, { cause: error });
  }
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function zonedDateTimeToIso(parts, timezone) {
  const desiredUtcSeconds = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second || 0,
    0
  );
  let candidate = desiredUtcSeconds + (parts.millisecond || 0);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = timezoneParts(new Date(candidate), timezone);
    const actualUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second
    );
    const adjustment = desiredUtcSeconds - actualUtc;
    candidate += adjustment;
    if (adjustment === 0) break;
  }

  const resolved = timezoneParts(new Date(candidate), timezone);
  const matches = ['year', 'month', 'day', 'hour', 'minute', 'second']
    .every(key => resolved[key] === (parts[key] || 0));
  if (!matches) throw new RangeError('Specified local date and time does not exist in owner timezone');
  return new Date(candidate).toISOString();
}

function validCalendarDate(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year
    && value.getUTCMonth() === month - 1
    && value.getUTCDate() === day;
}

function addCalendarDays(date, days) {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

function compareCalendarDates(left, right) {
  return Date.UTC(left.year, left.month - 1, left.day)
    - Date.UTC(right.year, right.month - 1, right.day);
}

function parseDateMatch(match, currentDate) {
  if (match[1]) {
    const offset = { сегодня: 0, завтра: 1, послезавтра: 2 }[match[1].toLowerCase()];
    return {
      date: addCalendarDays(currentDate, offset),
      label: match[1].toLowerCase(),
    };
  }

  if (match[3]) {
    const targetWeekday = WEEKDAYS[match[3].toLowerCase()];
    const currentWeekday = new Date(Date.UTC(
      currentDate.year,
      currentDate.month - 1,
      currentDate.day
    )).getUTCDay();
    let daysAhead = (targetWeekday - currentWeekday + 7) % 7;
    if (daysAhead === 0) daysAhead = 7;
    return {
      date: addCalendarDays(currentDate, daysAhead),
      label: `в ${match[3].toLowerCase()}`,
    };
  }

  let day;
  let month;
  let year;
  let label;
  if (match[4]) {
    day = Number(match[4]);
    month = Number(match[5]);
    year = match[6] ? Number(match[6]) : null;
    label = year ? `${day}.${String(month).padStart(2, '0')}.${year}` : `${day}.${String(month).padStart(2, '0')}`;
  } else {
    day = Number(match[7]);
    month = MONTHS[match[8].toLowerCase()];
    year = match[9] ? Number(match[9]) : null;
    label = year ? `${day} ${match[8].toLowerCase()} ${year}` : `${day} ${match[8].toLowerCase()}`;
  }

  if (!year) {
    year = currentDate.year;
    if (validCalendarDate(year, month, day)
      && compareCalendarDates({ year, month, day }, currentDate) < 0) {
      year += 1;
    }
  }

  if (!validCalendarDate(year, month, day)) {
    throw new RangeError('Указана некорректная календарная дата. Уточни срок задачи.');
  }
  return { date: { year, month, day }, label };
}

function extractPriority(text) {
  const matches = PRIORITY_PATTERNS.filter(item => item.pattern.test(text));
  if (matches.length > 1) {
    return { error: 'Указано несколько приоритетов. Уточни один приоритет задачи.' };
  }
  if (matches.length === 0) return { text };
  return {
    text: text.replace(matches[0].pattern, ' '),
    priority: matches[0].priority,
  };
}

function cleanTitle(text) {
  const cleaned = text
    .replace(/^[\s,.:;!?—-]+|[\s,.:;!?—-]+$/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.charAt(0).toLocaleUpperCase('ru-RU') + cleaned.slice(1);
}

function clarification(message) {
  return {
    ok: false,
    clarification: message,
  };
}

function temporalContext(options = {}) {
  const timezone = options.timezone || DEFAULT_OWNER_TIMEZONE;
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (Number.isNaN(now.getTime())) throw new TypeError('now must be a valid date');
  return { timezone, currentDate: timezoneParts(now, timezone) };
}

function extractDueDate(text, { timezone, currentDate, required = false } = {}) {
  const dateMatches = [...text.matchAll(DATE_PATTERN)];
  if (dateMatches.length > 1) {
    return clarification('Указано несколько сроков. Уточни один срок задачи.');
  }

  const timeMatch = text.match(TIME_PATTERN);
  if (timeMatch && dateMatches.length === 0) {
    return clarification('Укажи дату вместе со временем задачи.');
  }
  if (dateMatches.length === 0) {
    return required
      ? clarification('Укажи новый срок задачи.')
      : { ok: true, remainder: text };
  }

  let parsedDate;
  try {
    parsedDate = parseDateMatch(dateMatches[0], currentDate);
  } catch (error) {
    if (error instanceof RangeError) return clarification(error.message);
    throw error;
  }
  const time = timeMatch
    ? { hour: Number(timeMatch[1]), minute: Number(timeMatch[2]), second: 0, millisecond: 0 }
    : {
        hour: DATE_ONLY_HOUR,
        minute: DATE_ONLY_MINUTE,
        second: DATE_ONLY_SECOND,
        millisecond: DATE_ONLY_MILLISECOND,
      };
  const dueAt = zonedDateTimeToIso({ ...parsedDate.date, ...time }, timezone);
  const dueLabel = timeMatch
    ? `${parsedDate.label} в ${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`
    : parsedDate.label;
  let remainder = text.replace(dateMatches[0][0], ' ');
  if (timeMatch) remainder = remainder.replace(TIME_PATTERN, ' ');
  return { ok: true, remainder, dueAt, dueLabel };
}

function parseTaskDueExpression(expression, options = {}) {
  if (typeof expression !== 'string' || expression.trim() === '') {
    return clarification('Укажи новый срок задачи.');
  }
  const context = temporalContext(options);
  const parsed = extractDueDate(expression.trim(), { ...context, required: true });
  if (!parsed.ok) return parsed;
  if (cleanTitle(parsed.remainder)) {
    return clarification('Не понял новый срок задачи. Уточни дату.');
  }
  return {
    ok: true,
    dueAt: parsed.dueAt,
    dueLabel: parsed.dueLabel,
  };
}

function parseCreateTaskRequest(message, options = {}) {
  const explicitIntent = matchesExplicitCreateTaskIntent(message);
  if (!explicitIntent && !matchesImplicitTaskIntent(message)) {
    return clarification('Сформулируй задачу после команды «создай задачу».');
  }

  const context = temporalContext(options);
  let remainder = explicitIntent
    ? message.replace(CREATE_TASK_PREFIX, '')
    : message.replace(ARTHUR_ADDRESS_PREFIX, '').trim();

  const priorityResult = extractPriority(remainder);
  if (priorityResult.error) return clarification(priorityResult.error);
  remainder = priorityResult.text;

  const dueResult = extractDueDate(remainder, context);
  if (!dueResult.ok) return dueResult;
  remainder = dueResult.remainder;

  const title = cleanTitle(remainder);
  if (!title) {
    return clarification('Что именно нужно сделать? Напиши название задачи.');
  }

  return {
    ok: true,
    task: {
      title,
      ...(dueResult.dueAt ? { dueAt: dueResult.dueAt, dueLabel: dueResult.dueLabel } : {}),
      ...(priorityResult.priority ? { priority: priorityResult.priority } : {}),
    },
  };
}

module.exports = {
  DEFAULT_OWNER_TIMEZONE,
  matchesCreateTaskIntent,
  matchesExplicitCreateTaskIntent,
  matchesImplicitTaskIntent,
  parseCreateTaskRequest,
  parseTaskDueExpression,
  zonedDateTimeToIso,
};
