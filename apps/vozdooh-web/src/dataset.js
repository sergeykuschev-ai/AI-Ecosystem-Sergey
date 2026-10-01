'use strict';

const {
  deriveEligibility,
} = require('./eligibility');
const {
  EVIDENCE_STATUSES,
  DIMENSION_KINDS,
  contributesFacts,
  sourceRank,
  validateEvidenceRecord,
} = require('./evidence-rules');

/**
 * Dataset assembly for Task 8: merge the re-derived eligible SKU set with
 * collected evidence records into the machine-readable logistics dataset.
 * Statuses are classified deterministically from the facts — they are never
 * hand-assigned — so the dataset can be regenerated and audited.
 */

const DATASET_SCHEMA_VERSION = 'v1';

/**
 * @typedef {import('./eligibility').EligibleSku} EligibleSku
 * @typedef {import('./evidence-rules').EvidenceRecord} EvidenceRecord
 * @typedef {import('./evidence-rules').EvidenceSource} EvidenceSource
 */

/**
 * @typedef {'VERIFIED' | 'PARTIAL' | 'CONFLICT' | 'NEEDS_SOURCE'} EvidenceStatus
 */

/**
 * @typedef {object} FactRef
 * @property {string} source_url
 * @property {string} source_domain
 * @property {string} source_type
 * @property {string} retrieved_date
 * @property {number} rank
 */

/**
 * @typedef {object} MergedWeight
 * @property {string} as_reported
 * @property {number} [normalized_g]
 * @property {string} describes
 * @property {string} basis
 * @property {FactRef} source
 * @property {number} [source_reported_weight]
 * @property {string} [source_reported_weight_unit]
 */

/**
 * @typedef {object} MergedDimensions
 * @property {Array<{ label: string, text: string }>} as_reported
 * @property {string} kind
 * @property {string} describes
 * @property {Record<string, number>} [normalized]
 * @property {boolean} complete
 * @property {FactRef} source
 */

/**
 * @typedef {object} SkuRecord
 * @property {string} sku
 * @property {string} name
 * @property {string | null} brand
 * @property {EvidenceStatus} evidence_status
 * @property {string | null} identity_match
 * @property {'HIGH' | 'MEDIUM' | 'LOW' | null} logistics_confidence
 * @property {MergedWeight | null} weight
 * @property {MergedDimensions | null} dimensions
 * @property {Array<Record<string, unknown>>} sources
 * @property {Array<Record<string, unknown>>} conflicts
 * @property {string} notes
 */

/**
 * @typedef {object} SourceSetInfo
 * @property {string} snapshot_path
 * @property {boolean} snapshot_present
 * @property {number} snapshot_rows_total
 * @property {string} evidence_path
 * @property {number} evidence_records_total
 * @property {number} eligible_sku_count
 * @property {number} [excluded_rows]
 * @property {string} [note]
 */

/**
 * @typedef {object} DatasetSummary
 * @property {number} total_eligible
 * @property {number} verified
 * @property {number} partial
 * @property {number} conflict
 * @property {number} needs_source
 * @property {number} exact_matches
 * @property {number} verified_complete_lwh_weight
 * @property {Record<string, number>} by_brand
 * @property {string[]} unresolved_skus
 * @property {Array<{ sku: string, problems: string[] }>} rejected_evidence
 * @property {Array<{ sku: string, reason: string }>} ignored_evidence
 */

/**
 * @typedef {object} Dataset
 * @property {string} dataset_schema_version
 * @property {string} generated_at
 * @property {SourceSetInfo} source_set
 * @property {string} policy
 * @property {SkuRecord[]} records
 * @property {DatasetSummary} summary
 */

/**
 * @param {string} url
 * @returns {string}
 */
function domainOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * @param {EvidenceSource} source
 * @returns {FactRef}
 */
function factRefOf(source) {
  return {
    source_url: source.url,
    source_domain: domainOf(source.url),
    source_type: source.type === undefined ? 'OTHER' : source.type,
    retrieved_date: source.retrieved_date,
    rank: sourceRank(source),
  };
}

/**
 * Best-rank source of a record; falls back to the first source.
 * @param {EvidenceRecord} record
 * @returns {EvidenceSource}
 */
function bestSourceOf(record) {
  let best = record.sources[0];
  for (const source of record.sources) {
    if (sourceRank(source) > sourceRank(best)) {
      best = source;
    }
  }
  return best;
}

/**
 * @typedef {object} FactCandidate
 * @property {string} valueKey Comparable representation of the fact value.
 * @property {number} rank Authority rank of the record's best source.
 * @property {FactRef} ref Provenance of the record's best source.
 * @property {EvidenceRecord} owner The evidence record this candidate came from.
 */

/**
 * Merge one fact kind across contributing records. The highest-authority
 * value wins; disagreements from lower-authority sources are recorded as
 * resolved conflicts (e.g. Candlesbox vs official). A disagreement between
 * sources of equal top authority is unresolved.
 * @param {FactCandidate[]} candidates
 * @returns {{ winner: FactCandidate | null, resolved: Array<Record<string, unknown>>, unresolved: Array<Record<string, unknown>> }}
 */
function mergeByAuthority(candidates) {
  if (candidates.length === 0) {
    return { winner: null, resolved: [], unresolved: [] };
  }
  const topRank = Math.max(...candidates.map((c) => c.rank));
  const top = candidates.filter((c) => c.rank === topRank);
  const distinct = [...new Set(top.map((c) => c.valueKey))];
  /** @type {Array<Record<string, unknown>>} */
  const resolved = [];
  /** @type {Array<Record<string, unknown>>} */
  const unresolved = [];
  if (distinct.length > 1) {
    unresolved.push({
      fact: null,
      values: top.map((c) => ({ value: c.valueKey, source_url: c.ref.source_url, source_type: c.ref.source_type })),
      resolution: 'UNRESOLVED — equal-authority sources disagree; needs manual review',
    });
  }
  const winner = top[0];
  for (const candidate of candidates) {
    if (candidate !== winner && candidate.rank < topRank && candidate.valueKey !== winner.valueKey) {
      resolved.push({
        fact: null,
        rejected_value: candidate.valueKey,
        rejected_source_url: candidate.ref.source_url,
        rejected_source_type: candidate.ref.source_type,
        resolution: `overridden by higher-authority source (${winner.ref.source_type})`,
      });
    }
  }
  return { winner, resolved, unresolved };
}

/**
 * @param {EvidenceRecord} record
 * @returns {boolean}
 */
function hasExactIdentity(record) {
  return record.identity_match === 'EXACT';
}

/**
 * Classify one eligible SKU from its contributing evidence records.
 * @param {EligibleSku} eligible
 * @param {EvidenceRecord[]} records Valid records collected for this SKU (any identity match).
 * @returns {SkuRecord}
 */
function classifySku(eligible, records) {
  const contributing = records.filter(contributesFacts);
  const exact = contributing.filter(hasExactIdentity);

  /** @type {Array<Record<string, unknown>>} */
  const conflicts = [];
  /** @type {string[]} */
  const notes = [];

  const identityMatch = contributing.length === 0 ? null : exact.length > 0 ? 'EXACT' : 'SHARED_PACKAGING_ESTABLISHED';

  if (records.length > 0 && contributing.length === 0) {
    notes.push('Only similar-product evidence on record; never used as SKU facts.');
  }

  const similarOnlyCount = records.length - contributing.length;
  if (similarOnlyCount > 0 && contributing.length > 0) {
    notes.push(`${similarOnlyCount} similar-only record(s) on file; not used as SKU facts.`);
  }

  // ---- weight merge ----
  const weightCandidates = contributing
    .filter((r) => r.weight !== undefined)
    .map((r) => {
      const weight = /** @type {NonNullable<EvidenceRecord['weight']>} */ (r.weight);
      const valueKey = weight.normalized_g !== undefined ? String(weight.normalized_g) : weight.as_reported;
      return { valueKey, rank: sourceRank(bestSourceOf(r)), ref: factRefOf(bestSourceOf(r)), owner: r };
    });
  const weightMerge = mergeByAuthority(weightCandidates);
  for (const item of weightMerge.resolved) {
    item.fact = 'weight';
    conflicts.push(item);
  }
  for (const item of weightMerge.unresolved) {
    item.fact = 'weight';
    conflicts.push(item);
  }

  /** @type {MergedWeight | null} */
  let weight = null;
  let weightComplete = false;
  let weightLowConfidence = false;
  if (weightMerge.winner !== null) {
    const raw = /** @type {NonNullable<EvidenceRecord['weight']>} */ (weightMerge.winner.owner.weight);
    if (raw.basis === 'VOLUME_EQUIV') {
      weightLowConfidence = true;
      notes.push(
        `Source reports weight "${raw.as_reported}" which merely equals the liquid volume; ` +
          'kept as source_reported_weight with low confidence, never as verified shipping weight.',
      );
      weight = {
        as_reported: raw.as_reported,
        describes: raw.describes === undefined ? 'UNKNOWN' : raw.describes,
        basis: raw.basis,
        source: weightMerge.winner.ref,
        ...(raw.source_reported_weight !== undefined ? { source_reported_weight: raw.source_reported_weight } : {}),
        ...(raw.source_reported_weight_unit !== undefined
          ? { source_reported_weight_unit: raw.source_reported_weight_unit }
          : {}),
      };
    } else {
      weight = {
        as_reported: raw.as_reported,
        describes: raw.describes === undefined ? 'UNKNOWN' : raw.describes,
        basis: raw.basis,
        source: weightMerge.winner.ref,
        ...(raw.normalized_g !== undefined ? { normalized_g: raw.normalized_g } : {}),
      };
      weightComplete = raw.normalized_g !== undefined;
    }
  }

  // ---- dimensions merge ----
  const dimsCandidates = contributing
    .filter((r) => r.dimensions !== undefined)
    .map((r) => {
      const dims = /** @type {NonNullable<EvidenceRecord['dimensions']>} */ (r.dimensions);
      const normalized = dims.normalized === undefined ? null : dims.normalized;
      const normalizedPart =
        normalized === null
          ? ''
          : Object.keys(normalized)
              .sort()
              .map((k) => `${k}=${String(normalized[k])}`)
              .join(';');
      const reportedPart = dims.as_reported
        .map((d) => `${d.label}:${d.text}`)
        .sort()
        .join(';');
      return { valueKey: `${reportedPart}|${normalizedPart}`, rank: sourceRank(bestSourceOf(r)), ref: factRefOf(bestSourceOf(r)), owner: r };
    });
  const dimsMerge = mergeByAuthority(dimsCandidates);
  for (const item of dimsMerge.resolved) {
    item.fact = 'dimensions';
    conflicts.push(item);
  }
  for (const item of dimsMerge.unresolved) {
    item.fact = 'dimensions';
    conflicts.push(item);
  }

  /** @type {MergedDimensions | null} */
  let dimensions = null;
  let dimensionsComplete = false;
  if (dimsMerge.winner !== null) {
    const raw = /** @type {NonNullable<EvidenceRecord['dimensions']>} */ (dimsMerge.winner.owner.dimensions);
    const labels = new Set(raw.as_reported.map((d) => d.label));
    const kind = raw.kind === undefined ? 'LWH' : raw.kind;
    dimensionsComplete =
      kind === 'DH'
        ? labels.has('diameter') && labels.has('height')
        : labels.has('length') && labels.has('width') && labels.has('height');
    dimensions = {
      as_reported: raw.as_reported.map((d) => ({ label: d.label, text: d.text })),
      kind,
      describes: raw.describes === undefined ? 'UNKNOWN' : raw.describes,
      complete: dimensionsComplete,
      source: dimsMerge.winner.ref,
      ...(raw.normalized !== undefined ? { normalized: raw.normalized } : {}),
    };
  }

  const unresolved = conflicts.filter((c) => c.resolution === 'UNRESOLVED — equal-authority sources disagree; needs manual review');

  /** @type {EvidenceStatus} */
  let status;
  if (contributing.length === 0) {
    status = 'NEEDS_SOURCE';
  } else if (unresolved.length > 0) {
    status = 'CONFLICT';
  } else if (weightComplete && dimensionsComplete) {
    status = 'VERIFIED';
  } else {
    status = 'PARTIAL';
  }

  /** @type {'HIGH' | 'MEDIUM' | 'LOW' | null} */
  let confidence = null;
  if (status !== 'NEEDS_SOURCE') {
    const ranks = [
      ...(weightMerge.winner !== null ? [weightMerge.winner.rank] : []),
      ...(dimsMerge.winner !== null ? [dimsMerge.winner.rank] : []),
    ];
    const bestRank = ranks.length === 0 ? 0 : Math.max(...ranks);
    if (weightLowConfidence || bestRank === 0) {
      confidence = 'LOW';
    } else if (bestRank >= 3) {
      confidence = 'HIGH';
    } else if (bestRank >= 1) {
      confidence = 'MEDIUM';
    } else {
      confidence = 'LOW';
    }
  }

  const sources = contributing.map((r) => {
    const ref = factRefOf(bestSourceOf(r));
    return {
      source_url: ref.source_url,
      source_domain: ref.source_domain,
      source_type: ref.source_type,
      retrieved_date: ref.retrieved_date,
      identity_match: r.identity_match,
      ...(r.brand !== undefined ? { brand: r.brand } : {}),
    };
  });

  const brand = contributing.find((r) => r.brand !== undefined)?.brand ?? eligible.brand ?? null;

  if (dimensions !== null && !dimensionsComplete) {
    notes.push('Dimensions incomplete: a missing third dimension is never inferred from reported values.');
  }

  return {
    sku: eligible.sku,
    name: eligible.name,
    brand,
    evidence_status: status,
    identity_match: identityMatch,
    logistics_confidence: confidence,
    weight,
    dimensions,
    sources,
    conflicts,
    notes: notes.join(' '),
  };
}

/**
 * @typedef {object} BuildInputs
 * @property {unknown[] | null} snapshotRows Parsed 1C snapshot rows, or null when the snapshot is absent.
 * @property {unknown[]} [evidenceRecords] Raw evidence records.
 * @property {string} generatedAt ISO date stamp for the build.
 * @property {string} snapshotPath Path the snapshot was read from (for provenance).
 * @property {string} evidencePath Path the evidence was read from (for provenance).
 */

/**
 * Build the full dataset from a snapshot and evidence records.
 * @param {BuildInputs} inputs
 * @returns {Dataset}
 */
function buildDataset(inputs) {
  const { snapshotRows, generatedAt, snapshotPath, evidencePath } = inputs;
  const evidenceRecords = inputs.evidenceRecords === undefined ? [] : inputs.evidenceRecords;

  const snapshotPresent = snapshotRows !== null;
  const eligibility = snapshotPresent ? deriveEligibility(snapshotRows) : { eligible: [], excluded: [], total_rows: 0 };

  /** @type {Array<{ sku: string, problems: string[] }>} */
  const rejectedEvidence = [];
  /** @type {Map<string, EvidenceRecord[]>} */
  const evidenceBySku = new Map();
  for (const raw of evidenceRecords) {
    const problems = validateEvidenceRecord(raw);
    const sku = typeof raw === 'object' && raw !== null && 'sku' in raw ? String(/** @type {Record<string, unknown>} */ (raw).sku) : '';
    if (problems.length > 0) {
      rejectedEvidence.push({ sku, problems });
      continue;
    }
    const record = /** @type {EvidenceRecord} */ (raw);
    const list = evidenceBySku.get(record.sku);
    if (list === undefined) {
      evidenceBySku.set(record.sku, [record]);
    } else {
      list.push(record);
    }
  }

  const eligibleSkus = new Set(eligibility.eligible.map((e) => e.sku));
  /** @type {Array<{ sku: string, reason: string }>} */
  const ignoredEvidence = [];
  for (const sku of evidenceBySku.keys()) {
    if (!eligibleSkus.has(sku)) {
      ignoredEvidence.push({
        sku,
        reason: snapshotPresent ? 'SKU not in the customer-eligible positive-stock set' : 'snapshot absent',
      });
    }
  }

  /** @type {SkuRecord[]} */
  const records = eligibility.eligible.map((eligible) => {
    const evidence = evidenceBySku.get(eligible.sku) ?? [];
    return classifySku(eligible, evidence);
  });

  /** @type {Record<string, number>} */
  const byBrand = {};
  for (const record of records) {
    const key = record.brand ?? 'UNKNOWN';
    byBrand[key] = (byBrand[key] ?? 0) + 1;
  }

  const countStatus = (/** @type {EvidenceStatus} */ status) => records.filter((r) => r.evidence_status === status).length;

  /** @type {Dataset} */
  const dataset = {
    dataset_schema_version: DATASET_SCHEMA_VERSION,
    generated_at: generatedAt,
    source_set: {
      snapshot_path: snapshotPath,
      snapshot_present: snapshotPresent,
      snapshot_rows_total: eligibility.total_rows,
      evidence_path: evidencePath,
      evidence_records_total: evidenceRecords.length,
      eligible_sku_count: eligibility.eligible.length,
      ...(snapshotPresent
        ? {
            excluded_rows: eligibility.excluded.length,
          }
        : {
            note: '1C snapshot is not staged in this workspace; the eligible SKU set could not be derived. ' +
              'Place the export at research/data/sources/1c-snapshot.json and run npm run build.',
          }),
    },
    policy: 'evidence-only: exact identity match; exact unit conversion; no inferred dimensions; ' +
      'no volume-to-weight facts; official sources override specialist retailers (e.g. Candlesbox)',
    records,
    summary: {
      total_eligible: records.length,
      verified: countStatus('VERIFIED'),
      partial: countStatus('PARTIAL'),
      conflict: countStatus('CONFLICT'),
      needs_source: countStatus('NEEDS_SOURCE'),
      exact_matches: records.filter((r) => r.identity_match === 'EXACT').length,
      verified_complete_lwh_weight: records.filter(
        (r) => r.evidence_status === 'VERIFIED' && r.weight !== null && r.dimensions !== null && r.dimensions.complete,
      ).length,
      by_brand: byBrand,
      unresolved_skus: records
        .filter((r) => r.evidence_status === 'NEEDS_SOURCE' || r.evidence_status === 'CONFLICT')
        .map((r) => r.sku),
      rejected_evidence: rejectedEvidence,
      ignored_evidence: ignoredEvidence,
    },
  };
  return dataset;
}

module.exports = {
  buildDataset,
  classifySku,
  domainOf,
  DATASET_SCHEMA_VERSION,
  EVIDENCE_STATUSES,
  DIMENSION_KINDS,
};
