const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  MATERIALIZATION_JOURNAL_SCHEMA_VERSION,
  appendMaterializationEvent,
  emptyMaterializationJournal,
  findMaterializationByCandidate,
  findMaterializationByRule,
  loadMaterializationJournal,
  summarizeMaterializations,
} = require(
  '../owner_learning/owner_rule_materialization_journal'
);

const directories = [];
afterEach(() => {
  while (directories.length) {
    fs.rmSync(directories.pop(), { recursive: true, force: true });
  }
});

function filePath() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rule-materializations-')
  );
  directories.push(directory);
  return path.join(directory, 'journal.json');
}

function event(overrides = {}) {
  return {
    schemaVersion: MATERIALIZATION_JOURNAL_SCHEMA_VERSION,
    materializationId: 'materialization-a',
    recordedAt: '2026-07-25T04:00:00.000Z',
    candidateId: 'candidate-a',
    lifecycleEventId: 'lifecycle-a',
    ruleId: 'rule-a',
    resultStatus: 'CREATED',
    ruleStatus: 'DISABLED',
    fingerprint: 'fingerprint-a',
    snapshot: {
      patternType: 'SAME_ITEM_SAME_DECISION',
      proposedRuleType: 'ITEM_DECISION_OVERRIDE',
      proposedDecision: 'SKIP',
      confidenceScore: 91,
      confidenceLevel: 'VERY_HIGH',
      priorityScore: 88,
      priorityLevel: 'HIGH',
    },
    metadata: {},
    ...overrides,
  };
}

test('absent storage is empty', () => {
  assert.deepEqual(
    loadMaterializationJournal({ filePath: filePath() }),
    emptyMaterializationJournal()
  );
});

test('append first and second event preserves order', () => {
  const target = filePath();
  appendMaterializationEvent({ filePath: target, event: event() });
  appendMaterializationEvent({
    filePath: target,
    event: event({
      materializationId: 'materialization-b',
      candidateId: 'candidate-b',
      ruleId: 'rule-b',
      recordedAt: '2026-07-25T05:00:00.000Z',
    }),
  });
  assert.deepEqual(
    loadMaterializationJournal({ filePath: target }).events.map(
      value => value.candidateId
    ),
    ['candidate-a', 'candidate-b']
  );
});

test('duplicate event does not rewrite storage', () => {
  const target = filePath();
  appendMaterializationEvent({ filePath: target, event: event() });
  const before = fs.readFileSync(target, 'utf8');
  const result = appendMaterializationEvent({
    filePath: target,
    event: event(),
  });
  assert.equal(result.added, false);
  assert.equal(fs.readFileSync(target, 'utf8'), before);
});

test('finds materialization by candidate and rule', () => {
  const target = filePath();
  appendMaterializationEvent({ filePath: target, event: event() });
  const journal = loadMaterializationJournal({ filePath: target });
  assert.equal(
    findMaterializationByCandidate(journal, 'candidate-a').ruleId,
    'rule-a'
  );
  assert.equal(
    findMaterializationByRule(journal, 'rule-a').candidateId,
    'candidate-a'
  );
});

test('summary is complete', () => {
  const target = filePath();
  appendMaterializationEvent({ filePath: target, event: event() });
  assert.deepEqual(
    summarizeMaterializations(
      loadMaterializationJournal({ filePath: target })
    ),
    {
      totalEvents: 1,
      created: 1,
      repaired: 0,
      disabledRules: 1,
      firstRecordedAt: '2026-07-25T04:00:00.000Z',
      lastRecordedAt: '2026-07-25T04:00:00.000Z',
    }
  );
});

test('corrupted JSON is not overwritten', () => {
  const target = filePath();
  fs.writeFileSync(target, '{broken', 'utf8');
  assert.throws(() => appendMaterializationEvent({
    filePath: target,
    event: event(),
  }));
  assert.equal(fs.readFileSync(target, 'utf8'), '{broken');
});

test('unsupported schema blocks write', () => {
  const target = filePath();
  fs.writeFileSync(target, JSON.stringify({
    schemaVersion: 'future',
    updatedAt: null,
    events: [],
  }), 'utf8');
  assert.throws(
    () => appendMaterializationEvent({
      filePath: target,
      event: event(),
    }),
    error =>
      error.code ===
        'RULE_MATERIALIZATION_JOURNAL_SCHEMA_UNSUPPORTED'
  );
});

test('write is atomic and fsynced', () => {
  const target = filePath();
  let renamed = 0;
  let synced = 0;
  appendMaterializationEvent({
    filePath: target,
    event: event(),
    fsModule: {
      ...fs,
      renameSync(...args) {
        renamed += 1;
        return fs.renameSync(...args);
      },
      fsyncSync(...args) {
        synced += 1;
        return fs.fsyncSync(...args);
      },
    },
  });
  assert.equal(renamed, 1);
  assert.ok(synced >= 2);
});

test('unsafe metadata is rejected', () => {
  for (const metadata of [
    { token: 'secret' },
    { sourcePath: '/private/data' },
  ]) {
    assert.throws(() => appendMaterializationEvent({
      filePath: filePath(),
      event: event({ metadata }),
    }));
  }
});

test('append is deterministic and does not mutate event', () => {
  const target = filePath();
  const source = event();
  const before = structuredClone(source);
  appendMaterializationEvent({ filePath: target, event: source });
  assert.deepEqual(source, before);
});
