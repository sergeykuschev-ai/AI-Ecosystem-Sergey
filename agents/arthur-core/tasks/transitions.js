'use strict';

const { TASK_STATUSES } = require('../shared/constants');

const ALLOWED_TRANSITIONS = Object.freeze({
  new: Object.freeze(['planned', 'in_progress', 'cancelled']),
  planned: Object.freeze(['in_progress', 'waiting', 'needs_confirmation', 'cancelled']),
  in_progress: Object.freeze(['waiting', 'needs_confirmation', 'done', 'cancelled']),
  waiting: Object.freeze(['in_progress', 'needs_confirmation', 'done', 'cancelled']),
  needs_confirmation: Object.freeze(['in_progress', 'waiting', 'done', 'cancelled']),
  done: Object.freeze([]),
  cancelled: Object.freeze([])
});

function canTransitionTask(from, to) {
  if (!TASK_STATUSES.includes(from) || !TASK_STATUSES.includes(to)) return false;
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

function assertTaskTransition(from, to, task = {}) {
  if (!canTransitionTask(from, to)) {
    throw new RangeError(`Invalid task transition: ${from} -> ${to}`);
  }
  if (to === 'waiting') {
    if (typeof task.waitingFor !== 'string' || task.waitingFor.trim() === '') {
      throw new TypeError('waitingFor is required for waiting status');
    }
    if (!task.nextCheckAt || Number.isNaN(Date.parse(task.nextCheckAt))) {
      throw new TypeError('nextCheckAt must be a valid date for waiting status');
    }
  }
  return true;
}

module.exports = { ALLOWED_TRANSITIONS, canTransitionTask, assertTaskTransition };
