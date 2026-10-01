'use strict';

/**
 * Markdown audit renderer for the Task 8 logistics dataset.
 * The audit is generated from the dataset object only, so it always matches
 * the machine-readable data.
 */

/**
 * @typedef {import('./dataset').Dataset} Dataset
 */

/**
 * Escape a raw string for safe use inside a markdown table cell.
 * @param {unknown} value
 * @returns {string}
 */
function cell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * @param {string[]} lines
 * @param {Array<Array<unknown>>} rows
 * @param {string[]} header
 * @returns {void}
 */
function pushTable(lines, header, rows) {
  lines.push(`| ${header.map(cell).join(' | ')} |`);
  lines.push(`| ${header.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    lines.push(`| ${row.map(cell).join(' | ')} |`);
  }
  lines.push('');
}

/**
 * Render the full audit markdown for a dataset.
 * @param {Dataset} dataset
 * @returns {string}
 */
function renderAudit(dataset) {
  const { summary, source_set: sourceSet } = dataset;
  const generatedAt = dataset.generated_at;

  /** @type {string[]} */
  const lines = [];

  lines.push('# VOZDOOH Task 8 — Logistics dimensions/weight audit');
  lines.push('');
  lines.push(`Generated: ${generatedAt} (dataset schema ${dataset.dataset_schema_version})`);
  lines.push('');
  lines.push(
    'Scope: evidence-backed logistics dataset for customer-eligible positive-stock SKUs. ' +
      'Evidence only — no guessed value is written into 1C or public product cards.',
  );
  lines.push('');

  lines.push('## Source set');
  lines.push('');
  lines.push(`- 1C snapshot path: \`${sourceSet.snapshot_path}\``);
  lines.push(`- 1C snapshot present: **${sourceSet.snapshot_present}**`);
  lines.push(`- Snapshot rows total: ${sourceSet.snapshot_rows_total}`);
  if ('excluded_rows' in sourceSet && typeof sourceSet.excluded_rows === 'number') {
    lines.push(`- Rows excluded from the eligible set: ${sourceSet.excluded_rows}`);
  }
  if ('note' in sourceSet && typeof sourceSet.note === 'string') {
    lines.push(`- Note: ${sourceSet.note}`);
  }
  lines.push(`- Evidence records on file: ${sourceSet.evidence_records_total}`);
  lines.push('');

  lines.push('## Summary counts');
  lines.push('');
  lines.push(`- Total eligible SKUs: **${summary.total_eligible}**`);
  lines.push(`- Exact product-identity matches: **${summary.exact_matches}**`);
  lines.push(`- Verified complete (dimensions complete + weight): **${summary.verified_complete_lwh_weight}**`);
  lines.push(`- Verified (status VERIFIED): **${summary.verified}**`);
  lines.push(`- Partial (e.g. only two dimensions published): **${summary.partial}**`);
  lines.push(`- Conflicts between sources: **${summary.conflict}**`);
  lines.push(`- Needs source: **${summary.needs_source}**`);
  lines.push('');

  lines.push('## Breakdown by brand');
  lines.push('');
  const brandRows = Object.entries(summary.by_brand).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (brandRows.length === 0) {
    lines.push('_No eligible SKUs derived yet._');
    lines.push('');
  } else {
    pushTable(
      lines,
      ['Brand', 'Eligible SKUs'],
      brandRows.map(([brand, count]) => [brand, count]),
    );
  }

  lines.push('## Records');
  lines.push('');
  if (dataset.records.length === 0) {
    lines.push('_No records. The eligible SKU set is empty — see Source set above._');
    lines.push('');
  } else {
    pushTable(
      lines,
      ['SKU', 'Brand', 'Status', 'Confidence', 'Weight (as reported)', 'Dimensions complete', 'Notes'],
      dataset.records.map((record) => [
        record.sku,
        record.brand ?? '',
        record.evidence_status,
        record.logistics_confidence ?? '',
        record.weight !== null ? record.weight.as_reported : '',
        record.dimensions !== null ? (record.dimensions.complete ? 'yes' : 'no') : '',
        record.notes,
      ]),
    );
  }

  const conflicts = dataset.records.filter((record) => record.conflicts.length > 0);
  lines.push('## Conflicts between sources');
  lines.push('');
  if (conflicts.length === 0) {
    lines.push('_No conflicting source values recorded._');
    lines.push('');
  } else {
    /** @type {Array<Array<unknown>>} */
    const rows = [];
    for (const record of conflicts) {
      for (const conflict of record.conflicts) {
        if (Array.isArray(conflict.values)) {
          for (const value of conflict.values) {
            const entry = /** @type {Record<string, unknown>} */ (value);
            rows.push([record.sku, conflict.fact ?? '', entry.value ?? '', entry.source_url ?? '', conflict.resolution ?? '']);
          }
        } else {
          rows.push([
            record.sku,
            conflict.fact ?? '',
            conflict.rejected_value ?? '',
            conflict.rejected_source_url ?? '',
            conflict.resolution ?? '',
          ]);
        }
      }
    }
    pushTable(lines, ['SKU', 'Fact', 'Value', 'Source', 'Resolution'], rows);
  }

  lines.push('## Unresolved SKUs (NEEDS_SOURCE and CONFLICT)');
  lines.push('');
  if (summary.unresolved_skus.length === 0) {
    lines.push('_None._');
    lines.push('');
  } else {
    for (const sku of summary.unresolved_skus) {
      lines.push(`- ${sku}`);
    }
    lines.push('');
  }

  lines.push('## Rejected / ignored evidence');
  lines.push('');
  const rejected = summary.rejected_evidence;
  const ignored = summary.ignored_evidence;
  if (rejected.length === 0 && ignored.length === 0) {
    lines.push('_None._');
    lines.push('');
  } else {
    if (rejected.length > 0) {
      lines.push('Rejected evidence records (failed validation, never used as facts):');
      lines.push('');
      for (const item of rejected) {
        lines.push(`- \`${item.sku}\`: ${item.problems.join('; ')}`);
      }
      lines.push('');
    }
    if (ignored.length > 0) {
      lines.push('Ignored evidence records (SKU not in the eligible set):');
      lines.push('');
      for (const item of ignored) {
        lines.push(`- \`${item.sku}\`: ${item.reason}`);
      }
      lines.push('');
    }
  }

  lines.push('## Methodology and evidence policy');
  lines.push('');
  lines.push(`- ${dataset.policy}.`);
  lines.push('- SKU set is re-derived from the staged 1C snapshot on every build (customer-eligible, positive stock); it is never hard-coded.');
  lines.push('- Facts are accepted only for exact product identity matches (brand + line/fragrance + format + volume/size).');
  lines.push('- Dimensions and weight are stored exactly as published; normalized mm/g values appear only when conversion is mathematically exact.');
  lines.push('- A missing third dimension is never inferred from two-dimensional data.');
  lines.push('- Volume (e.g. 250 ml) is never converted into shipping weight (0.25 kg); volume-equivalent retailer weights are kept only as source_reported_weight with low confidence.');
  lines.push('- Priority of sources: official manufacturer → official distributor → reputable specialist retailer (e.g. Candlesbox). Candlesbox is a research source, not an authority when it conflicts with official data.');
  lines.push('- Every accepted fact carries the exact source URL, source type, and retrieval date.');
  lines.push('');

  return lines.join('\n');
}

module.exports = {
  renderAudit,
};
