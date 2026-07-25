const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  LIFECYCLE_SCHEMA_VERSION,
  OwnerLearningCandidateLifecycleError,
  appendCandidateLifecycleEvent,
  atomicWriteCandidateLifecycle,
  createCandidateLifecycleEvent,
  emptyCandidateLifecycle,
  getCandidateLifecycleState,
  getCandidateLifecycleStates,
  loadCandidateLifecycle,
  summarizeCandidateLifecycle,
  validateCandidateLifecycleTransition,
} = require(
  '../owner_learning/owner_learning_candidate_lifecycle'
);

const temporaryDirectories = [];
const BASE_TIME = '2026-07-25T00:00:00.000Z';

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), {
      recursive: true,
      force: true,
    });
  }
});

function temporaryPath() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'candidate-lifecycle-')
  );
  temporaryDirectories.push(directory);
  return path.join(directory, 'lifecycle.json');
}

function snapshot(overrides = {}) {
  return {
    patternType: 'SAME_ITEM_SAME_DECISION',
    scopeType: 'ITEM',
    displayScope: {
      primary: 'AWARD Hairball',
      secondary: 'SKU 7177004',
    },
    proposedRuleType: 'ITEM_DECISION_OVERRIDE',
    proposedDecision: 'SKIP',
    confidenceScore: 86,
    confidenceLevel: 'VERY_HIGH',
    priorityScore: 79,
    priorityLevel: 'CRITICAL',
    eligibilityStatus: 'ELIGIBLE',
    ...overrides,
  };
}

function event(overrides = {}) {
  return createCandidateLifecycleEvent({
    recordedAt: BASE_TIME,
    candidateId: 'candidate-a',
    fromStatus: 'NEW',
    toStatus: 'UNDER_REVIEW',
    action: 'START_REVIEW',
    actor: 'OWNER',
    reasonCode: 'NOT_SPECIFIED',
    ownerComment: null,
    candidateSnapshot: snapshot(),
    metadata: {},
    ...overrides,
  });
}

function lifecycle(events = []) {
  return {
    schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    updatedAt: events.at(-1)?.recordedAt || null,
    events,
  };
}

function lifecycleError(code) {
  return error =>
    error instanceof OwnerLearningCandidateLifecycleError &&
    error.code === code;
}

test('absent storage loads as an empty lifecycle', () => {
  assert.deepEqual(loadCandidateLifecycle({
    filePath: temporaryPath(),
  }), emptyCandidateLifecycle());
});

for (const scenario of [
  ['NEW', 'UNDER_REVIEW', 'START_REVIEW'],
  ['NEW', 'APPROVED', 'APPROVE'],
  ['NEW', 'REJECTED', 'REJECT'],
  ['NEW', 'POSTPONED', 'POSTPONE'],
  ['UNDER_REVIEW', 'APPROVED', 'APPROVE'],
  ['POSTPONED', 'UNDER_REVIEW', 'REOPEN'],
  ['REJECTED', 'UNDER_REVIEW', 'REOPEN'],
  ['APPROVED', 'UNDER_REVIEW', 'REOPEN'],
]) {
  test(`${scenario[0]} -> ${scenario[1]} is allowed`, () => {
    assert.deepEqual(validateCandidateLifecycleTransition({
      fromStatus: scenario[0],
      toStatus: scenario[1],
      action: scenario[2],
    }), {
      fromStatus: scenario[0],
      toStatus: scenario[1],
    });
  });
}

test('forbidden transition returns a controlled conflict', () => {
  assert.throws(() => validateCandidateLifecycleTransition({
    fromStatus: 'APPROVED',
    toStatus: 'REJECTED',
    action: 'REJECT',
  }), lifecycleError(
    'OWNER_LEARNING_LIFECYCLE_TRANSITION_INVALID'
  ));
});

test('transition to the same status is forbidden', () => {
  for (const status of [
    'NEW',
    'UNDER_REVIEW',
    'APPROVED',
    'REJECTED',
    'POSTPONED',
  ]) {
    assert.throws(() => validateCandidateLifecycleTransition({
      fromStatus: status,
      toStatus: status,
      action: status === 'UNDER_REVIEW' ? 'REOPEN' : 'APPROVE',
    }), lifecycleError(
      'OWNER_LEARNING_LIFECYCLE_TRANSITION_INVALID'
    ));
  }
});

test('unknown status is rejected', () => {
  assert.throws(() => validateCandidateLifecycleTransition({
    fromStatus: 'UNKNOWN',
    toStatus: 'APPROVED',
    action: 'APPROVE',
  }), lifecycleError('OWNER_LEARNING_LIFECYCLE_INVALID_INPUT'));
});

test('action must match the transition', () => {
  assert.throws(() => event({
    toStatus: 'APPROVED',
    action: 'REJECT',
  }), lifecycleError(
    'OWNER_LEARNING_LIFECYCLE_TRANSITION_INVALID'
  ));
  assert.throws(() => event({
    action: 'UNKNOWN',
  }), lifecycleError('OWNER_LEARNING_LIFECYCLE_INVALID_INPUT'));
});

test('eventId is a deterministic full SHA-256 digest', () => {
  const first = event();
  const second = event();
  assert.match(first.eventId, /^[a-f0-9]{64}$/);
  assert.equal(second.eventId, first.eventId);
  assert.notEqual(
    event({ reasonCode: 'OTHER' }).eventId,
    first.eventId
  );
});

test('duplicate event is idempotent and does not rewrite storage', () => {
  const filePath = temporaryPath();
  const value = event();
  const first = appendCandidateLifecycleEvent({
    filePath,
    event: value,
  });
  const before = fs.statSync(filePath).mtimeMs;
  const second = appendCandidateLifecycleEvent({
    filePath,
    event: value,
  });

  assert.equal(first.added, true);
  assert.equal(second.added, false);
  assert.equal(second.event.eventId, value.eventId);
  assert.equal(fs.statSync(filePath).mtimeMs, before);
  assert.equal(second.lifecycle.events.length, 1);
});

test('append stores the first event atomically', () => {
  const filePath = temporaryPath();
  const result = appendCandidateLifecycleEvent({
    filePath,
    event: event(),
  });
  assert.equal(result.added, true);
  assert.equal(loadCandidateLifecycle({ filePath }).events.length, 1);
});

test('append preserves the first event when adding a second', () => {
  const filePath = temporaryPath();
  const first = event();
  const second = event({
    recordedAt: '2026-07-25T01:00:00.000Z',
    fromStatus: 'UNDER_REVIEW',
    toStatus: 'APPROVED',
    action: 'APPROVE',
    reasonCode: 'READY_FOR_RULE',
  });
  appendCandidateLifecycleEvent({ filePath, event: first });
  appendCandidateLifecycleEvent({ filePath, event: second });
  const stored = loadCandidateLifecycle({ filePath });

  assert.equal(stored.events.length, 2);
  assert.deepEqual(stored.events[0], first);
  assert.deepEqual(stored.events[1], second);
});

test('append requires event fromStatus to match current state', () => {
  const filePath = temporaryPath();
  appendCandidateLifecycleEvent({ filePath, event: event() });
  assert.throws(() => appendCandidateLifecycleEvent({
    filePath,
    event: event({
      recordedAt: '2026-07-25T01:00:00.000Z',
      fromStatus: 'NEW',
      toStatus: 'APPROVED',
      action: 'APPROVE',
    }),
  }), lifecycleError(
    'OWNER_LEARNING_LIFECYCLE_TRANSITION_INVALID'
  ));
});

test('current state exposes the latest event only through detail state', () => {
  const first = event();
  const second = event({
    recordedAt: '2026-07-25T01:00:00.000Z',
    fromStatus: 'UNDER_REVIEW',
    toStatus: 'APPROVED',
    action: 'APPROVE',
    reasonCode: 'READY_FOR_RULE',
    ownerComment: '<private-comment>',
  });
  const state = getCandidateLifecycleState({
    lifecycle: lifecycle([first, second]),
    candidateId: 'candidate-a',
  });

  assert.equal(state.status, 'APPROVED');
  assert.equal(state.lastAction, 'APPROVE');
  assert.equal(state.reasonCode, 'READY_FOR_RULE');
  assert.equal(state.eventCount, 2);
  assert.equal(state.lastEvent.ownerComment, '<private-comment>');
});

test('candidate without events has NEW state', () => {
  const state = getCandidateLifecycleState({
    lifecycle: emptyCandidateLifecycle(),
    candidateId: 'candidate-new',
  });
  assert.deepEqual(state, {
    candidateId: 'candidate-new',
    status: 'NEW',
    lastAction: null,
    lastRecordedAt: null,
    reasonCode: null,
    eventCount: 0,
    lastEvent: null,
  });
});

test('all candidate states are sorted and independent', () => {
  const states = getCandidateLifecycleStates({
    lifecycle: lifecycle([
      event({ candidateId: 'candidate-b' }),
      event({
        candidateId: 'candidate-a',
        toStatus: 'REJECTED',
        action: 'REJECT',
      }),
    ]),
  });
  assert.deepEqual(
    states.map(value => [value.candidateId, value.status]),
    [
      ['candidate-a', 'REJECTED'],
      ['candidate-b', 'UNDER_REVIEW'],
    ]
  );
});

test('summary counts events, states, actions, reasons and period', () => {
  const first = event({
    recordedAt: '2026-07-20T00:00:00.000Z',
  });
  const second = event({
    recordedAt: '2026-07-21T00:00:00.000Z',
    fromStatus: 'UNDER_REVIEW',
    toStatus: 'APPROVED',
    action: 'APPROVE',
    reasonCode: 'READY_FOR_RULE',
  });
  const third = event({
    recordedAt: '2026-07-22T00:00:00.000Z',
    candidateId: 'candidate-b',
    toStatus: 'POSTPONED',
    action: 'POSTPONE',
    reasonCode: 'NEEDS_MORE_HISTORY',
  });
  const summary = summarizeCandidateLifecycle(
    lifecycle([first, second, third])
  );

  assert.equal(summary.totalEvents, 3);
  assert.equal(summary.uniqueCandidates, 2);
  assert.equal(summary.currentStates.APPROVED, 1);
  assert.equal(summary.currentStates.POSTPONED, 1);
  assert.equal(summary.actionsByType.START_REVIEW, 1);
  assert.equal(summary.actionsByType.APPROVE, 1);
  assert.equal(summary.reasonsByType.READY_FOR_RULE, 1);
  assert.equal(summary.firstRecordedAt, first.recordedAt);
  assert.equal(summary.lastRecordedAt, third.recordedAt);
});

test('corrupted JSON is rejected and never overwritten', () => {
  const filePath = temporaryPath();
  fs.writeFileSync(filePath, '{corrupted');
  assert.throws(() => loadCandidateLifecycle({ filePath }),
    lifecycleError('OWNER_LEARNING_LIFECYCLE_CORRUPTED'));
  assert.throws(() => appendCandidateLifecycleEvent({
    filePath,
    event: event(),
  }), lifecycleError('OWNER_LEARNING_LIFECYCLE_CORRUPTED'));
  assert.equal(fs.readFileSync(filePath, 'utf8'), '{corrupted');
});

test('unknown schemaVersion blocks load and append', () => {
  const filePath = temporaryPath();
  const source = JSON.stringify({
    schemaVersion: 'owner-learning-candidate-lifecycle-v999',
    updatedAt: null,
    events: [],
  });
  fs.writeFileSync(filePath, source);
  assert.throws(() => loadCandidateLifecycle({ filePath }),
    lifecycleError(
      'OWNER_LEARNING_LIFECYCLE_SCHEMA_UNSUPPORTED'
    ));
  assert.throws(() => appendCandidateLifecycleEvent({
    filePath,
    event: event(),
  }), lifecycleError(
    'OWNER_LEARNING_LIFECYCLE_SCHEMA_UNSUPPORTED'
  ));
  assert.equal(fs.readFileSync(filePath, 'utf8'), source);
});

test('write failure is wrapped and temporary file is cleaned', () => {
  const filePath = temporaryPath();
  const fsModule = {
    ...fs,
    renameSync() {
      const error = new Error('private path failure');
      error.code = 'EIO';
      throw error;
    },
  };
  assert.throws(() => appendCandidateLifecycleEvent({
    filePath,
    event: event(),
    fsModule,
    randomSuffix: 'write-failure',
  }), lifecycleError('OWNER_LEARNING_LIFECYCLE_WRITE_FAILED'));
  assert.deepEqual(
    fs.readdirSync(path.dirname(filePath)),
    []
  );
});

test('atomic write uses file fsync, rename and directory fsync', () => {
  const filePath = temporaryPath();
  const calls = [];
  const fsModule = {
    ...fs,
    fsyncSync(descriptor) {
      calls.push(['fsync', descriptor]);
      return fs.fsyncSync(descriptor);
    },
    renameSync(from, to) {
      calls.push(['rename', path.basename(from), path.basename(to)]);
      return fs.renameSync(from, to);
    },
  };
  atomicWriteCandidateLifecycle(
    filePath,
    lifecycle([event()]),
    { fsModule, randomSuffix: 'atomic' }
  );
  assert.equal(calls.filter(([name]) => name === 'fsync').length, 2);
  assert.equal(calls.filter(([name]) => name === 'rename').length, 1);
  assert.equal(
    fs.readdirSync(path.dirname(filePath)).some(name =>
      name.endsWith('.tmp')
    ),
    false
  );
});

test('creation and append never mutate caller-owned objects', () => {
  const input = {
    recordedAt: BASE_TIME,
    candidateId: 'candidate-a',
    fromStatus: 'NEW',
    toStatus: 'UNDER_REVIEW',
    action: 'START_REVIEW',
    candidateSnapshot: snapshot(),
    metadata: { nested: { value: 1 } },
  };
  const before = structuredClone(input);
  const created = createCandidateLifecycleEvent(input);
  assert.deepEqual(input, before);
  const filePath = temporaryPath();
  const eventBefore = structuredClone(created);
  appendCandidateLifecycleEvent({ filePath, event: created });
  assert.deepEqual(created, eventBefore);
});

test('metadata rejects secrets, paths and unsafe values', () => {
  for (const metadata of [
    { apiToken: 'secret' },
    { nested: { password: 'secret' } },
    { path: '/Users/private/data.json' },
    { value: Number.NaN },
  ]) {
    assert.throws(() => event({ metadata }),
      lifecycleError('OWNER_LEARNING_LIFECYCLE_INVALID_INPUT'));
  }
});

test('ownerComment is limited to 1000 characters', () => {
  assert.equal(event({ ownerComment: 'x'.repeat(1000) })
    .ownerComment.length, 1000);
  assert.throws(() => event({
    ownerComment: 'x'.repeat(1001),
  }), lifecycleError('OWNER_LEARNING_LIFECYCLE_INVALID_INPUT'));
});

test('recordedAt must be ISO UTC datetime', () => {
  for (const recordedAt of [
    null,
    '2026-07-25',
    '2026-07-25T00:00:00+03:00',
    'not-a-date',
  ]) {
    assert.throws(() => event({ recordedAt }),
      lifecycleError('OWNER_LEARNING_LIFECYCLE_INVALID_INPUT'));
  }
});

test('candidateId is required', () => {
  for (const candidateId of [null, undefined, '', '   ']) {
    assert.throws(() => event({ candidateId }),
      lifecycleError('OWNER_LEARNING_LIFECYCLE_INVALID_INPUT'));
  }
});

test('candidate snapshot stores only the explicit compact fields', () => {
  const created = event({
    candidateSnapshot: {
      ...snapshot(),
      scopeKey: 'private-scope',
      evidenceDecisionIds: ['private-decision'],
      ownerComment: 'private',
      metadata: { private: true },
    },
  });
  assert.deepEqual(
    Object.keys(created.candidateSnapshot).sort(),
    [
      'confidenceLevel',
      'confidenceScore',
      'displayScope',
      'eligibilityStatus',
      'patternType',
      'priorityLevel',
      'priorityScore',
      'proposedDecision',
      'proposedRuleType',
      'scopeType',
    ]
  );
  const serialized = JSON.stringify(created.candidateSnapshot);
  assert.equal(serialized.includes('private'), false);
});

test('identical lifecycle inputs produce identical output bytes', () => {
  const firstPath = temporaryPath();
  const secondPath = temporaryPath();
  const value = event();
  appendCandidateLifecycleEvent({
    filePath: firstPath,
    event: value,
    randomSuffix: 'first',
  });
  appendCandidateLifecycleEvent({
    filePath: secondPath,
    event: value,
    randomSuffix: 'second',
  });
  assert.deepEqual(
    fs.readFileSync(firstPath),
    fs.readFileSync(secondPath)
  );
});
