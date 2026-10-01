#!/usr/bin/env node
'use strict';

/**
 * Build the Task 8 logistics dataset and audit.
 *
 * Reads the staged 1C snapshot (when present) and the evidence JSONL file,
 * derives the customer-eligible positive-stock SKU set, classifies evidence,
 * and writes the machine-readable dataset plus the markdown audit.
 *
 * Usage:
 *   node scripts/build-dataset.js [--snapshot path] [--evidence path]
 *                               [--out path] [--audit-out path] [--date YYYY-MM-DD]
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { buildDataset } = require('../src/dataset');
const { renderAudit } = require('../src/audit');

const DEFAULTS = {
  snapshot: path.join(__dirname, '..', 'research', 'data', 'sources', '1c-snapshot.json'),
  evidence: path.join(__dirname, '..', 'research', 'data', 'sources', 'evidence.jsonl'),
  out: path.join(__dirname, '..', 'research', 'data', 'logistics-dataset.json'),
  auditOut: path.join(__dirname, '..', 'research', 'audit', 'logistics-audit.md'),
};

/**
 * @param {string} filePath
 * @returns {unknown[] | null} Parsed JSON array, or null when the file is absent.
 */
function readSnapshot(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const text = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error(`1C snapshot at ${filePath} must be a JSON array of rows`);
  }
  return parsed;
}

/**
 * @param {string} filePath
 * @returns {unknown[]} Evidence records (empty when the file is absent or blank).
 *   Accepts JSON Lines (one record per line) or a single JSON array.
 */
function readEvidenceJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const text = fs.readFileSync(filePath, 'utf8');
  const trimmed = text.trim();
  if (trimmed === '') {
    return [];
  }
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error(`evidence file at ${filePath} must be a JSON array or JSON Lines`);
    }
    return parsed;
  }
  const records = /** @type {unknown[]} */ ([]);
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const lineTrimmed = line.trim();
    if (lineTrimmed === '') {
      return;
    }
    try {
      records.push(JSON.parse(lineTrimmed));
    } catch (error) {
      throw new Error(`evidence.jsonl line ${index + 1} is not valid JSON: ${/** @type {Error} */ (error).message}`);
    }
  });
  return records;
}

function main() {
  const args = parseArgs({
    options: {
      snapshot: { type: 'string', default: DEFAULTS.snapshot },
      evidence: { type: 'string', default: DEFAULTS.evidence },
      out: { type: 'string', default: DEFAULTS.out },
      'audit-out': { type: 'string', default: DEFAULTS.auditOut },
      date: { type: 'string', default: new Date().toISOString().slice(0, 10) },
    },
  }).values;

  const snapshotPath = /** @type {string} */ (args.snapshot);
  const evidencePath = /** @type {string} */ (args.evidence);
  const outPath = /** @type {string} */ (args.out);
  const auditOutPath = /** @type {string} */ (args['audit-out']);
  const generatedAt = /** @type {string} */ (args.date);

  const snapshotRows = readSnapshot(snapshotPath);
  const evidenceRecords = readEvidenceJsonl(evidencePath);

  const dataset = buildDataset({
    snapshotRows,
    evidenceRecords,
    generatedAt,
    snapshotPath: path.relative(path.join(__dirname, '..'), snapshotPath),
    evidencePath: path.relative(path.join(__dirname, '..'), evidencePath),
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.mkdirSync(path.dirname(auditOutPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
  fs.writeFileSync(auditOutPath, renderAudit(dataset), 'utf8');

  if (!dataset.source_set.snapshot_present) {
    process.stderr.write(
      `warning: 1C snapshot not found at ${snapshotPath}; ` +
        'the dataset was generated with an empty eligible SKU set.\n',
    );
  }
  process.stdout.write(
    `dataset: ${dataset.summary.total_eligible} eligible SKUs ` +
      `(VERIFIED ${dataset.summary.verified}, PARTIAL ${dataset.summary.partial}, ` +
      `CONFLICT ${dataset.summary.conflict}, NEEDS_SOURCE ${dataset.summary.needs_source})\n` +
      `wrote ${outPath}\nwrote ${auditOutPath}\n`,
  );
}

main();
