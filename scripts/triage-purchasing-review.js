#!/usr/bin/env node
'use strict';

/**
 * Read-only triage of the purchasing manual review queue.
 *
 * Two modes:
 *   --run-dir <dir>   Triage artifacts of a finished run
 *                     (result.json, manual-review.json, owner-review.json).
 *   --input <xlsx>    Rebuild the full pipeline in memory from a SmartZapas
 *                     export ( Purchasing Agent + matrix builder + owner
 *                     decisions ) and triage the produced queue.
 *
 * Options:
 *   --output <path>          Write the full triage JSON in addition to stdout.
 *   --compaction-dir <dir>   Also write owner_review_compaction artifacts
 *                            (<dir>/owner-review-compaction-<run>.json|.csv,
 *                            <dir>/owner-review-compact-<run>.md).
 *   --ai                     Use the configured OmniRoute/Kimi provider for the
 *                            plain-language summary (default: deterministic only).
 *
 * The script never writes into the run artifacts, never touches 1C, never
 * modifies order quantities, Min/Max values or the canonical matrix.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');

const { triageReviewQueue } = require('../agents/purchasing/review_triage/review_triage');
const { explainTriage } = require('../agents/purchasing/review_triage/review_triage_explainer');
const { renderOwnerReviewHtml } = require('../agents/purchasing/review_triage/owner_review_report');

const DEFAULT_FINANCIAL_DATA_PATH = path.join(
  REPOSITORY_ROOT,
  'data/purchasing/miska-financial-current.json'
);
const DEFAULT_ASSORTMENT_MATRIX_PATH = path.join(
  REPOSITORY_ROOT,
  'data/purchasing/miska-canonical-assortment-matrix.json'
);
const DEFAULT_OWNER_DECISIONS_PATH = path.join(
  REPOSITORY_ROOT,
  'data/purchasing/miska-owner-decisions.json'
);
const DEFAULT_OWNER_DECISION_HISTORY_PATH = path.join(
  REPOSITORY_ROOT,
  'data/purchasing/owner-decision-history.json'
);
const DEFAULT_OWNER_REVIEW_SESSIONS_PATH = path.join(
  REPOSITORY_ROOT,
  'data/purchasing/owner-review-sessions.json'
);

function parseArguments(argv) {
  const args = {
    runDir: null,
    input: null,
    output: null,
    compactionDir: null,
    sessions: null,
    ai: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--run-dir') {
      args.runDir = argv[index + 1];
      index += 1;
    } else if (argument === '--input') {
      args.input = argv[index + 1];
      index += 1;
    } else if (argument === '--output') {
      args.output = argv[index + 1];
      index += 1;
    } else if (argument === '--compaction-dir') {
      args.compactionDir = argv[index + 1];
      index += 1;
    } else if (argument === '--sessions') {
      args.sessions = argv[index + 1];
      index += 1;
    } else if (argument === '--ai') {
      args.ai = true;
    } else if (argument === '--help' || argument === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!args.help && !args.runDir && !args.input) {
    throw new Error('Specify either --run-dir <dir> or --input <xlsx>.');
  }
  if (args.runDir && args.input) {
    throw new Error('--run-dir and --input are mutually exclusive.');
  }
  return args;
}

function helpText() {
  return [
    'Usage: node scripts/triage-purchasing-review.js (--run-dir <dir> | --input <xlsx>) [--output <path>] [--compaction-dir <dir>] [--sessions <registry.json>] [--ai]',
    '',
    'Read-only triage of the purchasing manual review queue.',
    'Does not modify runs, 1C, order quantities, Min/Max or the canonical matrix.',
  ].join('\n');
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCompactionCsv(compaction) {
  const lines = ['kind;id;count;articles;owner_signals;business_question'];
  for (const pkg of compaction.packages) {
    lines.push([
      'package',
      pkg.package_id,
      pkg.count,
      pkg.articles.join(', '),
      pkg.owner_signals.join(','),
      csvCell(pkg.business_question),
    ].join(';'));
  }
  for (const individual of compaction.individuals) {
    lines.push([
      'individual',
      individual.decision_id,
      1,
      individual.article || '',
      individual.owner_signals.join(','),
      csvCell(individual.business_question),
    ].join(';'));
  }
  return `${lines.join('\n')}\n`;
}

function buildCompactionMarkdown(compaction) {
  const lines = [];
  lines.push(`# OWNER REVIEW COMPACT — run ${compaction.source_run_id || '—'} (${compaction.compactor_version})`);
  lines.push('');
  lines.push('Read-only. Решения не применены; canonical / Min/Max / order qty / 1С не изменены.');
  lines.push('');
  lines.push('| Уровень | Значение |');
  lines.push('|---|---|');
  lines.push(`| Бизнес-позиций (unique rowIdentity) | ${compaction.business_sku_count} |`);
  lines.push(`| DATA_OR_LINKAGE (не к владельцу) | ${compaction.data_or_linkage_count} |`);
  lines.push(`| Пакетных решений | ${compaction.package_decision_count} (SKU: ${compaction.package_sku_count}) |`);
  lines.push(`| Индивидуальных решений | ${compaction.individual_decision_count} |`);
  lines.push(`| **Фактических решений владельца** | **${compaction.total_owner_decision_count}** |`);
  lines.push('');
  const groupEntries = Object.entries(compaction.groups).filter(([, count]) => count > 0);
  if (groupEntries.length > 0) {
    lines.push('Группы сигналов (взаимоисключающие, сумма = business SKU):');
    lines.push(groupEntries.map(([group, count]) => `${group} ${count}`).join(' · '));
    lines.push('');
  }
  if (compaction.packages.length > 0) {
    lines.push('## Пакетные решения');
    lines.push('');
    for (const pkg of compaction.packages) {
      lines.push(`### ${pkg.package_id} — ${pkg.decision_type} — ${pkg.count} SKU`);
      lines.push(`**Вопрос:** ${pkg.business_question}`);
      lines.push(`**SKU:** ${pkg.articles.join(', ')}`);
      lines.push(`**Почему объединены:** ${pkg.evidence_summary}`);
      lines.push(`**Варианты:** ${pkg.decision_options.join(' / ')}`);
      lines.push('');
    }
  }
  if (compaction.individuals.length > 0) {
    lines.push('## Индивидуальные решения');
    lines.push('');
    for (const individual of compaction.individuals) {
      lines.push(
        `- ${individual.decision_id}: ${individual.article || '—'} ${individual.name || ''} ` +
        `[${individual.owner_signals.join(', ')}] — ${individual.business_question}`
      );
    }
    lines.push('');
  }
  if (compaction.exclusions.length > 0) {
    lines.push('## DATA_OR_LINKAGE (не решения владельца)');
    lines.push('');
    for (const exclusion of compaction.exclusions) {
      lines.push(
        `- ${exclusion.article || '—'} ${exclusion.name || ''}: ${exclusion.linkage_reason_label}`
      );
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Writes the deterministic owner_review_compaction artifacts next to the
 * triage run output (tmp/ by convention). Read-only w.r.t. the purchasing
 * pipeline: files land only in the requested directory.
 */
function saveCompactionArtifacts(compaction, directory) {
  const targetDir = path.resolve(directory);
  fs.mkdirSync(targetDir, { recursive: true });
  const runTag = String(compaction.source_run_id || 'unknown').replace(/[^0-9a-zA-Z-]/g, '_');
  const jsonPath = path.join(targetDir, `owner-review-compaction-${runTag}.json`);
  const csvPath = path.join(targetDir, `owner-review-compaction-${runTag}.csv`);
  const mdPath = path.join(targetDir, `owner-review-compact-${runTag}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(compaction, null, 2)}\n`);
  fs.writeFileSync(csvPath, buildCompactionCsv(compaction));
  fs.writeFileSync(mdPath, buildCompactionMarkdown(compaction));
  return { jsonPath, csvPath, mdPath };
}

function readJsonFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Canonical matrix is needed for the POLICY A provenance check
 * (rule_changed_by of the exactly matched supplier_sku item). Loaded
 * read-only; when absent, triage falls back to "no provenance" and keeps
 * every policy conflict in the owner queue.
 */
function loadCanonicalMatrix() {
  if (!fs.existsSync(DEFAULT_ASSORTMENT_MATRIX_PATH)) {
    console.warn('[TRIAGE_MATRIX_WARNING] canonical matrix not found; POLICY A auto-resolution disabled.');
    return null;
  }
  return readJsonFile(DEFAULT_ASSORTMENT_MATRIX_PATH, 'canonical matrix');
}

/**
 * Loads the verified owner-review session registry (data-driven provenance
 * for POLICY A). Fail-safe by design:
 *   - missing file        -> no sessions (owner review stays);
 *   - broken JSON         -> warning, no sessions;
 *   - session without a control-artifact reference, or with an artifact
 *     path that does not resolve to an existing file, is dropped
 *     (deterministic local check; provenance is never taken on trust).
 */
function loadOwnerReviewSessions(overridePath) {
  const registryPath = overridePath || DEFAULT_OWNER_REVIEW_SESSIONS_PATH;
  if (!fs.existsSync(registryPath)) {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch (parseError) {
    console.warn(`[TRIAGE_SESSIONS_WARNING] broken registry (${parseError.message}); POLICY A auto-resolution disabled.`);
    return [];
  }
  const sessions = [];
  for (const session of Array.isArray(parsed?.sessions) ? parsed.sessions : []) {
    const sessionId = typeof session?.session_id === 'string' ? session.session_id.trim() : '';
    if (!sessionId) continue;
    const artifactPath = typeof session?.control_artifact_path === 'string'
      ? session.control_artifact_path.trim()
      : '';
    if (!artifactPath) {
      console.warn(`[TRIAGE_SESSIONS_WARNING] session ${sessionId} has no control artifact; skipped.`);
      continue;
    }
    if (!fs.existsSync(path.resolve(REPOSITORY_ROOT, artifactPath))) {
      console.warn(`[TRIAGE_SESSIONS_WARNING] session ${sessionId} control artifact not found (${artifactPath}); skipped.`);
      continue;
    }
    sessions.push({
      session_id: sessionId,
      verified_at: session.verified_at ?? null,
      verified_by: session.verified_by ?? null,
      control_artifact_path: artifactPath,
    });
  }
  return sessions;
}

/**
 * result.json may be the bare agentJson, wrapped ({json: agentJson}) or an
 * n8n-style array wrapping either shape.
 */
function extractAgentJson(raw) {
  let value = raw;
  if (Array.isArray(value) && value.length > 0) {
    value = value[0];
  }
  if (value && typeof value === 'object' && value.json && typeof value.json === 'object') {
    return value.json;
  }
  return value;
}

function buildBundleFromRunDir(runDir, sessionsPath) {
  const resolved = path.resolve(runDir);
  const agentJson = extractAgentJson(readJsonFile(path.join(resolved, 'result.json'), 'result.json'));
  const manualReview = readJsonFile(path.join(resolved, 'manual-review.json'), 'manual-review.json');
  const ownerReview = readJsonFile(path.join(resolved, 'owner-review.json'), 'owner-review.json');
  // run-metadata.json (written next to the artifacts by the run service) is
  // the authoritative run id source; agentJson itself may not carry run_id.
  let runId = agentJson.run_id || null;
  const metadataPath = path.join(resolved, 'run-metadata.json');
  if (!runId && fs.existsSync(metadataPath)) {
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      runId = metadata.run_id || null;
    } catch (metadataError) {
      console.warn(`[TRIAGE_METADATA_WARNING] ${metadataError.message}`);
    }
  }
  return {
    runId: runId || path.basename(resolved),
    agentJson,
    manualReview,
    ownerReview,
    canonicalMatrix: loadCanonicalMatrix(),
    ownerReviewSessions: loadOwnerReviewSessions(sessionsPath),
  };
}

/**
 * Mirrors defaultExplanationContextBuilder from scripts/run-purchasing-agent.js:
 * matrix builder draft -> owner decisions application -> owner review model.
 */
async function buildBundleFromInput(inputPath, sessionsPath) {
  const {
    DEFAULT_MATRIX_BUILDER_CONFIG_PATH,
    buildMatrixDraftFromSmartZapasXlsx,
  } = require('../agents/purchasing/matrix_builder/matrix_builder');
  const {
    applyOwnerDecisions,
    loadOwnerDecisions,
  } = require('../agents/purchasing/matrix_builder/owner_decisions');
  const { buildOwnerReviewModel } = require(
    '../agents/purchasing/matrix_builder/owner_review_dashboard'
  );
  const { loadDecisionHistory } = require(
    '../agents/purchasing/owner_learning/owner_decision_history'
  );
  const {
    runOrderAgentFromSmartZapasXlsxWithDemand,
  } = require('../agents/purchasing/order_agent');

  const resolvedInput = path.resolve(inputPath);
  if (!fs.existsSync(resolvedInput)) {
    throw new Error(`Input file not found: ${resolvedInput}`);
  }

  const agentResult = await runOrderAgentFromSmartZapasXlsxWithDemand(
    resolvedInput,
    { purchasingProfile: 'miska' },
    {
      financialDataPath: DEFAULT_FINANCIAL_DATA_PATH,
      assortmentMatrixPath: DEFAULT_ASSORTMENT_MATRIX_PATH,
      ownerDecisionsPath: DEFAULT_OWNER_DECISIONS_PATH,
      ownerDecisionNow: new Date().toISOString(),
    }
  );
  const agentJson = extractAgentJson(Array.isArray(agentResult) ? agentResult[0] : agentResult);

  const matrixResult = await buildMatrixDraftFromSmartZapasXlsx(resolvedInput, {
    configPath: DEFAULT_MATRIX_BUILDER_CONFIG_PATH,
    existingMatrixPath: DEFAULT_ASSORTMENT_MATRIX_PATH,
  });

  const ownerDecisions = loadOwnerDecisions(DEFAULT_OWNER_DECISIONS_PATH, {
    allowMissing: true,
  });
  let ownerDecisionHistory = null;
  try {
    ownerDecisionHistory = loadDecisionHistory({
      filePath: DEFAULT_OWNER_DECISION_HISTORY_PATH,
    });
  } catch (historyError) {
    console.warn(`[OWNER_DECISION_HISTORY_LOAD_WARNING] ${historyError.message}`);
  }
  const ownerApplication = applyOwnerDecisions(
    matrixResult.draft,
    ownerDecisions.store,
    {
      history: ownerDecisionHistory,
      enableLegacyResolution: true,
    }
  );
  const ownerReview = buildOwnerReviewModel(
    ownerApplication.draft,
    matrixResult.manualReview,
    matrixResult.config,
    ownerApplication.summary,
    agentJson.workingOrderProducts
  );

  return {
    runId: agentJson.run_id || `triage-${path.basename(resolvedInput)}`,
    agentJson,
    manualReview: matrixResult.manualReview,
    ownerReview,
    canonicalMatrix: loadCanonicalMatrix(),
    ownerReviewSessions: loadOwnerReviewSessions(sessionsPath),
  };
}

function resolveAiProvider(enabled) {
  if (!enabled) return null;
  if (process.env.ARTHUR_AI_PROVIDER !== 'omniroute') {
    console.warn('[TRIAGE_AI] ARTHUR_AI_PROVIDER != "omniroute"; deterministic mode is used.');
    return null;
  }
  const { createOmniRouteProvider } = require('../agents/arthur-v1/ai/omniroute_provider');
  return createOmniRouteProvider();
}

function formatMoney(value, isPartial) {
  if (value === null || value === undefined) return '—';
  return `${value.toLocaleString('ru-RU')} ₽${isPartial ? ' (частично)' : ''}`;
}

function printSection(title, section) {
  console.log('');
  console.log(`## ${title} — ${section.count} поз.`);
  if (section.count === 0) {
    console.log('Нет позиций.');
    return;
  }
  console.log(`Сумма: ${formatMoney(section.sum, section.sum_is_partial)}; ` +
    `без достоверной суммы: ${section.value_unknown_count}.`);
  const reasonEntries = Object.entries(section.reasons);
  if (reasonEntries.length > 0) {
    console.log(`Причины: ${reasonEntries.map(([code, count]) => `${code}=${count}`).join(', ')}.`);
  }
  if (section.blocking.length > 0) {
    console.log('Блокирующие:');
    for (const item of section.blocking) {
      console.log(`  - [${item.reason_code}] ${item.supplier_sku || '—'} ${item.name || ''}`.trim());
    }
  }
  if (section.next_actions.length > 0) {
    console.log(`Действия: ${section.next_actions.join('; ')}.`);
  }
}

function printReport(triage, explanation) {
  const comparison = triage.comparison;
  console.log('Разбор ручной очереди закупщика (read-only)');
  console.log(`Run: ${triage.source_run_id || '—'} | calculation: ${triage.calculation_version || '—'}`);
  console.log(`AI-провайдер: ${explanation.ai_available ? 'доступен' : 'недоступен'}` +
    (explanation.ai_error ? ` (${explanation.ai_error})` : ''));
  console.log('');
  console.log('До/после:');
  console.log(`  в ручной очереди до разбора:      ${comparison.manual_queue_total_before}`);
  console.log(`  готово к заказу:                  ${comparison.ready}`);
  console.log(`  проблемы данных:                  ${comparison.data_problems}`);
  console.log(`  нет правила/связи с матрицей:     ${comparison.matrix_gaps}`);
  console.log(`  реальные решения владельца:       ${comparison.real_owner_decisions_after}`);
  console.log(`  выведено из owner-очереди:        ${comparison.moved_out_of_owner_queue}`);
  console.log('');
  console.log('Сводка:');
  console.log(explanation.summary);
  const sections = triage.current_manual_sections || triage.sections;
  printSection('Готово к заказу', sections.ready);
  printSection('Проблемы данных — исправить', sections.data_problems);
  printSection('Нет правила или связи с матрицей', sections.matrix_gaps);
  printSection('Требуется решение Сергея', sections.owner_decisions);
  if (explanation.contradictions && explanation.contradictions.length > 0) {
    console.log('');
    console.log('Противоречия и замечания:');
    for (const note of explanation.contradictions) {
      console.log(`  - ${note}`);
    }
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(helpText());
    return;
  }

  const bundle = args.runDir
    ? buildBundleFromRunDir(args.runDir, args.sessions)
    : await buildBundleFromInput(args.input, args.sessions);

  const triage = triageReviewQueue(bundle, { generatedAt: new Date().toISOString() });
  const provider = resolveAiProvider(args.ai);
  const explanation = await explainTriage(triage, { provider, bundle });

  printReport(triage, explanation);

  const compaction = triage.owner_review_compaction;
  if (compaction) {
    console.log('');
    console.log('Компакция owner-очереди (read-only):');
    console.log(`  бизнес-позиций:                    ${compaction.business_sku_count}`);
    console.log(`  DATA_OR_LINKAGE (не к владельцу):  ${compaction.data_or_linkage_count}`);
    console.log(`  пакетных решений:                  ${compaction.package_decision_count} (SKU: ${compaction.package_sku_count})`);
    for (const pkg of compaction.packages) {
      console.log(`    - ${pkg.package_id} ${pkg.decision_type}: ${pkg.count} SKU (${pkg.articles.join(', ')})`);
    }
    console.log(`  индивидуальных решений:            ${compaction.individual_decision_count}`);
    console.log(`  фактических решений владельца:     ${compaction.total_owner_decision_count}`);
  }

  if (args.compactionDir && compaction) {
    const written = saveCompactionArtifacts(compaction, args.compactionDir);
    console.log('');
    console.log(`Compaction записан: ${written.jsonPath}`);
    console.log(`                    ${written.csvPath}`);
    console.log(`                    ${written.mdPath}`);
    const html = renderOwnerReviewHtml({
      triage,
      compaction,
      canonicalMatrix: bundle.canonicalMatrix,
      manualReview: bundle.manualReview,
    });
    const runTag = String(compaction.source_run_id || 'unknown').replace(/[^0-9a-zA-Z-]/g, '_');
    const htmlPath = path.join(path.resolve(args.compactionDir), `owner-review-${runTag}.html`);
    fs.writeFileSync(htmlPath, html);
    console.log(`HTML-отчёт записан: ${htmlPath} (${html.length} байт)`);
  }

  if (args.output) {
    const outputPath = path.resolve(args.output);
    fs.writeFileSync(
      outputPath,
      `${JSON.stringify({ triage, explanation }, null, 2)}\n`
    );
    console.log('');
    console.log(`Полный отчёт записан: ${outputPath}`);
  }
}

main().catch(error => {
  console.error(`[TRIAGE_FAILED] ${error.message}`);
  process.exitCode = 1;
});
