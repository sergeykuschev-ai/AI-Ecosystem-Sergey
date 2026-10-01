'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildDataset } = require('../src/dataset');
const { renderAudit } = require('../src/audit');

const FIXTURES = path.join(__dirname, 'fixtures');

/**
 * @param {import('../src/dataset').Dataset} dataset
 * @param {string} sku
 * @returns {import('../src/dataset').SkuRecord}
 */
function recordOf(dataset, sku) {
  const record = dataset.records.find((r) => r.sku === sku);
  assert.ok(record, `record ${sku} must exist`);
  return record;
}

/**
 * @template T
 * @param {T | null | undefined} value
 * @param {string} message
 * @returns {T}
 */
function present(value, message) {
  assert.ok(value !== null && value !== undefined, message);
  return value;
}

/**
 * @returns {{ snapshot: unknown[], evidence: unknown[] }}
 */
function loadFixtures() {
  const snapshot = JSON.parse(fs.readFileSync(path.join(FIXTURES, '1c-snapshot.synthetic.json'), 'utf8'));
  const evidence = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'evidence.synthetic.json'), 'utf8'));
  return { snapshot, evidence };
}

/**
 * @param {unknown[]} snapshot
 * @param {unknown[]} evidence
 */
function build(snapshot, evidence) {
  return buildDataset({
    snapshotRows: snapshot,
    evidenceRecords: evidence,
    generatedAt: '2026-10-01',
    snapshotPath: 'tests/fixtures/1c-snapshot.synthetic.json',
    evidencePath: 'tests/fixtures/evidence.synthetic.json',
  });
}

test('buildDataset re-derives the eligible SKU set from the snapshot', () => {
  const { snapshot, evidence } = loadFixtures();
  const dataset = build(snapshot, evidence);

  assert.equal(dataset.source_set.snapshot_present, true);
  assert.equal(dataset.source_set.snapshot_rows_total, 8);
  assert.equal(dataset.source_set.eligible_sku_count, 5);
  assert.equal(dataset.summary.total_eligible, 5);
  assert.deepEqual(
    dataset.records.map((r) => r.sku),
    ['SYNTH-A1', 'SYNTH-A2', 'SYNTH-B1', 'SYNTH-C1', 'SYNTH-F1'],
  );
});

test('buildDataset classifies statuses and confidences deterministically', () => {
  const { snapshot, evidence } = loadFixtures();
  const dataset = build(snapshot, evidence);

  const b1 = recordOf(dataset, 'SYNTH-B1');
  assert.equal(b1.evidence_status, 'VERIFIED');
  assert.equal(b1.logistics_confidence, 'HIGH');
  assert.equal(present(b1.weight, 'b1 weight').normalized_g, 640);
  const b1Dims = present(b1.dimensions, 'b1 dimensions');
  assert.equal(b1Dims.complete, true);
  assert.equal(b1Dims.kind, 'LWH');

  const a1 = recordOf(dataset, 'SYNTH-A1');
  assert.equal(a1.evidence_status, 'VERIFIED');
  assert.equal(a1.logistics_confidence, 'MEDIUM');
  assert.equal(present(a1.dimensions, 'a1 dimensions').kind, 'DH');
  assert.ok(a1.notes.includes('similar-only'), 'similar-only evidence should be noted');

  const a2 = recordOf(dataset, 'SYNTH-A2');
  assert.equal(a2.evidence_status, 'PARTIAL');
  assert.equal(a2.logistics_confidence, 'LOW');
  const a2Weight = present(a2.weight, 'a2 weight');
  assert.equal(a2Weight.basis, 'VOLUME_EQUIV');
  assert.equal(a2Weight.normalized_g, undefined);
  assert.equal(a2Weight.source_reported_weight, 250);
  assert.ok(a2.notes.includes('liquid volume'));

  const c1 = recordOf(dataset, 'SYNTH-C1');
  assert.equal(c1.evidence_status, 'NEEDS_SOURCE');
  assert.equal(c1.logistics_confidence, null);

  const f1 = recordOf(dataset, 'SYNTH-F1');
  assert.equal(f1.evidence_status, 'CONFLICT');
  assert.equal(f1.conflicts.length, 1);
  assert.equal(f1.conflicts[0].fact, 'weight');
});

test('buildDataset summary counts exact matches, verified and unresolved SKUs', () => {
  const { snapshot, evidence } = loadFixtures();
  const dataset = build(snapshot, evidence);

  assert.equal(dataset.summary.exact_matches, 4);
  assert.equal(dataset.summary.verified, 2);
  assert.equal(dataset.summary.verified_complete_lwh_weight, 2);
  assert.equal(dataset.summary.partial, 1);
  assert.equal(dataset.summary.conflict, 1);
  assert.equal(dataset.summary.needs_source, 1);
  assert.deepEqual(dataset.summary.unresolved_skus, ['SYNTH-C1', 'SYNTH-F1']);
  assert.deepEqual(dataset.summary.by_brand, { SynthWax: 4, OtherBrand: 1 });
});

test('buildDataset rejects invalid evidence and ignores off-snapshot SKUs', () => {
  const { snapshot, evidence } = loadFixtures();
  const dataset = build(snapshot, evidence);

  assert.equal(dataset.summary.rejected_evidence.length, 1);
  assert.equal(dataset.summary.rejected_evidence[0].sku, 'SYNTH-A2');
  assert.ok(
    dataset.summary.rejected_evidence[0].problems.some((p) => p.includes('volume must never become shipping weight')),
  );
  assert.equal(dataset.summary.ignored_evidence.length, 1);
  assert.equal(dataset.summary.ignored_evidence[0].sku, 'GHOST-1');
});

test('buildDataset never lets a specialist retailer override an official source', () => {
  const { snapshot } = loadFixtures();
  const evidence = [
    {
      sku: 'SYNTH-B1',
      identity_match: 'EXACT',
      sources: [
        { url: 'https://synthwax.example.com/products/b1', type: 'MANUFACTURER_OFFICIAL', retrieved_date: '2026-09-28' },
      ],
      dimensions: {
        as_reported: [
          { label: 'length', text: '8 см' },
          { label: 'width', text: '8 см' },
          { label: 'height', text: '10 см' },
        ],
        kind: 'LWH',
        describes: 'RETAIL_PACKAGE',
        normalized: { length_mm: 80, width_mm: 80, height_mm: 100 },
      },
      weight: { as_reported: '640 г', basis: 'SOURCE_PUBLISHED', normalized_g: 640 },
    },
    {
      sku: 'SYNTH-B1',
      identity_match: 'EXACT',
      sources: [
        { url: 'https://candlesbox.example.com/b1', type: 'SPECIALIST_RETAILER', retrieved_date: '2026-09-30', publisher: 'Candlesbox' },
      ],
      weight: { as_reported: '660 г', basis: 'SOURCE_PUBLISHED', normalized_g: 660 },
    },
  ];
  const dataset = build(snapshot, evidence);
  const b1 = recordOf(dataset, 'SYNTH-B1');

  assert.equal(b1.evidence_status, 'VERIFIED');
  assert.equal(present(b1.weight, 'b1 weight').normalized_g, 640);
  assert.equal(b1.conflicts.length, 1);
  assert.equal(b1.conflicts[0].rejected_value, '660');
  assert.ok(String(b1.conflicts[0].resolution).includes('higher-authority'));
});

test('buildDataset marks a SKU with no evidence as NEEDS_SOURCE without weight or dimensions', () => {
  const { snapshot } = loadFixtures();
  const dataset = build(snapshot, []);
  const c1 = recordOf(dataset, 'SYNTH-C1');

  assert.equal(c1.evidence_status, 'NEEDS_SOURCE');
  assert.equal(c1.weight, null);
  assert.equal(c1.dimensions, null);
  assert.equal(c1.identity_match, null);
});

test('buildDataset without a snapshot produces an empty, clearly-marked dataset', () => {
  const { evidence } = loadFixtures();
  const dataset = buildDataset({
    snapshotRows: null,
    evidenceRecords: evidence,
    generatedAt: '2026-10-01',
    snapshotPath: 'research/data/sources/1c-snapshot.json',
    evidencePath: 'research/data/sources/evidence.jsonl',
  });

  assert.equal(dataset.source_set.snapshot_present, false);
  assert.equal(dataset.summary.total_eligible, 0);
  assert.deepEqual(dataset.records, []);
  assert.equal(dataset.summary.ignored_evidence.length, 5);
  assert.ok(
    typeof dataset.source_set.note === 'string' && dataset.source_set.note.includes('1c-snapshot.json'),
  );
});

test('renderAudit contains every required audit section', () => {
  const { snapshot, evidence } = loadFixtures();
  const markdown = renderAudit(build(snapshot, evidence));

  for (const heading of [
    '# VOZDOOH Task 8',
    '## Source set',
    '## Summary counts',
    '## Breakdown by brand',
    '## Records',
    '## Conflicts between sources',
    '## Unresolved SKUs (NEEDS_SOURCE and CONFLICT)',
    '## Methodology and evidence policy',
  ]) {
    assert.ok(markdown.includes(heading), `audit must contain "${heading}"`);
  }
  assert.ok(markdown.includes('Total eligible SKUs: **5**'));
  assert.ok(markdown.includes('Exact product-identity matches: **4**'));
  assert.ok(markdown.includes('Verified complete (dimensions complete + weight): **2**'));
  assert.ok(markdown.includes('Partial (e.g. only two dimensions published): **1**'));
  assert.ok(markdown.includes('Conflicts between sources: **1**'));
  assert.ok(markdown.includes('Needs source: **1**'));
  assert.ok(markdown.includes('| SynthWax | 4 |'));
  assert.ok(markdown.includes('| OtherBrand | 1 |'));
  assert.ok(markdown.includes('- SYNTH-C1'));
  assert.ok(markdown.includes('- SYNTH-F1'));
  assert.ok(markdown.includes('https://candlesbox.example.com/f1'));
});

test('renderAudit on an empty dataset explains the missing snapshot', () => {
  const { evidence } = loadFixtures();
  const dataset = buildDataset({
    snapshotRows: null,
    evidenceRecords: evidence,
    generatedAt: '2026-10-01',
    snapshotPath: 'research/data/sources/1c-snapshot.json',
    evidencePath: 'research/data/sources/evidence.jsonl',
  });
  const markdown = renderAudit(dataset);

  assert.ok(markdown.includes('**false**'));
  assert.ok(markdown.includes('_No records. The eligible SKU set is empty'));
  assert.ok(markdown.includes('Total eligible SKUs: **0**'));
});
