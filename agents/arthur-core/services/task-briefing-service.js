'use strict';

const { AsyncArthurCoreService } = require('./async-arthur-core-service');
const { TASK_STATUSES, DOMAINS } = require('../shared/constants');

function optionalEnum(value, allowed, name) {
  if (value == null || value === '') return undefined;
  if (!allowed.includes(value)) throw new RangeError(`${name} must be one of: ${allowed.join(', ')}`);
  return value;
}

function optionalIsoDate(value, name) {
  if (value == null || value === '') return undefined;
  if (Number.isNaN(Date.parse(value))) throw new TypeError(`${name} must be an ISO date`);
  return new Date(value).toISOString();
}

function positiveLimit(value) {
  if (value == null || value === '') return 50;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new RangeError('limit must be an integer between 1 and 200');
  }
  return parsed;
}

function dateKeyInTimezone(value, timezone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('value must be an ISO date');
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
  } catch (error) {
    throw new RangeError(`Invalid owner timezone: ${timezone}`, { cause: error });
  }
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

class TaskBriefingService extends AsyncArthurCoreService {
  async listTasks(ownerId, filter = {}) {
    if (typeof ownerId !== 'string' || ownerId.trim() === '') {
      throw new TypeError('ownerId must be a non-empty string');
    }
    const normalized = {
      status: optionalEnum(filter.status, TASK_STATUSES, 'status'),
      domain: optionalEnum(filter.domain, DOMAINS, 'domain'),
      dueBefore: optionalIsoDate(filter.dueBefore, 'dueBefore'),
      dueAfter: optionalIsoDate(filter.dueAfter, 'dueAfter'),
      includeCompleted: filter.includeCompleted === true || filter.includeCompleted === 'true',
      limit: positiveLimit(filter.limit)
    };
    return this.store.listTasks(ownerId, normalized);
  }

  async taskBrief(ownerId, { now = this.now(), horizonHours = 24, limit = 50 } = {}) {
    const horizon = Number(horizonHours);
    if (!Number.isFinite(horizon) || horizon < 1 || horizon > 720) {
      throw new RangeError('horizonHours must be between 1 and 720');
    }
    const current = new Date(now);
    if (Number.isNaN(current.getTime())) throw new TypeError('now must be an ISO date');
    const profile = await this.store.getProfile(ownerId);
    if (!profile) throw new Error('Profile not found');
    const timezone = profile.timezone;
    const horizonMs = current.getTime() + horizon * 3600000;
    const todayKey = dateKeyInTimezone(current, timezone);
    const tasks = await this.listTasks(ownerId, { includeCompleted: false, limit });
    const currentMs = current.getTime();
    const today = [];
    const overdue = [];
    const upcoming = [];
    const waiting = [];
    for (const task of tasks) {
      if (task.status === 'waiting') waiting.push(task);
      if (!task.dueAt) continue;
      const dueMs = new Date(task.dueAt).getTime();
      if (dateKeyInTimezone(task.dueAt, timezone) === todayKey) today.push(task);
      if (dueMs < currentMs) overdue.push(task);
      else if (dueMs <= horizonMs) upcoming.push(task);
    }
    return {
      generatedAt: current.toISOString(),
      timezone,
      horizonHours: horizon,
      today,
      overdue,
      upcoming,
      waiting,
      total: tasks.length
    };
  }
}

module.exports = { TaskBriefingService, optionalIsoDate, positiveLimit, dateKeyInTimezone };
