'use strict';

const { createHash } = require('node:crypto');
const { validateTask } = require('../shared/validation');

async function setTaskReminder(service, ownerId, id, input, actorContext, action = 'reminder') {
  if (!['reminder','done','snooze','cancel'].includes(action)) throw new TypeError('Invalid personal action');
  if (!ownerId || !id || !input || !Number.isFinite(Date.parse(input.expectedUpdatedAt))) {
    throw new TypeError('Owner, task ID and expectedUpdatedAt are required');
  }
  const remindAt = action === 'snooze' ? new Date(Date.parse(service.now()) + 30*60000).toISOString() : ['done','cancel'].includes(action) ? null : input.remindAt;
  if (remindAt !== null && (typeof remindAt !== 'string'
    || !Number.isFinite(Date.parse(remindAt)) || Date.parse(remindAt) <= Date.parse(service.now()))) {
    throw new TypeError('remindAt must be null or a future timestamp');
  }
  if (input.sourceRef != null && (typeof input.sourceRef !== 'string' || !input.sourceRef.trim() || input.sourceRef.length > 2000)) {
    throw new TypeError('Invalid reminder command source');
  }
  const context = service.context(actorContext);
  return service.store.transaction(async store => {
    await store.lockPersonalMemoryOwner(ownerId);
    const key = input.sourceRef ? `personal.reminder-command:${createHash('sha256').update(input.sourceRef).digest('hex')}` : null;
    if (key && await store.getActiveMemory(ownerId, 'personal', key)) return { status: 'already_processed' };
    const task = await store.getTask(id, { lock: true });
    let result;
    if (!task || task.ownerId !== ownerId || task.domain !== 'personal') result = { status: 'not_found' };
    else if (['done', 'cancelled'].includes(task.status)
      || Date.parse(task.updatedAt) !== Date.parse(input.expectedUpdatedAt)) result = { status: 'stale' };
    else if (!task.remindAt) result = { status: 'not_scheduled' };
    else {
      const after = { ...task, remindAt: remindAt === null ? null : new Date(remindAt).toISOString(),
        ...(action === 'done' ? { status: 'done', completedAt: service.now() } : {}),
        updatedAt: new Date(Math.max(Date.parse(service.now()), Date.parse(task.updatedAt) + 1)).toISOString() };
      validateTask(after);
      await store.putTask(after);
      await service.audit(store, { context, domain: 'personal', action: action === 'done' ? 'task.complete' : 'task.reminder',
        entityType: 'task', entityId: id, before: task, after });
      result = { status: 'updated', task: after };
    }
    if (key) {
      const now = service.now();
      await store.putMemory({ id: service.idFactory(), ownerId, domain: 'personal', type: 'reference',
        key, value: { status: result.status }, sourceType: 'api', sourceRef: input.sourceRef,
        confidence: 1, sensitivity: 'restricted', status: 'active',
        validFrom: now, createdAt: now, updatedAt: now });
    }
    return result;
  });
}

module.exports = { setTaskReminder };
