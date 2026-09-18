'use strict';

/**
 * Optional AI enrichment for the review triage.
 *
 * The provider is injected by the caller (dependency injection): any object
 * with `generate(prompt, options) -> string` works, e.g. the OmniRoute
 * provider from agents/arthur-v1. When the provider is missing or fails,
 * a deterministic template summary is produced instead. Classification
 * fields are NEVER modified here — this module only adds explanatory text.
 */

const EXPLAINER_VERSION = 'review-triage-explainer-v1';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function templateSectionNarrative(key, section) {
  if (!section || section.count === 0) {
    return 'Позиций нет.';
  }
  const reasonLines = Object.entries(section.reasons || {})
    .map(([code, count]) => `- ${code}: ${count}`)
    .join('\n');
  return [
    `Позиций: ${section.count}.`,
    `Сумма известных строк: ${section.sum} ₽${section.sum_is_partial ? ' (частично: у части позиций нет достоверной цены/количества)' : ''}.`,
    'Основные причины:',
    reasonLines,
    `Следующие действия: ${(section.next_actions || []).join(' ')}`,
  ].join('\n');
}

function buildDeterministicSummary(triage) {
  const comparison = triage.comparison || {};
  const lines = [
    `Разбор ручной очереди: всего ${comparison.manual_queue_total_before} позиций.`,
    `- Готово к заказу: ${comparison.ready}`,
    `- Проблемы данных: ${comparison.data_problems}`,
    `- Нет правила/связи с матрицей: ${comparison.matrix_gaps}`,
    `- Требуется решение владельца: ${comparison.real_owner_decisions_after}`,
    `Из общей очереди в управленческие решения не переносятся ` +
    `${comparison.moved_out_of_owner_queue} позиций.`,
  ];
  return lines.join('\n');
}

/**
 * Detects contradictions between classification and raw signals.
 * Purely deterministic; these are surfaced to the owner, never auto-fixed.
 */
function detectContradictions(triage, bundle) {
  const contradictions = [];
  const sections = triage.current_manual_sections || triage.sections || {};
  const categories = triage.current_manual_categories || triage.categories || {};
  const ownerSectionIds = new Set(
    asArray(sections?.owner_decisions?.items).map(item => item.row_identity)
  );
  const readyItems = asArray(sections?.ready?.items);
  const manualItems = new Set(
    asArray(bundle?.manualReview?.items).map(item => item.rowIdentity)
  );

  for (const item of readyItems) {
    if (item.row_identity && !manualItems.has(item.row_identity)) {
      contradictions.push(
        `READY: позиция ${item.supplier_sku || item.name} помечена готовой, ` +
        'но отсутствует в файле ручной проверки matrix builder.'
      );
    }
  }

  const diagnostics = asArray(
    bundle?.agentJson?.adapter_diagnostics?.duplicateIdentifiers
  );
  if (diagnostics.length > 0 && (categories?.DUPLICATE_SKU ?? 0) === 0) {
    contradictions.push(
      'В диагностике адаптера есть дубли идентификаторов, но ни одна позиция ' +
      'не классифицирована как DUPLICATE_SKU — проверить разметку вручную.'
    );
  }

  if (ownerSectionIds.size === 0 &&
      (sections?.owner_decisions?.count ?? 0) === 0 &&
      (triage.comparison?.manual_queue_total_before ?? 0) > 0) {
    // Not a contradiction: a clean queue. Left here intentionally empty.
  }

  return Array.from(new Set(contradictions));
}

function buildPrompt(triage, contradictions) {
  const sections = triage.current_manual_sections || triage.sections || {};
  const compactSection = key => {
    const section = sections[key];
    if (!section || section.count === 0) return `${key}: пусто`;
    const top = asArray(section.items)
      .slice(0, 10)
      .map(item =>
        `- [${item.reason_code}] ${item.supplier_sku || '—'} ${item.name || '—'} ` +
        `(severity=${item.severity})`
      )
      .join('\n');
    return [
      `${key}: ${section.count} позиций, сумма известных строк ${section.sum} ₽`,
      top,
    ].join('\n');
  };

  return [
    'Ты — помощник закупщика зоомагазина «Миска» (Амурск).',
    'Ниже — детерминированный разбор ручной очереди закупки, рассчитанный Purchasing Agent.',
    'Твоя задача: объяснить владельцу сводку простым языком, объединить однотипные проблемы,',
    'предложить безопасные следующие действия и отметить противоречия.',
    'ЗАПРЕЩЕНО: менять количества, цены, Min/Max, придумывать остатки или продажи,',
    'принимать решения за владельца. Только текстовое объяснение.',
    '',
    buildDeterministicSummary(triage),
    '',
    compactSection('ready'),
    '',
    compactSection('data_problems'),
    '',
    compactSection('matrix_gaps'),
    '',
    compactSection('owner_decisions'),
    '',
    contradictions.length > 0
      ? `Противоречия:\n${contradictions.map(item => `- ${item}`).join('\n')}`
      : 'Противоречия: не обнаружены.',
    '',
    'Сформируй: 1) краткую сводку (до 5 предложений); 2) главные действия по каждому разделу;',
    '3) замечания по противоречиям. Пиши по-русски, деловым тоном.',
  ].join('\n');
}

/**
 * Enriches the triage with plain-language narratives.
 *
 * @param {object} triage - result of triageReviewQueue()
 * @param {object} [options] - { provider?, bundle?, generatedAt?, maxTokens? }
 * @returns {Promise<object>} { explainer_version, ai_available, summary, section_narratives, contradictions }
 */
async function explainTriage(triage, options = {}) {
  if (!triage || typeof triage !== 'object') {
    throw new TypeError('explainTriage requires a triage report.');
  }
  const provider = options.provider || null;
  const contradictions = detectContradictions(triage, options.bundle || {});

  const sections = triage.current_manual_sections || triage.sections || {};
  const fallbackNarratives = {
    ready: templateSectionNarrative('ready', sections?.ready),
    data_problems: templateSectionNarrative('data_problems', sections?.data_problems),
    matrix_gaps: templateSectionNarrative('matrix_gaps', sections?.matrix_gaps),
    owner_decisions: templateSectionNarrative('owner_decisions', sections?.owner_decisions),
  };

  if (!provider || typeof provider.generate !== 'function') {
    return {
      explainer_version: EXPLAINER_VERSION,
      ai_available: false,
      ai_error: null,
      summary: buildDeterministicSummary(triage),
      section_narratives: fallbackNarratives,
      contradictions,
    };
  }

  try {
    const text = await provider.generate(buildPrompt(triage, contradictions), {
      temperature: 0.2,
      maxTokens: options.maxTokens || 1500,
    });
    const summary = typeof text === 'string' && text.trim().length > 0
      ? text.trim()
      : buildDeterministicSummary(triage);
    return {
      explainer_version: EXPLAINER_VERSION,
      ai_available: true,
      ai_error: null,
      summary,
      section_narratives: fallbackNarratives,
      contradictions,
    };
  } catch (error) {
    return {
      explainer_version: EXPLAINER_VERSION,
      ai_available: false,
      ai_error: error?.code || error?.message || 'AI_PROVIDER_FAILED',
      summary: buildDeterministicSummary(triage),
      section_narratives: fallbackNarratives,
      contradictions,
    };
  }
}

module.exports = {
  EXPLAINER_VERSION,
  buildDeterministicSummary,
  detectContradictions,
  explainTriage,
};
