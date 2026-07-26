const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  PREVIEW_STORAGE_SCHEMA_VERSION,
  cleanupExpiredActivationPreviews,
  getActivationPreview,
  loadActivationPreviews,
  saveActivationPreview,
} = require('../application/owner_rule_activation_preview_storage');

const directories = [];
const NOW = '2026-07-26T03:00:00.000Z';

afterEach(() => {
  while (directories.length) {
    fs.rmSync(directories.pop(), { recursive: true, force: true });
  }
});

function temporaryFile() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rule-preview-storage-')
  );
  directories.push(directory);
  return path.join(directory, 'previews.json');
}

function preview(overrides = {}) {
  return {
    previewId: 'preview-1',
    createdAt: NOW,
    expiresAt: '2026-07-26T03:15:00.000Z',
    ruleId: 'rule-1',
    targetStatus: 'ACTIVE',
    runId: '11111111-1111-4111-8111-111111111111',
    registryFingerprint: 'a'.repeat(64),
    runFingerprint: 'b'.repeat(64),
    financiallyPermitted: true,
    criticalWarnings: [],
    impactSnapshot: {
      previewId: 'preview-1',
      affectedItems: 1,
      orderAmountBefore: 50,
      orderAmountAfter: 0,
      changedItems: [{
        productName: 'Товар',
        sku: 'SKU-1',
        quantityBefore: 5,
        quantityAfter: 0,
      }],
      warnings: [],
    },
    ...overrides,
  };
}

test('creates and loads a compact preview', () => {
  const filePath = temporaryFile();
  saveActivationPreview({
    filePath,
    preview: preview(),
    now: () => new Date(NOW),
  });
  const storage = loadActivationPreviews({ filePath });
  assert.equal(storage.schemaVersion, PREVIEW_STORAGE_SCHEMA_VERSION);
  assert.equal(storage.previews.length, 1);
  assert.equal(storage.previews[0].ruleId, 'rule-1');
  assert.equal(
    JSON.stringify(storage).includes('workingOrderProducts'),
    false
  );
});

test('loads an unexpired preview by id', () => {
  const filePath = temporaryFile();
  saveActivationPreview({
    filePath,
    preview: preview(),
    now: () => new Date(NOW),
  });
  const loaded = getActivationPreview({
    filePath,
    previewId: 'preview-1',
    now: () => new Date('2026-07-26T03:14:59.000Z'),
  });
  assert.equal(loaded.previewId, 'preview-1');
});

test('rejects expired and missing previews', () => {
  const filePath = temporaryFile();
  saveActivationPreview({
    filePath,
    preview: preview(),
    now: () => new Date(NOW),
  });
  assert.throws(
    () => getActivationPreview({
      filePath,
      previewId: 'preview-1',
      now: () => new Date('2026-07-26T03:15:00.000Z'),
    }),
    { code: 'PREVIEW_EXPIRED' }
  );
  assert.throws(
    () => getActivationPreview({
      filePath,
      previewId: 'missing',
      now: () => new Date(NOW),
    }),
    { code: 'PREVIEW_REQUIRED' }
  );
});

test('preview identity retains rule, target and fingerprints', () => {
  const filePath = temporaryFile();
  saveActivationPreview({
    filePath,
    preview: preview(),
    now: () => new Date(NOW),
  });
  const [loaded] = loadActivationPreviews({ filePath }).previews;
  assert.equal(loaded.ruleId, 'rule-1');
  assert.equal(loaded.targetStatus, 'ACTIVE');
  assert.equal(loaded.registryFingerprint, 'a'.repeat(64));
  assert.equal(loaded.runFingerprint, 'b'.repeat(64));
});

test('corrupted storage is not overwritten', () => {
  const filePath = temporaryFile();
  fs.writeFileSync(filePath, '{broken', 'utf8');
  assert.throws(
    () => saveActivationPreview({
      filePath,
      preview: preview(),
      now: () => new Date(NOW),
    }),
    { code: 'RULE_ACTIVATION_PREVIEW_UNAVAILABLE' }
  );
  assert.equal(fs.readFileSync(filePath, 'utf8'), '{broken');
});

test('unsupported storage schema blocks writes', () => {
  const filePath = temporaryFile();
  const source = '{"schemaVersion":"future","updatedAt":null,"previews":[]}';
  fs.writeFileSync(filePath, source, 'utf8');
  assert.throws(
    () => saveActivationPreview({
      filePath,
      preview: preview(),
      now: () => new Date(NOW),
    }),
    { code: 'RULE_ACTIVATION_PREVIEW_UNAVAILABLE' }
  );
  assert.equal(fs.readFileSync(filePath, 'utf8'), source);
});

test('cleanup removes only expired previews', () => {
  const filePath = temporaryFile();
  saveActivationPreview({
    filePath,
    preview: preview({
      previewId: 'expired',
      expiresAt: '2026-07-26T03:05:00.000Z',
      impactSnapshot: {
        previewId: 'expired',
        affectedItems: 0,
      },
    }),
    now: () => new Date(NOW),
  });
  saveActivationPreview({
    filePath,
    preview: preview({ previewId: 'current' }),
    now: () => new Date(NOW),
  });
  const result = cleanupExpiredActivationPreviews({
    filePath,
    now: () => new Date('2026-07-26T03:06:00.000Z'),
  });
  assert.deepEqual(result, { removed: 1, retained: 1 });
  assert.equal(
    loadActivationPreviews({ filePath }).previews[0].previewId,
    'current'
  );
});

test('blocks full order, owner comment and path payloads', () => {
  for (const impactSnapshot of [
    { workingOrder: [] },
    { ownerComment: 'private' },
    { diagnosticPath: '/private/tmp/result.json' },
  ]) {
    assert.throws(
      () => saveActivationPreview({
        filePath: temporaryFile(),
        preview: preview({ impactSnapshot }),
        now: () => new Date(NOW),
      }),
      { code: 'OWNER_RULE_STATUS_INVALID_INPUT' }
    );
  }
});
