const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  OwnerLearningCandidateLifecycleService,
} = require(
  '../application/owner_learning_candidate_lifecycle_service'
);
const {
  loadCandidateLifecycle,
} = require(
  '../../../agents/purchasing/owner_learning/owner_learning_candidate_lifecycle'
);

const temporaryDirectories = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), {
      recursive: true,
      force: true,
    });
  }
});

function lifecyclePath() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'candidate-lifecycle-service-')
  );
  temporaryDirectories.push(directory);
  return path.join(directory, 'lifecycle.json');
}

function candidate(overrides = {}) {
  return {
    candidateId: 'candidate-a',
    patternType: 'REPEATED_ITEM_DECISION',
    scopeType: 'ITEM',
    displayScope: {
      primary: 'AWARD Hairball',
      secondary: 'SKU 7177004',
    },
    proposedRuleType: 'ITEM_DECISION',
    proposedAction: { decision: 'SKIP' },
    confidence: { score: 91, level: 'VERY_HIGH' },
    ranking: { priorityScore: 88, priorityLevel: 'HIGH' },
    eligibility: { status: 'ELIGIBLE' },
    ...overrides,
  };
}

function createService(filePath, overrides = {}) {
  const currentCandidate = candidate();
  return new OwnerLearningCandidateLifecycleService({
    lifecycleFilePath: filePath,
    now: () => '2026-07-25T01:02:03.000Z',
    logger: { warn() {} },
    candidatesService: {
      getCandidates() {
        return {
          status: 'AVAILABLE',
          candidates: [currentCandidate],
        };
      },
    },
    ...overrides,
  });
}

test('current candidate changes status with a backend snapshot', () => {
  const filePath = lifecyclePath();
  const result = createService(filePath).changeCandidateStatus({
    candidateId: 'candidate-a',
    targetStatus: 'APPROVED',
    action: 'APPROVE',
    reasonCode: 'READY_FOR_RULE',
  });

  assert.equal(result.added, true);
  assert.equal(result.state.status, 'APPROVED');
  const [stored] = loadCandidateLifecycle({ filePath }).events;
  assert.deepEqual(stored.candidateSnapshot, {
    patternType: 'REPEATED_ITEM_DECISION',
    scopeType: 'ITEM',
    displayScope: {
      primary: 'AWARD Hairball',
      secondary: 'SKU 7177004',
    },
    proposedRuleType: 'ITEM_DECISION',
    proposedDecision: 'SKIP',
    confidenceScore: 91,
    confidenceLevel: 'VERY_HIGH',
    priorityScore: 88,
    priorityLevel: 'HIGH',
    eligibilityStatus: 'ELIGIBLE',
  });
});

test('frontend candidate snapshot is ignored', () => {
  const filePath = lifecyclePath();
  createService(filePath).changeCandidateStatus({
    candidateId: 'candidate-a',
    targetStatus: 'APPROVED',
    action: 'APPROVE',
    reasonCode: 'READY_FOR_RULE',
    candidateSnapshot: {
      confidenceScore: 100,
      proposedDecision: 'BUY',
    },
  });

  const [stored] = loadCandidateLifecycle({ filePath }).events;
  assert.equal(stored.candidateSnapshot.confidenceScore, 91);
  assert.equal(stored.candidateSnapshot.proposedDecision, 'SKIP');
});

test('candidate is fetched again for every change', () => {
  const filePath = lifecyclePath();
  let calls = 0;
  const service = createService(filePath, {
    candidatesService: {
      getCandidates() {
        calls += 1;
        return {
          status: 'AVAILABLE',
          candidates: [candidate()],
        };
      },
    },
    now: (() => {
      let second = 0;
      return () =>
        `2026-07-25T01:02:${String(second++).padStart(2, '0')}.000Z`;
    })(),
  });
  service.changeCandidateStatus({
    candidateId: 'candidate-a',
    targetStatus: 'UNDER_REVIEW',
    action: 'START_REVIEW',
  });
  service.changeCandidateStatus({
    candidateId: 'candidate-a',
    targetStatus: 'APPROVED',
    action: 'APPROVE',
    reasonCode: 'READY_FOR_RULE',
  });
  assert.equal(calls, 2);
});

test('candidate not available is a controlled conflict', () => {
  const service = createService(lifecyclePath(), {
    candidatesService: {
      getCandidates() {
        return { status: 'AVAILABLE', candidates: [] };
      },
    },
  });
  assert.throws(
    () => service.changeCandidateStatus({
      candidateId: 'candidate-a',
      targetStatus: 'APPROVED',
      action: 'APPROVE',
      reasonCode: 'READY_FOR_RULE',
    }),
    error => error.code === 'CANDIDATE_NOT_AVAILABLE'
  );
});

test('invalid transition remains controlled', () => {
  const service = createService(lifecyclePath());
  service.changeCandidateStatus({
    candidateId: 'candidate-a',
    targetStatus: 'APPROVED',
    action: 'APPROVE',
    reasonCode: 'READY_FOR_RULE',
  });
  assert.throws(
    () => service.changeCandidateStatus({
      candidateId: 'candidate-a',
      targetStatus: 'POSTPONED',
      action: 'POSTPONE',
      reasonCode: 'NEEDS_MORE_HISTORY',
    }),
    error =>
      error.code === 'OWNER_LEARNING_LIFECYCLE_TRANSITION_INVALID'
  );
});

test('repeated identical request does not append a duplicate', () => {
  const filePath = lifecyclePath();
  const service = createService(filePath);
  const input = {
    candidateId: 'candidate-a',
    targetStatus: 'APPROVED',
    action: 'APPROVE',
    reasonCode: 'READY_FOR_RULE',
  };
  assert.equal(service.changeCandidateStatus(input).added, true);
  assert.equal(service.changeCandidateStatus(input).added, false);
  assert.equal(
    loadCandidateLifecycle({ filePath }).events.length,
    1
  );
});

test('reject and postpone require an explicit reason', () => {
  for (const targetStatus of ['REJECTED', 'POSTPONED']) {
    const action = targetStatus === 'REJECTED' ? 'REJECT' : 'POSTPONE';
    assert.throws(
      () => createService(lifecyclePath()).changeCandidateStatus({
        candidateId: 'candidate-a',
        targetStatus,
        action,
      }),
      error =>
        error.code === 'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT'
    );
  }
});

test('corrupted lifecycle is unavailable and is not overwritten', () => {
  const filePath = lifecyclePath();
  fs.writeFileSync(filePath, '{broken', 'utf8');
  const service = createService(filePath);
  assert.throws(
    () => service.getCandidateStates(),
    error => error.code === 'OWNER_LEARNING_LIFECYCLE_UNAVAILABLE'
  );
  assert.equal(fs.readFileSync(filePath, 'utf8'), '{broken');
});

test('list and detail expose derived state without mutating storage', () => {
  const filePath = lifecyclePath();
  const service = createService(filePath);
  service.changeCandidateStatus({
    candidateId: 'candidate-a',
    targetStatus: 'UNDER_REVIEW',
    action: 'START_REVIEW',
  });
  const before = fs.readFileSync(filePath, 'utf8');
  assert.equal(service.getCandidateStates().states[0].status, 'UNDER_REVIEW');
  assert.equal(
    service.getCandidateState({ candidateId: 'candidate-a' }).status,
    'UNDER_REVIEW'
  );
  assert.equal(fs.readFileSync(filePath, 'utf8'), before);
});
