'use strict';

/**
 * Evidence policy for the Task 8 logistics dataset.
 *
 * Policy rules implemented here (all deterministic and unit-tested):
 *
 * 1. Facts are accepted only for exact SKU/product identity matches
 *    (brand + line/fragrance + format + volume/size). Similar or
 *    same-volume products never contribute facts.
 * 2. Every accepted fact keeps the exact source URL, source type, and
 *    retrieval date.
 * 3. Normalized mm/g values are produced only when the conversion is
 *    mathematically exact (terminating decimal × exact unit factor).
 *    Approximate values and ranges are never normalized.
 * 4. A missing third dimension is never inferred from two-dimensional data:
 *    every normalized dimension must be traceable to a reported value.
 * 5. Volume (e.g. 250 ml) is never converted into shipping weight (0.25 kg)
 *    as a fact. A weight that merely equals liquid volume is retained only as
 *    `source_reported_weight` with low logistics confidence.
 * 6. Source authority: MANUFACTURER_OFFICIAL > OFFICIAL_DISTRIBUTOR >
 *    SPECIALIST_RETAILER (e.g. Candlesbox) > OTHER. A specialist retailer is
 *    a research source, not an authority: on conflict the official value wins
 *    and the disagreement is recorded in notes.
 */

const SOURCE_TYPES = Object.freeze([
  'MANUFACTURER_OFFICIAL',
  'OFFICIAL_DISTRIBUTOR',
  'SPECIALIST_RETAILER',
  'OTHER',
]);

const SOURCE_TYPE_RANK = Object.freeze({
  MANUFACTURER_OFFICIAL: 3,
  OFFICIAL_DISTRIBUTOR: 2,
  SPECIALIST_RETAILER: 1,
  OTHER: 0,
});

const EVIDENCE_STATUSES = Object.freeze(['VERIFIED', 'PARTIAL', 'CONFLICT', 'NEEDS_SOURCE']);

const IDENTITY_MATCHES = Object.freeze(['EXACT', 'SIMILAR_ONLY', 'SHARED_PACKAGING_ESTABLISHED']);

const DESCRIBES = Object.freeze(['PRODUCT', 'RETAIL_PACKAGE', 'SHIPPING_PACKAGE', 'UNKNOWN']);

const DIMENSION_KINDS = Object.freeze(['LWH', 'DH']);

const CONFIDENCES = Object.freeze(['HIGH', 'MEDIUM', 'LOW']);

/** @type {Readonly<Record<string, number>>} Exact unit factors to millimetres
 * (inch is exactly 25.4 mm by definition). Russian retail sources publish the
 * Cyrillic aliases; both spellings map to the same exact factors. Volume units
 * are deliberately absent. */
const LENGTH_TO_MM = Object.freeze({
  mm: 1,
  'мм': 1,
  cm: 10,
  'см': 10,
  m: 1000,
  'м': 1000,
  in: 25.4,
  'дюйм': 25.4,
  '″': 25.4,
});

/** @type {Readonly<Record<string, number>>} Exact unit factors to grams (lb/oz
 * are exact definitions). Volume units (ml/мл/l/л) are deliberately absent:
 * volume must never become weight. */
const WEIGHT_TO_G = Object.freeze({
  g: 1,
  'г': 1,
  kg: 1000,
  'кг': 1000,
  mg: 0.001,
  'мг': 0.001,
  lb: 453.59237,
  'фунт': 453.59237,
  oz: 28.349523125,
  'унция': 28.349523125,
});

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @typedef {object} EvidenceSource
 * @property {string} url Exact source URL where the fact was published.
 * @property {string} [type] One of SOURCE_TYPES; defaults to OTHER when absent.
 * @property {string} retrieved_date ISO calendar date (YYYY-MM-DD).
 * @property {string} [publisher] Human-readable publisher name (e.g. Candlesbox).
 */

/**
 * @typedef {object} ReportedDimension
 * @property {'length' | 'width' | 'height' | 'diameter'} label
 * @property {string} text Value exactly as published by the source (e.g. "9 см").
 */

/**
 * @typedef {object} DimensionsFact
 * @property {ReportedDimension[]} as_reported Dimensions exactly as the source stated them.
 * @property {'PRODUCT' | 'RETAIL_PACKAGE' | 'SHIPPING_PACKAGE' | 'UNKNOWN'} [describes]
 *   Whether the values describe the product itself or its retail/shipping package.
 *   Defaults to UNKNOWN.
 * @property {'LWH' | 'DH'} [kind] LWH = rectangular length/width/height; DH = diameter + height.
 *   Defaults to LWH.
 * @property {Record<string, number>} [normalized]
 *   Normalized values (e.g. length_mm). Each key must correspond to an as_reported entry whose text
 *   converts exactly; anything else is a policy violation.
 */

/**
 * @typedef {object} WeightFact
 * @property {string} as_reported Value exactly as published by the source (e.g. "480 г").
 * @property {'SOURCE_PUBLISHED' | 'VOLUME_EQUIV'} basis
 *   VOLUME_EQUIV means the number merely equals the liquid volume (e.g. "250 г" for
 *   a 250 ml product); it is never treated as verified shipping weight.
 * @property {'PRODUCT' | 'RETAIL_PACKAGE' | 'SHIPPING_PACKAGE' | 'UNKNOWN'} [describes]
 *   Defaults to UNKNOWN.
 * @property {number} [normalized_g] Grams, only when basis is SOURCE_PUBLISHED and the
 *   conversion is mathematically exact.
 * @property {number} [source_reported_weight] The reported number for
 *   VOLUME_EQUIV facts, kept for traceability.
 * @property {string} [source_reported_weight_unit] Unit of source_reported_weight.
 */

/**
 * @typedef {object} EvidenceRecord
 * @property {string} sku SKU the evidence was collected for.
 * @property {string} [brand] Brand of the matched product.
 * @property {'EXACT' | 'SIMILAR_ONLY' | 'SHARED_PACKAGING_ESTABLISHED'} identity_match
 *   SIMILAR_ONLY records are retained for audit but never contribute facts.
 * @property {EvidenceSource[]} sources
 * @property {DimensionsFact} [dimensions]
 * @property {WeightFact} [weight]
 * @property {string} [notes]
 */

/**
 * Strip thousands separators and normalise a decimal comma to a point.
 * Only unambiguous forms are accepted: optional spaces between digit groups
 * (thousands) and a single comma or point decimal separator.
 * @param {string} text
 * @returns {string | null} Canonical numeric text, or null when ambiguous.
 */
function canonicalNumberText(text) {
  const trimmed = text.trim();
  const withThousands = trimmed.replace(/(\d) (\d{3})\b/g, '$1$2');
  if (/^-?\d{1,3}( \d{3})+([.,]\d+)?$/.test(trimmed)) {
    return withThousands.replace(',', '.');
  }
  if (/^-?\d+([.,]\d+)?$/.test(trimmed)) {
    return withThousands.replace(',', '.');
  }
  return null;
}

/**
 * Convert a published value to millimetres. The conversion is returned only
 * when both the number and the unit factor are exact; ranges, approximations
 * and unknown units are rejected. Accepts either a bare number with a unit
 * argument ("9", "см") or a combined published string ("9 см", unit optional).
 * @param {string} text Value exactly as published, or its numeric part.
 * @param {string} [unit] Unit as published (mm/мм, cm/см, m/м, in/дюйм).
 * @returns {{ ok: true, mm: number } | { ok: false, reason: string }}
 */
function normalizeDimensionToMm(text, unit) {
  let valueText = text;
  let unitText = unit;
  if (unitText === undefined) {
    const split = splitValueAndUnit(text);
    if (split === null) {
      return { ok: false, reason: `value "${text}" is not an exact value+unit string` };
    }
    valueText = split.valueText;
    unitText = split.unit;
  }
  const canonical = canonicalNumberText(valueText);
  if (canonical === null) {
    return { ok: false, reason: `value "${text}" is not an exact terminating decimal` };
  }
  const factor = LENGTH_TO_MM[unitText.trim().toLowerCase()];
  if (factor === undefined) {
    return { ok: false, reason: `unsupported length unit "${unitText}"` };
  }
  return { ok: true, mm: Number(canonical) * factor };
}

/**
 * Convert a published weight to grams under the same exactness rules as
 * normalizeDimensionToMm. Callers must never use this for volume-equivalent
 * numbers (see WeightFact.basis). Volume units are not in the factor table.
 * @param {string} text Value exactly as published, or its numeric part.
 * @param {string} [unit] Unit as published (g/г, kg/кг, mg/мг, lb, oz).
 * @returns {{ ok: true, g: number } | { ok: false, reason: string }}
 */
function normalizeWeightToG(text, unit) {
  let valueText = text;
  let unitText = unit;
  if (unitText === undefined) {
    const split = splitValueAndUnit(text);
    if (split === null) {
      return { ok: false, reason: `value "${text}" is not an exact value+unit string` };
    }
    valueText = split.valueText;
    unitText = split.unit;
  }
  const canonical = canonicalNumberText(valueText);
  if (canonical === null) {
    return { ok: false, reason: `value "${text}" is not an exact terminating decimal` };
  }
  const factor = WEIGHT_TO_G[unitText.trim().toLowerCase()];
  if (factor === undefined) {
    return { ok: false, reason: `unsupported weight unit "${unitText}"` };
  }
  return { ok: true, g: Number(canonical) * factor };
}

/**
 * Split a verbatim published value into numeric text and unit, e.g. "9 см"
 * -> { valueText: "9", unit: "см" }. Returns null when the text does not
 * follow the "value + unit" shape (ranges, approximations, unitless text).
 * @param {string} text
 * @returns {{ valueText: string, unit: string } | null}
 */
function splitValueAndUnit(text) {
  const match = /^(-?[\d][\d\s.,]*?)\s*([^\d\s.,]+)\s*\.?\s*$/.exec(text.trim());
  if (match === null) {
    return null;
  }
  return { valueText: match[1], unit: match[2] };
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Validate one evidence source entry.
 * @param {unknown} raw
 * @returns {string[]}
 */
function validateSource(raw) {
  const problems = [];
  if (typeof raw !== 'object' || raw === null) {
    return ['source entry is not an object'];
  }
  const source = /** @type {Record<string, unknown>} */ (raw);
  if (!isNonEmptyString(source.url) || !/^https?:\/\//.test(source.url.trim())) {
    problems.push('source.url must be a non-empty http(s) URL');
  }
  if (source.type !== undefined && !SOURCE_TYPES.includes(String(source.type))) {
    problems.push(`source.type must be one of ${SOURCE_TYPES.join(', ')}`);
  }
  if (!isNonEmptyString(source.retrieved_date) || !DATE_PATTERN.test(source.retrieved_date.trim())) {
    problems.push('source.retrieved_date must be a YYYY-MM-DD date');
  }
  return problems;
}

/**
 * Validate a dimensions fact: every normalized key must be traceable to an
 * as_reported entry with the same label whose text converts exactly to the
 * same value. This is what makes a missing third dimension impossible to
 * smuggle in as an inference.
 * @param {unknown} raw
 * @returns {string[]}
 */
function validateDimensions(raw) {
  const problems = [];
  if (typeof raw !== 'object' || raw === null) {
    return ['dimensions is not an object'];
  }
  const dims = /** @type {Record<string, unknown>} */ (raw);
  if (!Array.isArray(dims.as_reported) || dims.as_reported.length === 0) {
    problems.push('dimensions.as_reported must be a non-empty array');
  } else {
    const labels = new Set();
    for (const entry of dims.as_reported) {
      if (typeof entry !== 'object' || entry === null) {
        problems.push('dimensions.as_reported entries must be objects');
        continue;
      }
      const item = /** @type {Record<string, unknown>} */ (entry);
      const label = String(item.label);
      if (!['length', 'width', 'height', 'diameter'].includes(label)) {
        problems.push(`dimensions.as_reported label "${label}" is not supported`);
      }
      if (labels.has(label)) {
        problems.push(`dimensions.as_reported label "${label}" is duplicated`);
      }
      labels.add(label);
      if (!isNonEmptyString(item.text)) {
        problems.push(`dimensions.as_reported[${label}].text must be a non-empty string`);
      }
    }
  }
  if (dims.describes !== undefined && !DESCRIBES.includes(String(dims.describes))) {
    problems.push(`dimensions.describes must be one of ${DESCRIBES.join(', ')}`);
  }
  if (dims.kind !== undefined && !DIMENSION_KINDS.includes(String(dims.kind))) {
    problems.push(`dimensions.kind must be one of ${DIMENSION_KINDS.join(', ')}`);
  }
  if (dims.normalized !== undefined) {
    if (typeof dims.normalized !== 'object' || dims.normalized === null || Array.isArray(dims.normalized)) {
      problems.push('dimensions.normalized must be an object');
    } else {
      const normalized = /** @type {Record<string, unknown>} */ (dims.normalized);
      for (const [key, value] of Object.entries(normalized)) {
        const label = key.replace(/_mm$/, '');
        if (!['length', 'width', 'height', 'diameter'].includes(label)) {
          problems.push(`dimensions.normalized key "${key}" is not a supported dimension`);
          continue;
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          problems.push(`dimensions.normalized.${key} must be a finite number`);
          continue;
        }
        if (value <= 0) {
          problems.push(`dimensions.normalized.${key} must be positive`);
          continue;
        }
        const reported = Array.isArray(dims.as_reported)
          ? dims.as_reported.find((entry) => {
              return typeof entry === 'object' && entry !== null && /** @type {Record<string, unknown>} */ (entry).label === label;
            })
          : undefined;
        if (reported === undefined) {
          problems.push(
            `dimensions.normalized.${key} has no matching as_reported entry — ` +
              'a missing dimension must never be inferred from other values',
          );
          continue;
        }
        const reportedText = String(/** @type {Record<string, unknown>} */ (reported).text);
        const converted = normalizeDimensionToMm(reportedText);
        if (!converted.ok) {
          problems.push(`dimensions.normalized.${key} cannot be reproduced from "${reportedText}": ${converted.reason}`);
        } else if (Math.abs(converted.mm - value) > 1e-9) {
          problems.push(
            `dimensions.normalized.${key}=${value} does not match exact conversion of "${reportedText}" (${converted.mm} mm)`,
          );
        }
      }
    }
  }
  return problems;
}

/**
 * Validate a weight fact. Volume-equivalent weights must never carry a
 * normalized gram value and can never satisfy completeness.
 * @param {unknown} raw
 * @returns {string[]}
 */
function validateWeight(raw) {
  const problems = [];
  if (typeof raw !== 'object' || raw === null) {
    return ['weight is not an object'];
  }
  const weight = /** @type {Record<string, unknown>} */ (raw);
  if (!isNonEmptyString(weight.as_reported)) {
    problems.push('weight.as_reported must be a non-empty string');
  }
  if (weight.basis !== 'SOURCE_PUBLISHED' && weight.basis !== 'VOLUME_EQUIV') {
    problems.push('weight.basis must be SOURCE_PUBLISHED or VOLUME_EQUIV');
  }
  if (weight.describes !== undefined && !DESCRIBES.includes(String(weight.describes))) {
    problems.push(`weight.describes must be one of ${DESCRIBES.join(', ')}`);
  }
  if (weight.basis === 'VOLUME_EQUIV') {
    if (weight.normalized_g !== undefined) {
      problems.push(
        'weight.normalized_g must be absent for VOLUME_EQUIV facts — volume must never become shipping weight',
      );
    }
    if (typeof weight.source_reported_weight !== 'number' || !Number.isFinite(weight.source_reported_weight)) {
      problems.push('weight.source_reported_weight must be a finite number for VOLUME_EQUIV facts');
    }
    if (!isNonEmptyString(weight.source_reported_weight_unit)) {
      problems.push('weight.source_reported_weight_unit must be a non-empty string for VOLUME_EQUIV facts');
    }
  }
  if (weight.basis === 'SOURCE_PUBLISHED' && weight.normalized_g !== undefined) {
    if (typeof weight.normalized_g !== 'number' || !Number.isFinite(weight.normalized_g)) {
      problems.push('weight.normalized_g must be a finite number');
    } else if (weight.normalized_g <= 0) {
      problems.push('weight.normalized_g must be positive');
    } else if (isNonEmptyString(weight.as_reported)) {
      const converted = normalizeWeightToG(weight.as_reported);
      if (!converted.ok) {
        problems.push(`weight.normalized_g cannot be reproduced from "${weight.as_reported}": ${converted.reason}`);
      } else if (Math.abs(converted.g - weight.normalized_g) > 1e-9) {
        problems.push(
          `weight.normalized_g=${weight.normalized_g} does not match exact conversion of "${weight.as_reported}" (${converted.g} g)`,
        );
      }
    }
  }
  return problems;
}

/**
 * Validate a raw evidence record. Records with problems are excluded from
 * fact-merging and reported in the audit as rejected.
 * @param {unknown} raw
 * @returns {string[]}
 */
function validateEvidenceRecord(raw) {
  const problems = [];
  if (typeof raw !== 'object' || raw === null) {
    return ['evidence record is not an object'];
  }
  const record = /** @type {Record<string, unknown>} */ (raw);
  if (!isNonEmptyString(record.sku)) {
    problems.push('sku must be a non-empty string');
  }
  if (!IDENTITY_MATCHES.includes(String(record.identity_match))) {
    problems.push(`identity_match must be one of ${IDENTITY_MATCHES.join(', ')}`);
  }
  if (!Array.isArray(record.sources) || record.sources.length === 0) {
    problems.push('sources must be a non-empty array');
  } else {
    record.sources.forEach((source, index) => {
      for (const problem of validateSource(source)) {
        problems.push(`sources[${index}]: ${problem}`);
      }
    });
  }
  if (record.dimensions !== undefined) {
    for (const problem of validateDimensions(record.dimensions)) {
      problems.push(`dimensions: ${problem}`);
    }
  }
  if (record.weight !== undefined) {
    for (const problem of validateWeight(record.weight)) {
      problems.push(`weight: ${problem}`);
    }
  }
  if (record.dimensions === undefined && record.weight === undefined) {
    problems.push('record must carry at least one of dimensions or weight');
  }
  if (record.notes !== undefined && typeof record.notes !== 'string') {
    problems.push('notes must be a string when present');
  }
  return problems;
}

/**
 * Sources that may contribute facts: exact product identity, or an explicit
 * shared-packaging statement from the source. SIMILAR_ONLY never contributes.
 * @param {EvidenceRecord} record
 * @returns {boolean}
 */
function contributesFacts(record) {
  return record.identity_match === 'EXACT' || record.identity_match === 'SHARED_PACKAGING_ESTABLISHED';
}

/**
 * Authority rank of a source; higher wins.
 * @param {EvidenceSource} source
 * @returns {number}
 */
function sourceRank(source) {
  const type = /** @type {keyof typeof SOURCE_TYPE_RANK | undefined} */ (
    SOURCE_TYPES.includes(String(source.type)) ? source.type : undefined
  );
  return type === undefined ? SOURCE_TYPE_RANK.OTHER : SOURCE_TYPE_RANK[type];
}

module.exports = {
  SOURCE_TYPES,
  SOURCE_TYPE_RANK,
  EVIDENCE_STATUSES,
  IDENTITY_MATCHES,
  DESCRIBES,
  DIMENSION_KINDS,
  CONFIDENCES,
  LENGTH_TO_MM,
  WEIGHT_TO_G,
  canonicalNumberText,
  splitValueAndUnit,
  normalizeDimensionToMm,
  normalizeWeightToG,
  validateEvidenceRecord,
  validateSource,
  validateDimensions,
  validateWeight,
  contributesFacts,
  sourceRank,
};
