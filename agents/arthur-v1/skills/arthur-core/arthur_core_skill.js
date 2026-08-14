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
]);

function requireOwnerProfileId(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('Arthur Core owner profile ID is required');
  }
  return value.trim();
}

function degradedResult(operation, error) {
  const notFound = error instanceof ArthurCoreNotFoundError;
  return {
    status: 'success',
    data: {
      status: notFound ? 'not_found' : 'unavailable',
      summary: notFound
        ? 'Данные владельца в Arthur Core не найдены.'
        : 'Arthur Core временно недоступен. Попробуйте запросить профиль или задачи позже.',
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
  return {
    status: 'success',
    data: {
      status: 'available',
      summary: details ? `Профиль владельца: ${details}.` : 'Профиль владельца получен.',
      profile,
    },
    metadata: { source: 'arthur-core', endpoint: 'profile' },
  };
}

function tasksResult(tasks) {
  return {
    status: 'success',
    data: {
      status: 'available',
      summary: `Задач получено: ${tasks.length}.`,
      count: tasks.length,
      tasks,
    },
    metadata: { source: 'arthur-core', endpoint: 'tasks' },
  };
}

function briefResult(brief) {
  const overdue = brief.overdue?.length || 0;
  const upcoming = brief.upcoming?.length || 0;
  const waiting = brief.waiting?.length || 0;
  return {
    status: 'success',
    data: {
      ...brief,
      status: 'available',
      summary: `Сводка задач: просрочено ${overdue}, предстоящих ${upcoming}, в ожидании ${waiting}.`,
    },
    metadata: { source: 'arthur-core', endpoint: 'tasks/brief' },
  };
}

function createArthurCoreSkill({ client, ownerProfileId } = {}) {
  const requiredClientMethods = ['getProfile', 'listTasks', 'getTaskBrief', 'health'];
  if (!client || requiredClientMethods.some(method => typeof client[method] !== 'function')) {
    throw new TypeError('Arthur Core client is required');
  }
  const configuredOwnerProfileId = requireOwnerProfileId(ownerProfileId);

  return {
    id: 'arthur-core',
    name: 'Arthur Core',
    version: '1.0.0',
    capabilities: CAPABILITIES,

    async execute(input = {}) {
      const operation = input.operation;
      const parameters = input.parameters || {};
      const context = { correlationId: input.correlationId };

      try {
        if (operation === 'getProfile') {
          return profileResult(await client.getProfile(configuredOwnerProfileId, context));
        }
        if (operation === 'listTasks') {
          return tasksResult(await client.listTasks(configuredOwnerProfileId, parameters, context));
        }
        if (operation === 'getTaskBrief') {
          return briefResult(await client.getTaskBrief(configuredOwnerProfileId, parameters, context));
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
};
