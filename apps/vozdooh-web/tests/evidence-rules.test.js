'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalNumberText,
  splitValueAndUnit,
  normalizeDimensionToMm,
  normalizeWeightToG,
  validateDimensions,
  validateWeight,
  validateEvidenceRecord,
  contributesFacts,
  sourceRank,
} = require('../src/evidence-rules');

test('canonicalNumberText accepts exact decimals with point or comma', () => {
  assert.equal(canonicalNumberText('90'), '90');
  assert.equal(canonicalNumberText('9.5'), '9.5');
  assert.equal(canonicalNumberText('9,5'), '9.5');
  assert.equal(canonicalNumberText('0.25'), '0.25');
});

test('canonicalNumberText accepts space-separated thousands', () => {
  assert.equal(canonicalNumberText('1 000'), '1000');
  assert.equal(canonicalNumberText('1 000,5'), '1000.5');
});

test('canonicalNumberText rejects ranges and approximations', () => {
  assert.equal(canonicalNumberText('9-10'), null);
  assert.equal(canonicalNumberText('~9'), null);
  assert.equal(canonicalNumberText('≈9'), null);
  assert.equal(canonicalNumberText('около 9'), null);
  assert.equal(canonicalNumberText('9 см'), null);
});

test('splitValueAndUnit splits published value strings', () => {
  assert.deepEqual(splitValueAndUnit('9 см'), { valueText: '9', unit: 'см' });
  assert.deepEqual(splitValueAndUnit('0.25 кг.'), { valueText: '0.25', unit: 'кг' });
  assert.deepEqual(splitValueAndUnit('9-10 см'), null);
});

test('normalizeDimensionToMm converts exact metric and imperial units', () => {
  assert.deepEqual(normalizeDimensionToMm('9 см'), { ok: true, mm: 90 });
  assert.deepEqual(normalizeDimensionToMm('9,5 см'), { ok: true, mm: 95 });
  assert.deepEqual(normalizeDimensionToMm('8', 'см'), { ok: true, mm: 80 });
  assert.deepEqual(normalizeDimensionToMm('2″'), { ok: true, mm: 50.8 });
  assert.deepEqual(normalizeDimensionToMm('1 м'), { ok: true, mm: 1000 });
});

test('normalizeDimensionToMm refuses ranges, approximations and volume units', () => {
  assert.equal(normalizeDimensionToMm('9-10 см').ok, false);
  assert.equal(normalizeDimensionToMm('~90 мм').ok, false);
  assert.equal(normalizeDimensionToMm('250 мл').ok, false);
  assert.equal(normalizeDimensionToMm('90 px').ok, false);
});

test('normalizeWeightToG converts exact weight units and never volume', () => {
  assert.deepEqual(normalizeWeightToG('480 г'), { ok: true, g: 480 });
  assert.deepEqual(normalizeWeightToG('0.25 кг'), { ok: true, g: 250 });
  assert.deepEqual(normalizeWeightToG('250 мл').ok, false);
  assert.deepEqual(normalizeWeightToG('1 л').ok, false);
});

test('validateDimensions rejects a normalized dimension that has no reported counterpart', () => {
  const problems = validateDimensions({
    as_reported: [
      { label: 'diameter', text: '8 см' },
      { label: 'height', text: '9 см' },
    ],
    kind: 'DH',
    describes: 'PRODUCT',
    normalized: { diameter_mm: 80, height_mm: 90, length_mm: 80 },
  });
  assert.ok(
    problems.some((p) => p.includes('length_mm') && p.includes('never be inferred')),
    `expected an inference violation, got: ${problems.join('; ')}`,
  );
});

test('validateDimensions rejects normalized values that do not match the reported text', () => {
  const problems = validateDimensions({
    as_reported: [{ label: 'height', text: '9 см' }],
    kind: 'LWH',
    normalized: { height_mm: 91 },
  });
  assert.ok(problems.some((p) => p.includes('does not match exact conversion')));
});

test('validateDimensions rejects non-positive and non-exact normalized values', () => {
  const problems = validateDimensions({
    as_reported: [
      { label: 'height', text: '9 см' },
      { label: 'length', text: '10 см' },
    ],
    kind: 'LWH',
    normalized: { height_mm: 0, length_mm: 100 },
  });
  assert.ok(problems.some((p) => p.includes('height_mm') && p.includes('positive')));
});

test('validateDimensions accepts a traceable exact conversion', () => {
  const problems = validateDimensions({
    as_reported: [
      { label: 'diameter', text: '8 см' },
      { label: 'height', text: '9,5 см' },
    ],
    kind: 'DH',
    describes: 'PRODUCT',
    normalized: { diameter_mm: 80, height_mm: 95 },
  });
  assert.deepEqual(problems, []);
});

test('validateWeight rejects a volume-equivalent fact carrying normalized grams', () => {
  const problems = validateWeight({
    as_reported: '250 г',
    basis: 'VOLUME_EQUIV',
    normalized_g: 250,
    source_reported_weight: 250,
    source_reported_weight_unit: 'г',
  });
  assert.ok(
    problems.some((p) => p.includes('volume must never become shipping weight')),
    `expected volume violation, got: ${problems.join('; ')}`,
  );
});

test('validateWeight accepts a volume-equivalent fact kept as source_reported_weight only', () => {
  const problems = validateWeight({
    as_reported: '250 г',
    basis: 'VOLUME_EQUIV',
    describes: 'UNKNOWN',
    source_reported_weight: 250,
    source_reported_weight_unit: 'г',
  });
  assert.deepEqual(problems, []);
});

test('validateWeight rejects normalized grams that contradict the reported text', () => {
  const problems = validateWeight({
    as_reported: '480 г',
    basis: 'SOURCE_PUBLISHED',
    normalized_g: 500,
  });
  assert.ok(problems.some((p) => p.includes('does not match exact conversion')));
});

test('validateEvidenceRecord requires exact url, source type, date and a fact', () => {
  const valid = {
    sku: 'X-1',
    identity_match: 'EXACT',
    sources: [{ url: 'https://example.com/x', type: 'OTHER', retrieved_date: '2026-09-30' }],
    weight: { as_reported: '100 г', basis: 'SOURCE_PUBLISHED' },
  };
  assert.deepEqual(validateEvidenceRecord(valid), []);

  const noUrl = { ...valid, sources: [{ url: 'example.com/x', retrieved_date: '2026-09-30' }] };
  assert.ok(validateEvidenceRecord(noUrl).some((p) => p.includes('url')));

  const badType = {
    ...valid,
    sources: [{ url: 'https://example.com/x', type: 'FAN_BLOG', retrieved_date: '2026-09-30' }],
  };
  assert.ok(validateEvidenceRecord(badType).some((p) => p.includes('source.type')));

  const badDate = { ...valid, sources: [{ url: 'https://example.com/x', retrieved_date: '30.09.2026' }] };
  assert.ok(validateEvidenceRecord(badDate).some((p) => p.includes('retrieved_date')));

  const noFact = { sku: 'X-1', identity_match: 'EXACT', sources: valid.sources };
  assert.ok(validateEvidenceRecord(noFact).some((p) => p.includes('at least one')));

  const badIdentity = { ...valid, identity_match: 'CLOSE_ENOUGH' };
  assert.ok(validateEvidenceRecord(badIdentity).some((p) => p.includes('identity_match')));
});

test('contributesFacts excludes similar-only evidence', () => {
  assert.equal(
    contributesFacts({ sku: 'X', identity_match: 'EXACT', sources: [] }),
    true,
  );
  assert.equal(
    contributesFacts({ sku: 'X', identity_match: 'SHARED_PACKAGING_ESTABLISHED', sources: [] }),
    true,
  );
  assert.equal(
    contributesFacts({ sku: 'X', identity_match: 'SIMILAR_ONLY', sources: [] }),
    false,
  );
});

test('sourceRank orders authority manufacturer > distributor > retailer > other', () => {
  /** @param {'MANUFACTURER_OFFICIAL' | 'OFFICIAL_DISTRIBUTOR' | 'SPECIALIST_RETAILER' | 'OTHER'} type */
  const record = (type) => ({
    sku: 'X',
    identity_match: 'EXACT',
    sources: [{ url: 'https://example.com', retrieved_date: '2026-09-30', type }],
  });
  assert.ok(sourceRank(record('MANUFACTURER_OFFICIAL').sources[0]) > sourceRank(record('OFFICIAL_DISTRIBUTOR').sources[0]));
  assert.ok(sourceRank(record('OFFICIAL_DISTRIBUTOR').sources[0]) > sourceRank(record('SPECIALIST_RETAILER').sources[0]));
  assert.ok(sourceRank(record('SPECIALIST_RETAILER').sources[0]) > sourceRank(record('OTHER').sources[0]));
});
