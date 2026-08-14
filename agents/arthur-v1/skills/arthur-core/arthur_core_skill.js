'use strict';

const { UnsupportedOperationError } = require('../../errors/arthur_errors');
const {
  ArthurCoreClientError,
  ArthurCoreNotFoundError,
} = require('./core_client');

const CAPABILITIES = Object.freeze([
  { id: 'getProfile', readOnly: true },
  { id: 'listTasks', readOnly: true },
  { id: 'getTaskBrief', readOnly: true },
  { id: 'createTask', readOnly: false },
]);

const MAX_VISIBLE_TASKS = 10;

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

function taskClarificationResult(responseText) {
  return {
    status: 'success',
    data: {
      status: 'clarification_required',
      summary: responseText,
      responseText,
    },
    metadata: { source: 'arthur-core', writePerformed: false },
  };
}

function createArthurCoreSkill({ client, ownerProfileId } = {}) {
  const requiredClientMethods = ['getProfile', 'listTasks', 'getTaskBrief', 'createTask', 'health'];
  if (!client || requiredClientMethods.some(method => typeof client[method] !== 'function')) {
    throw new TypeError('Arthur Core client is required');
  }
  const configuredOwnerProfileId = requireOwnerProfileId(ownerProfileId);

  return {
    id: 'arthur-core',
    name: 'Arthur Core',
    version: '1.1.0',
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
          const task = {
            title: parameters.title,
            domain: 'personal',
            ...(parameters.description ? { description: parameters.description } : {}),
            ...(parameters.priority ? { priority: parameters.priority } : {}),
            ...(parameters.dueAt ? { dueAt: parameters.dueAt } : {}),
            sourceType: input.actor?.channel === 'telegram' ? 'telegram' : 'arthur',
            ...(parameters.sourceRef ? { sourceRef: parameters.sourceRef } : {}),
          };
          return createdTaskResult(
            await client.createTask(configuredOwnerProfileId, task, context),
            parameters
          );
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
};
