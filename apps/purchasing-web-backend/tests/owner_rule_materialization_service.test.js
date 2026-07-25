const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  OwnerRuleMaterializationService,
} = require('../application/owner_rule_materialization_service');
const {
  loadApprovedRules,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_registry'
);
const {
  loadMaterializationJournal,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_materialization_journal'
);

const directories = [];
const CANDIDATE_ID = 'a'.repeat(64);

afterEach(() => {
  while (directories.length) {
    fs.rmSync(directories.pop(), { recursive: true, force: true });
  }
});

function paths() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'materialization-service-')
  );
  directories.push(directory);
  return {
    registryPath: path.join(directory, 'rules.json'),
    registryMarkdownPath: path.join(directory, 'rules.md'),
    materializationsFilePath: path.join(directory, 'journal.json'),
  };
}

function candidate(overrides = {}) {
  return {
    candidateId: CANDIDATE_ID,
    patternType: 'SAME_ITEM_SAME_DECISION',
    proposedRuleType: 'ITEM_DECISION_OVERRIDE',
    scopeType: 'ITEM',
    scopeKey: 'sku:7177004',
    displayScope: {
      primary: 'AWARD Hairball',
      secondary: 'SKU 7177004',
    },
    proposedAction: {
      decision: 'SKIP',
      quantityStrategy: 'NO_QUANTITY_CHANGE',
      quantityValue: null,
    },
    confidence: { score: 91, level: 'VERY_HIGH' },
    ranking: { priorityScore: 88, priorityLevel: 'HIGH' },
    eligibility: { status: 'ELIGIBLE' },
    ...overrides,
  };
}

function lifecycle(overrides = {}) {
  return {
    candidateId: CANDIDATE_ID,
    status: 'APPROVED',
    lastEvent: {
      eventId: 'lifecycle-approved-a',
      toStatus: 'APPROVED',
    },
    ...overrides,
  };
}

function service(storage, overrides = {}) {
  return new OwnerRuleMaterializationService({
    ...storage,
    now: () => '2026-07-25T04:00:00.000Z',
    logger: { warn() {} },
    candidatesService: {
      getCandidates() {
        return {
          status: 'AVAILABLE',
          candidates: [candidate()],
        };
      },
    },
    lifecycleService: {
      getCandidateState() {
        return lifecycle();
      },
    },
    ...overrides,
  });
}

test('approved candidate creates one disabled registry rule', () => {
  const storage = paths();
  const result = service(storage).materializeCandidateRule({
    candidateId: CANDIDATE_ID,
  });
  assert.equal(result.status, 'CREATED');
  assert.equal(result.rule.status, 'DISABLED');
  assert.equal(result.rule.ruleType, 'ITEM_DECISION_OVERRIDE');
  assert.equal(
    result.rule.provenance.candidateId,
    CANDIDATE_ID
  );
  assert.equal(loadApprovedRules(storage).rules.length, 1);
  assert.equal(
    loadMaterializationJournal({
      filePath: storage.materializationsFilePath,
    }).events.length,
    1
  );
});

test('backend reloads candidate and lifecycle', () => {
  const storage = paths();
  let candidateCalls = 0;
  let lifecycleCalls = 0;
  service(storage, {
    candidatesService: {
      getCandidates() {
        candidateCalls += 1;
        return {
          status: 'AVAILABLE',
          candidates: [candidate()],
        };
      },
    },
    lifecycleService: {
      getCandidateState() {
        lifecycleCalls += 1;
        return lifecycle();
      },
    },
  }).materializeCandidateRule({ candidateId: CANDIDATE_ID });
  assert.equal(candidateCalls, 1);
  assert.equal(lifecycleCalls, 1);
});

test('frontend cannot inject candidate, decision or status', () => {
  const storage = paths();
  const result = service(storage).materializeCandidateRule({
    candidateId: CANDIDATE_ID,
    candidate: { proposedAction: { decision: 'BUY' } },
    status: 'ACTIVE',
  });
  assert.equal(result.rule.approvedDecision, 'SKIP');
  assert.equal(result.rule.status, 'DISABLED');
});

test('missing candidate is controlled', () => {
  const storage = paths();
  assert.throws(
    () => service(storage, {
      candidatesService: {
        getCandidates() {
          return { status: 'AVAILABLE', candidates: [] };
        },
      },
    }).materializeCandidateRule({ candidateId: CANDIDATE_ID }),
    error => error.code === 'CANDIDATE_NOT_AVAILABLE'
  );
});

test('not approved, not eligible and unsupported are controlled', () => {
  const scenarios = [
    {
      overrides: {
        lifecycleService: {
          getCandidateState() {
            return lifecycle({ status: 'NEW' });
          },
        },
      },
      code: 'CANDIDATE_NOT_APPROVED',
    },
    {
      overrides: {
        candidatesService: {
          getCandidates() {
            return {
              status: 'AVAILABLE',
              candidates: [candidate({
                eligibility: { status: 'REVIEW_ONLY' },
              })],
            };
          },
        },
      },
      code: 'CANDIDATE_NOT_ELIGIBLE',
    },
    {
      overrides: {
        candidatesService: {
          getCandidates() {
            return {
              status: 'AVAILABLE',
              candidates: [candidate({ scopeType: 'BRAND' })],
            };
          },
        },
      },
      code: 'CANDIDATE_TYPE_NOT_MATERIALIZABLE',
    },
  ];
  for (const scenario of scenarios) {
    assert.throws(
      () => service(paths(), scenario.overrides)
        .materializeCandidateRule({ candidateId: CANDIDATE_ID }),
      error => error.code === scenario.code
    );
  }
});

test('registry failure writes no journal event', () => {
  const storage = paths();
  assert.throws(
    () => service(storage, {
      saveRegistry() {
        throw new Error('registry down');
      },
    }).materializeCandidateRule({ candidateId: CANDIDATE_ID }),
    error => error.code === 'RULE_REGISTRY_UNAVAILABLE'
  );
  assert.equal(
    loadMaterializationJournal({
      filePath: storage.materializationsFilePath,
    }).events.length,
    0
  );
});

test('retry repairs journal after registry-only partial success', () => {
  const storage = paths();
  assert.throws(
    () => service(storage, {
      appendEvent() {
        throw new Error('journal down');
      },
    }).materializeCandidateRule({ candidateId: CANDIDATE_ID }),
    error =>
      error.code === 'RULE_MATERIALIZATION_STORAGE_UNAVAILABLE'
  );
  assert.equal(loadApprovedRules(storage).rules.length, 1);

  const retry = service(storage).materializeCandidateRule({
    candidateId: CANDIDATE_ID,
  });
  assert.equal(retry.status, 'ALREADY_MATERIALIZED');
  assert.equal(loadApprovedRules(storage).rules.length, 1);
  const journal = loadMaterializationJournal({
    filePath: storage.materializationsFilePath,
  });
  assert.equal(journal.events.length, 1);
  assert.equal(
    journal.events[0].resultStatus,
    'ALREADY_MATERIALIZED'
  );
});

test('duplicate request returns existing rule without registry rewrite', () => {
  const storage = paths();
  const instance = service(storage);
  instance.materializeCandidateRule({ candidateId: CANDIDATE_ID });
  const before = fs.readFileSync(storage.registryPath, 'utf8');
  const duplicate = instance.materializeCandidateRule({
    candidateId: CANDIDATE_ID,
  });
  assert.equal(duplicate.status, 'ALREADY_MATERIALIZED');
  assert.equal(fs.readFileSync(storage.registryPath, 'utf8'), before);
  assert.equal(loadApprovedRules(storage).rules.length, 1);
});

test('read APIs return detail and summary', () => {
  const storage = paths();
  const instance = service(storage);
  instance.materializeCandidateRule({ candidateId: CANDIDATE_ID });
  assert.equal(
    instance.getMaterializationByCandidate({
      candidateId: CANDIDATE_ID,
    }).ruleStatus,
    'DISABLED'
  );
  assert.equal(instance.listMaterializations().summary.totalEvents, 1);
});
