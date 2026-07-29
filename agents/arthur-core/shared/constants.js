'use strict';

const DOMAINS = Object.freeze([
  'personal', 'health', 'travel', 'content', 'business',
  'purchasing', 'academy', 'finance', 'system'
]);

const MEMORY_TYPES = Object.freeze([
  'fact', 'preference', 'policy', 'project_state', 'reference'
]);

const MEMORY_STATUSES = Object.freeze(['active', 'archived']);
const SENSITIVITY_LEVELS = Object.freeze(['normal', 'sensitive', 'restricted']);
const TASK_STATUSES = Object.freeze([
  'new', 'planned', 'in_progress', 'waiting',
  'needs_confirmation', 'done', 'cancelled'
]);
const TASK_PRIORITIES = Object.freeze(['low', 'normal', 'high', 'critical']);
const DECISION_STATUSES = Object.freeze(['active', 'superseded', 'reversed']);
const CONFIRMATION_RISKS = Object.freeze(['low', 'medium', 'high']);
const CONFIRMATION_STATUSES = Object.freeze([
  'pending', 'approved', 'rejected', 'expired', 'executed', 'failed'
]);
const ACTOR_TYPES = Object.freeze(['user', 'system', 'skill', 'automation']);
const AUDIT_RESULTS = Object.freeze(['success', 'failure']);

module.exports = {
  DOMAINS,
  MEMORY_TYPES,
  MEMORY_STATUSES,
  SENSITIVITY_LEVELS,
  TASK_STATUSES,
  TASK_PRIORITIES,
  DECISION_STATUSES,
  CONFIRMATION_RISKS,
  CONFIRMATION_STATUSES,
  ACTOR_TYPES,
  AUDIT_RESULTS
};
