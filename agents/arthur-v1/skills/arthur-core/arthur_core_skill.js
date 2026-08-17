'use strict';

const { UnsupportedOperationError } = require('../../errors/arthur_errors');
const {
  ArthurCoreClientError,
  ArthurCoreNotFoundError,
} = require('./core_client');
const {
  defaultNextCheckAt,
  formatDuplicateWaitingResponse,
  formatWaitingResponse,
  isDuplicateWaitingTask,
} = require('../../planner/waiting_request_parser');

const CAPABILITIES = Object.freeze([
  { id: 'getProfile', readOnly: true },
  { id: 'listTasks', readOnly: true },
  { id: 'getTaskBrief', readOnly: true },
  { id: 'createTask', readOnly: false },
  { id: 'completeTask', readOnly: false },
  { id: 'cancelTask', readOnly: false },
  { id: 'rescheduleTask', readOnly: false },
]);

const MAX_VISIBLE_TASKS = 10;
const TASK_SELECTION_LIMIT = 200;
const DEFAULT_OWNER_TIMEZONE = 'Asia/Vladivostok';
const TASK_MUTATION_OPERATIONS = Object.freeze(new Set([
  'completeTask',
  'cancelTask',
  'rescheduleTask',
]));
const TASK_ACTION_BY_OPERATION = Object.freeze({
  completeTask: 'complete',
  cancelTask: 'cancel',
  rescheduleTask: 'reschedule',
});

function requireOwnerProfileId(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('Arthur Core owner profile ID is required');
  }
  return value.trim();
}

function degradedResult(operation, error) {
  const notFound = error instanceof ArthurCoreNotFoundError;
  const responseText = operation === 'createTask'
    ? (notFound
        ? 'Не удалось создать задачу: профиль владельца в Arthur Core не найден.'
        : 'Не удалось создать задачу: Arthur Core временно недоступен. Попробуй позже.')
    : TASK_MUTATION_OPERATIONS.has(operation)
      ? (notFound
          ? 'Не нашёл такую активную задачу.'
          : 'Не удалось изменить задачу: Arthur Core временно недоступен. Попробуй позже.')
    : (notFound
        ? 'Данные владельца в Arthur Core не найдены.'
        : 'Arthur Core временно недоступен. Попробуй запросить профиль или задачи позже.');
  return {
    status: 'success',
    data: {
      status: notFound ? 'not_found' : 'unavailable',
      summary: responseText,
      responseText,
      operation,
    },
    metadata: {
      source: 'arthur-core',
      degraded: true,
      errorCode: error.code,
    },
  };
}

function profileResult(profile) {
  const details = [profile.name, profile.timezone, profile.locale].filter(Boolean).join(', ');
  const responseText = profile.name
    ? `Ты — ${profile.name}.${profile.timezone ? ` Часовой пояс: ${profile.timezone}.` : ''}`
    : 'Твой профиль получен.';
  return {
    status: 'success',
    data: {
      status: 'available',
      summary: details ? `Профиль владельца: ${details}.` : 'Профиль владельца получен.',
      responseText,
      profile,
    },
    metadata: { source: 'arthur-core', endpoint: 'profile' },
  };
}

function activeTaskNoun(count) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod10 === 1 && mod100 !== 11) return 'активная задача';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'активные задачи';
  return 'активных задач';
}

function taskLines(tasks, limit = MAX_VISIBLE_TASKS) {
  const visible = tasks.slice(0, limit);
  const lines = visible.map((task, index) => `${index + 1}. ${task.title}`);
  if (tasks.length > visible.length) lines.push(`Ещё: ${tasks.length - visible.length}.`);
  return lines;
}

function formatTasksResponse(tasks) {
  if (tasks.length === 0) return 'Активных задач сейчас нет.';
  return [`У тебя ${tasks.length} ${activeTaskNoun(tasks.length)}:`, '', ...taskLines(tasks)].join('\n');
}

function tasksResult(tasks) {
  const responseText = formatTasksResponse(tasks);
  return {
    status: 'success',
    data: {
      status: 'available',
      summary: `Задач получено: ${tasks.length}.`,
      responseText,
      count: tasks.length,
      tasks,
    },
    metadata: { source: 'arthur-core', endpoint: 'tasks' },
  };
}

function formatTodayBrief(brief) {
  const today = brief.today || [];
  const lines = today.length === 0
    ? ['На сегодня задач нет.']
    : [`На сегодня: ${today.length}`, ...taskLines(today)];
  lines.push('', `Просрочено: ${brief.overdue?.length || 0}`, `Ожидают: ${brief.waiting?.length || 0}`);
  return lines.join('\n');
}

function formatOverdueBrief(brief) {
  const overdue = brief.overdue || [];
  const lines = overdue.length === 0
    ? ['Просроченных задач нет.']
    : [`Просрочено: ${overdue.length}`, ...taskLines(overdue)];
  lines.push('', `На сегодня: ${brief.today?.length || 0}`, `Ожидают: ${brief.waiting?.length || 0}`);
  return lines.join('\n');
}

function formatSummaryBrief(brief) {
  return [
    `На сегодня: ${brief.today?.length || 0}`,
    `Просрочено: ${brief.overdue?.length || 0}`,
    `Предстоящие ${brief.horizonHours || 24} ч: ${brief.upcoming?.length || 0}`,
    `Ожидают: ${brief.waiting?.length || 0}`,
  ].join('\n');
}

function formatBriefResponse(brief, view = 'summary') {
  if (view === 'today') return formatTodayBrief(brief);
  if (view === 'overdue') return formatOverdueBrief(brief);
  return formatSummaryBrief(brief);
}

function briefResult(brief, parameters = {}) {
  const today = brief.today?.length || 0;
  const overdue = brief.overdue?.length || 0;
  const upcoming = brief.upcoming?.length || 0;
  const waiting = brief.waiting?.length || 0;
  const responseText = formatBriefResponse(brief, parameters.view);
  return {
    status: 'success',
    data: {
      ...brief,
      status: 'available',
      summary: `Сводка задач: на сегодня ${today}, просрочено ${overdue}, предстоящих ${upcoming}, в ожидании ${waiting}.`,
      responseText,
    },
    metadata: { source: 'arthur-core', endpoint: 'tasks/brief' },
  };
}

function createdTaskResult(task, parameters = {}) {
  const title = task.title || parameters.title;
  const responseLines = ['Готово. Задача создана:', title];
  if (parameters.dueLabel) responseLines.push(`Срок: ${parameters.dueLabel}`);
  const responseText = responseLines.join('\n');
  return {
    status: 'success',
    data: {
      status: 'created',
      summary: `Задача создана: ${title}.`,
      responseText,
      task,
    },
    metadata: { source: 'arthur-core', endpoint: 'tasks' },
  };
}

function normalizeTaskTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/gu, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s{2,}/g, ' ');
}

function normalizedDueAt(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function findDuplicateTask(tasks, parameters) {
  const title = normalizeTaskTitle(parameters.title);
  const dueAt = normalizedDueAt(parameters.dueAt);
  return tasks.find(task => normalizeTaskTitle(task.title) === title
    && (!dueAt || normalizedDueAt(task.dueAt) === dueAt));
}

function duplicateTaskResult(task, parameters = {}) {
  const responseLines = ['Такая задача уже есть:', task.title || parameters.title];
  if (parameters.dueLabel) responseLines.push(`Срок: ${parameters.dueLabel}`);
  const responseText = responseLines.join('\n');
  return {
    status: 'success',
    data: {
      status: 'duplicate',
      summary: `Задача уже существует: ${task.title || parameters.title}.`,
      responseText,
      task,
    },
    metadata: { source: 'arthur-core', writePerformed: false },
  };
}

function selectTask(tasks, parameters = {}) {
  if (parameters.taskId) {
    const task = tasks.find(candidate => candidate.id === parameters.taskId);
    if (!task) return { status: 'stale', tasks: [] };
    const expected = parameters.expectedTask;
    if (expected && (
      expected.id !== task.id
      || normalizeTaskTitle(expected.title) !== normalizeTaskTitle(task.title)
      || expected.status !== task.status
      || normalizedDueAt(expected.dueAt) !== normalizedDueAt(task.dueAt)
    )) {
      return { status: 'stale', tasks: [] };
    }
    return { status: 'unique', task };
  }
  if (Number.isInteger(parameters.taskNumber)) {
    const task = tasks[parameters.taskNumber - 1];
    return task ? { status: 'unique', task } : { status: 'not_found', tasks: [] };
  }
  if (!parameters.title) {
    if (tasks.length === 1) return { status: 'unique', task: tasks[0] };
    return tasks.length === 0
      ? { status: 'not_found', tasks: [] }
      : {
          status: 'ambiguous',
          tasks: tasks.map((task, index) => ({ ...task, selectionNumber: index + 1 })),
        };
  }
  const normalized = normalizeTaskTitle(parameters.title);
  const matches = tasks
    .filter(task => normalizeTaskTitle(task.title) === normalized)
    .map((task, index) => ({ ...task, selectionNumber: index + 1 }));
  if (matches.length === 1) return { status: 'unique', task: matches[0] };
  return matches.length === 0
    ? { status: 'not_found', tasks: [] }
    : { status: 'ambiguous', tasks: matches };
}

function formatTaskDue(task, timezone) {
  if (!task.dueAt) return 'без срока';
  const date = new Date(task.dueAt);
  if (Number.isNaN(date.getTime())) return 'срок не указан';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function taskSelectionResult(selection, timezone, operation, parameters = {}) {
  if (selection.status === 'not_found') {
    return taskClarificationResult('Не нашёл такую активную задачу.');
  }
  if (selection.status === 'stale') {
    return taskClarificationResult('Эта задача уже изменилась или больше не активна. Повтори команду.');
  }
  const visible = selection.tasks.slice(0, MAX_VISIBLE_TASKS);
  const lines = [
    `Нашёл ${selection.tasks.length} подходящие задачи:`,
    '',
    ...visible.map(task => `${task.selectionNumber}. ${task.title} — ${formatTaskDue(task, timezone)}`),
    '',
    'Уточни номер.',
  ];
  return taskClarificationResult(lines.join('\n'), {
    action: TASK_ACTION_BY_OPERATION[operation],
    operation,
    candidates: visible.map(task => ({
      id: task.id,
      title: task.title,
      status: task.status,
      dueAt: task.dueAt || null,
    })),
    parameters: operation === 'rescheduleTask'
      ? { dueAt: parameters.dueAt, dueLabel: parameters.dueLabel }
      : {},
  });
}

function taskMutationResult(task, operation, parameters = {}) {
  let responseLines;
  let status;
  if (operation === 'completeTask') {
    status = 'completed';
    responseLines = ['Готово. Задача выполнена:', task.title];
  } else if (operation === 'cancelTask') {
    status = 'cancelled';
    responseLines = ['Готово. Задача отменена:', task.title];
  } else {
    status = 'rescheduled';
    const dueLabel = parameters.dueLabel || formatTaskDue(task, DEFAULT_OWNER_TIMEZONE);
    responseLines = [
      'Готово. Новый срок:',
      task.title,
      dueLabel.charAt(0).toLocaleUpperCase('ru-RU') + dueLabel.slice(1),
    ];
  }
  const responseText = responseLines.join('\n');
  return {
    status: 'success',
    data: {
      status,
      summary: responseText.replace(/\n/g, ' '),
      responseText,
      task,
    },
    metadata: { source: 'arthur-core', endpoint: 'tasks/transitions' },
  };
}

function taskClarificationResult(responseText, pendingClarification = null) {
  return {
    status: 'success',
    data: {
      status: 'clarification_required',
      summary: responseText,
      responseText,
      ...(pendingClarification ? { pendingClarification } : {}),
    },
    metadata: { source: 'arthur-core', writePerformed: false },
  };
}

function taskReferenceClarificationResult(responseText, tasks, operation, parameters = {}) {
  const visible = tasks.slice(0, MAX_VISIBLE_TASKS);
  if (visible.length === 0) {
    return taskClarificationResult('Активных задач сейчас нет.');
  }
  return taskClarificationResult(responseText, {
    action: TASK_ACTION_BY_OPERATION[operation],
    operation,
    candidates: visible.map(task => ({
      id: task.id,
      title: task.title,
      status: task.status,
      dueAt: task.dueAt || null,
    })),
    parameters: operation === 'rescheduleTask'
      ? { dueAt: parameters.dueAt, dueLabel: parameters.dueLabel }
      : {},
  });
}

function createArthurCoreSkill({
  client,
  ownerProfileId,
  ownerTimezone = DEFAULT_OWNER_TIMEZONE,
  clock = () => new Date(),
} = {}) {
  const requiredClientMethods = [
    'getProfile',
    'listTasks',
    'getTaskBrief',
    'createTask',
    'transitionTask',
    'health',
  ];
  if (!client || requiredClientMethods.some(method => typeof client[method] !== 'function')) {
    throw new TypeError('Arthur Core client is required');
  }
  const configuredOwnerProfileId = requireOwnerProfileId(ownerProfileId);

  return {
    id: 'arthur-core',
    name: 'Arthur Core',
    version: '1.2.0',
    capabilities: CAPABILITIES,

    async execute(input = {}) {
      const operation = input.operation;
      const parameters = input.parameters || {};
      const context = {
        correlationId: input.correlationId,
        actorId: configuredOwnerProfileId,
        actorType: 'user',
      };

      try {
        if (operation === 'getProfile') {
          return profileResult(await client.getProfile(configuredOwnerProfileId, context));
        }
        if (operation === 'listTasks') {
          return tasksResult(await client.listTasks(configuredOwnerProfileId, parameters, context));
        }
        if (operation === 'getTaskBrief') {
          return briefResult(
            await client.getTaskBrief(configuredOwnerProfileId, parameters, context),
            parameters
          );
        }
        if (operation === 'createTask') {
          if (parameters.clarification) {
            return taskClarificationResult(parameters.clarification);
          }
          const isWaiting = parameters.status === 'waiting';
          const task = {
            title: parameters.title,
            domain: 'personal',
            ...(parameters.description ? { description: parameters.description } : {}),
            ...(parameters.priority ? { priority: parameters.priority } : {}),
            ...(parameters.dueAt ? { dueAt: parameters.dueAt } : {}),
            ...(isWaiting ? {
              status: 'waiting',
              waitingFor: parameters.waitingFor,
              nextCheckAt: parameters.nextCheckAt || defaultNextCheckAt(clock()),
            } : {}),
            sourceType: input.actor?.channel === 'telegram' ? 'telegram' : 'arthur',
            ...(parameters.sourceRef ? { sourceRef: parameters.sourceRef } : {}),
          };
          const activeTasks = await client.listTasks(
            configuredOwnerProfileId,
            { limit: TASK_SELECTION_LIMIT },
            context
          );
          if (isWaiting) {
            const duplicate = activeTasks.find(existing => isDuplicateWaitingTask(existing, parameters));
            if (duplicate) {
              return {
                status: 'success',
                data: {
                  status: 'duplicate',
                  summary: `Ожидание уже существует: ${duplicate.waitingFor}.`,
                  responseText: formatDuplicateWaitingResponse(duplicate),
                  task: duplicate,
                },
                metadata: { source: 'arthur-core', writePerformed: false },
              };
            }
          } else {
            const duplicate = findDuplicateTask(activeTasks, parameters);
            if (duplicate) return duplicateTaskResult(duplicate, parameters);
          }
          const created = await client.createTask(configuredOwnerProfileId, task, context);
          if (isWaiting) {
            return {
              status: 'success',
              data: {
                status: 'created',
                summary: `Ожидание создано: ${created.title}.`,
                responseText: formatWaitingResponse({
                  ...created,
                  dueLabel: parameters.dueLabel,
                }),
                task: created,
              },
              metadata: { source: 'arthur-core', endpoint: 'tasks' },
            };
          }
          return createdTaskResult(created, parameters);
        }
        if (TASK_MUTATION_OPERATIONS.has(operation)) {
          if (parameters.clarification) {
            if (parameters.pendingTaskSelection) {
              const activeTasks = await client.listTasks(
                configuredOwnerProfileId,
                { limit: TASK_SELECTION_LIMIT },
                context
              );
              return taskReferenceClarificationResult(
                parameters.clarification,
                activeTasks,
                operation,
                parameters
              );
            }
            return taskClarificationResult(parameters.clarification);
          }
          const activeTasks = await client.listTasks(
            configuredOwnerProfileId,
            { limit: TASK_SELECTION_LIMIT },
            context
          );
          const selection = selectTask(activeTasks, parameters);
          if (selection.status !== 'unique') {
            return taskSelectionResult(selection, ownerTimezone, operation, parameters);
          }
          const selectedTask = selection.task;
          const nextStatus = operation === 'completeTask'
            ? 'done'
            : operation === 'cancelTask'
              ? 'cancelled'
              : selectedTask.status;
          const patch = operation === 'rescheduleTask' ? { dueAt: parameters.dueAt } : {};
          const task = await client.transitionTask(
            configuredOwnerProfileId,
            selectedTask.id,
            nextStatus,
            patch,
            context
          );
          return taskMutationResult(task, operation, parameters);
        }
        throw new UnsupportedOperationError('arthur-core', operation);
      } catch (error) {
        if (error instanceof ArthurCoreClientError) {
          return degradedResult(operation, error);
        }
        throw error;
      }
    },

    async health() {
      return client.health();
    },
  };
}

module.exports = {
  createArthurCoreSkill,
  CAPABILITIES,
  degradedResult,
  activeTaskNoun,
  formatTasksResponse,
  formatBriefResponse,
  createdTaskResult,
  duplicateTaskResult,
  normalizeTaskTitle,
  selectTask,
  taskMutationResult,
  taskReferenceClarificationResult,
};
