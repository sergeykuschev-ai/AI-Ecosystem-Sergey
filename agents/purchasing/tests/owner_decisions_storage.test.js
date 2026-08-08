const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  OwnerDecisionError,
  appendOwnerDecision,
  loadOwnerDecisions,
} = require('../matrix_builder/owner_decisions');
const {
  SafeJsonStoreError,
  atomicWriteJsonFile,
  cleanStaleTemporaryFiles,
  readJsonFileWithRecovery,
  rotateBackup,
} = require('../../../shared/storage/safe_json_store');

function decision(ownerDecision, overrides = {}) {
  return {
    sku: overrides.sku || 'SKU-1',
    owner_decision: ownerDecision,
    owner_role_override: null,
    owner_policy_override: null,
    reason: overrides.reason || 'Решение владельца',
    decided_at: overrides.decided_at || '2026-07-20T10:00:00.000Z',
    decided_by: overrides.decided_by || 'owner',
    status: overrides.status || 'active',
    source_version: overrides.source_version || 'miska-matrix-builder-v0.5.3',
    ...overrides,
  };
}

function store(decisions) {
  return {
    version: 1,
    store: 'Миска',
    updated_at: decisions.at(-1)?.decided_at || null,
    decisions,
  };
}

test('atomicWriteJsonFile writes valid JSON atomically with fsync', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-json-'));
  const filePath = path.join(directory, 'state.json');
  try {
    atomicWriteJsonFile(filePath, { version: 1, items: [] });
    assert.equal(fs.existsSync(filePath), true);
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.deepEqual(parsed, { version: 1, items: [] });
    const tmps = fs.readdirSync(directory).filter(name => name.endsWith('.tmp'));
    assert.equal(tmps.length, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('readJsonFileWithRecovery throws safe error when file missing', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-json-'));
  const filePath = path.join(directory, 'missing.json');
  try {
    assert.throws(
      () => readJsonFileWithRecovery(filePath),
      error => error instanceof SafeJsonStoreError && error.code === 'SAFE_JSON_NOT_FOUND'
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('readJsonFileWithRecovery recovers from backup when main is corrupted', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-json-'));
  const filePath = path.join(directory, 'state.json');
  try {
    fs.writeFileSync(filePath, JSON.stringify({ version: 1, value: 'valid' }), 'utf8');
    rotateBackup(filePath, { maxBackups: 5 });
    fs.writeFileSync(filePath, '{ damaged', 'utf8');

    const result = readJsonFileWithRecovery(filePath);
    assert.equal(result.data.version, 1);
    assert.equal(result.data.value, 'valid');
    assert.ok(result.recoveredFrom);
    assert.equal(result.diagnostic.code, 'SAFE_JSON_RECOVERED_FROM_BACKUP');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('readJsonFileWithRecovery throws safe error when main and backups are corrupted', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-json-'));
  const filePath = path.join(directory, 'state.json');
  try {
    fs.writeFileSync(filePath, JSON.stringify({ version: 1 }), 'utf8');
    rotateBackup(filePath, { maxBackups: 5 });
    fs.writeFileSync(filePath, '{ damaged main', 'utf8');
    const backups = fs.readdirSync(directory).filter(name => name.includes('.backup.'));
    for (const backup of backups) {
      fs.writeFileSync(path.join(directory, backup), '{ damaged backup', 'utf8');
    }

    assert.throws(
      () => readJsonFileWithRecovery(filePath),
      error => error instanceof SafeJsonStoreError && error.code === 'SAFE_JSON_CORRUPTED'
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('rotateBackup keeps only N most recent backups', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-json-'));
  const filePath = path.join(directory, 'state.json');
  try {
    for (let index = 0; index < 7; index += 1) {
      fs.writeFileSync(filePath, JSON.stringify({ version: index }), 'utf8');
      rotateBackup(filePath, { maxBackups: 5 });
    }
    const backups = fs.readdirSync(directory).filter(name => name.includes('.backup.'));
    assert.equal(backups.length, 5);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cleanStaleTemporaryFiles removes only stale files matching pattern', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-json-'));
  try {
    const stale = path.join(directory, '.state.123-abc.tmp');
    const fresh = path.join(directory, '.state.456-def.tmp');
    const other = path.join(directory, 'other.tmp');
    fs.writeFileSync(stale, 'x', 'utf8');
    fs.writeFileSync(fresh, 'y', 'utf8');
    fs.writeFileSync(other, 'z', 'utf8');
    const oldMtime = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(stale, oldMtime, oldMtime);

    const result = cleanStaleTemporaryFiles(
      directory,
      '.state.*.tmp',
      5 * 60 * 1000
    );
    assert.equal(result.removed, 1);
    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.existsSync(fresh), true);
    assert.equal(fs.existsSync(other), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('loadOwnerDecisions recovers from backup when main file is corrupted', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-decisions-'));
  const filePath = path.join(directory, 'decisions.json');
  try {
    fs.writeFileSync(filePath, JSON.stringify(store([decision('KEEP_CORE')])), 'utf8');
    rotateBackup(filePath, { maxBackups: 5 });
    fs.writeFileSync(filePath, '{ damaged', 'utf8');

    const loaded = loadOwnerDecisions(filePath);
    assert.equal(loaded.missing, false);
    assert.equal(loaded.recovery.code, 'SAFE_JSON_RECOVERED_FROM_BACKUP');
    assert.equal(loaded.store.decisions.length, 1);
    assert.equal(loaded.store.decisions[0].owner_decision, 'KEEP_CORE');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('loadOwnerDecisions throws safe error when corrupted and no backup exists', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-decisions-'));
  const filePath = path.join(directory, 'decisions.json');
  try {
    fs.writeFileSync(filePath, '{ damaged', 'utf8');
    assert.throws(
      () => loadOwnerDecisions(filePath),
      error => error instanceof OwnerDecisionError && error.code === 'OWNER_DECISION_FILE_ERROR'
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('appendOwnerDecision cleans stale tmp files and writes successfully', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-decisions-'));
  const filePath = path.join(directory, 'decisions.json');
  const staleTmp = path.join(directory, '.decisions.json.123-abc.tmp');
  try {
    fs.writeFileSync(staleTmp, 'stale', 'utf8');
    const oldMtime = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(staleTmp, oldMtime, oldMtime);

    appendOwnerDecision(filePath, decision('KEEP_CORE'));
    assert.equal(fs.existsSync(staleTmp), false);
    const loaded = loadOwnerDecisions(filePath).store;
    assert.equal(loaded.decisions.length, 1);
    assert.equal(loaded.decisions[0].owner_decision, 'KEEP_CORE');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('appendOwnerDecision creates a backup before overwrite', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-decisions-'));
  const filePath = path.join(directory, 'decisions.json');
  try {
    appendOwnerDecision(filePath, decision('KEEP_CORE'));
    const backupsBefore = fs.readdirSync(directory).filter(name => name.includes('.backup.'));
    assert.equal(backupsBefore.length, 0);

    appendOwnerDecision(filePath, decision('KEEP_OPTIONAL', {
      decided_at: '2026-07-21T10:00:00.000Z',
    }));
    const backupsAfter = fs.readdirSync(directory).filter(name => name.includes('.backup.'));
    assert.equal(backupsAfter.length, 1);

    const loaded = loadOwnerDecisions(filePath).store;
    assert.equal(loaded.decisions.length, 2);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('two parallel decisions for different SKU are both saved', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-decisions-'));
  const filePath = path.join(directory, 'decisions.json');
  try {
    await Promise.all([
      appendOwnerDecision(filePath, decision('BUY', {
        sku: 'SKU-A',
        owner_order_quantity: 5,
      })),
      appendOwnerDecision(filePath, decision('SKIP', {
        sku: 'SKU-B',
        decided_at: '2026-07-21T10:00:00.000Z',
      })),
    ]);
    const loaded = loadOwnerDecisions(filePath).store;
    assert.equal(loaded.decisions.length, 2);
    const decisionsBySku = new Map(loaded.decisions.map(d => [d.sku, d]));
    assert.equal(decisionsBySku.get('SKU-A').owner_decision, 'BUY');
    assert.equal(decisionsBySku.get('SKU-B').owner_decision, 'SKIP');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('repeated identical idempotencyKey does not duplicate decision records', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-decisions-'));
  const filePath = path.join(directory, 'decisions.json');
  try {
    const first = appendOwnerDecision(filePath, decision('BUY', {
      owner_order_quantity: 3,
    }), { idempotencyKey: 'key-1' });
    assert.equal(first.duplicate, false);

    const second = appendOwnerDecision(filePath, decision('SKIP', {
      decided_at: '2026-07-21T10:00:00.000Z',
    }), { idempotencyKey: 'key-1' });
    assert.equal(second.duplicate, true);
    assert.equal(second.decision.owner_decision, 'BUY');

    const loaded = loadOwnerDecisions(filePath).store;
    assert.equal(loaded.decisions.length, 1);
    assert.equal(loaded.decisions[0].idempotency_key, 'key-1');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('appendOwnerDecision uses random tmp name and does not collide on sequential calls', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-decisions-'));
  const filePath = path.join(directory, 'decisions.json');
  try {
    for (let index = 0; index < 10; index += 1) {
      appendOwnerDecision(filePath, decision('BUY', {
        sku: `SKU-${index}`,
        owner_order_quantity: index,
        decided_at: new Date(Date.now() + index).toISOString(),
      }));
    }
    const loaded = loadOwnerDecisions(filePath).store;
    assert.equal(loaded.decisions.length, 10);
    const tmps = fs.readdirSync(directory).filter(name => name.endsWith('.tmp'));
    assert.equal(tmps.length, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});


