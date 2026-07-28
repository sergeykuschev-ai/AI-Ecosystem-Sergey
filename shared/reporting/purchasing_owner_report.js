'use strict';

function formatMoney(value) {
  if (value === null || value === undefined) return 'нет данных';
  return `${new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} RUB`;
}

function decisionSummaryLines(title, summary) {
  if (!summary) return [];
  return [
    title,
    `- must_buy: ${summary.mustBuyCount ?? 0}`,
    `- recommended: ${summary.recommendedCount ?? 0}`,
    `- manual_review: ${summary.manualReviewCount ?? 0}`,
    `- postpone: ${summary.postponeCount ?? 0}`,
    `- do_not_buy: ${summary.doNotBuyCount ?? 0}`,
  ];
}

function extractDecisionDistributions(agentJson) {
  if (agentJson.phase1DecisionSummary) {
    return {
      phase1: agentJson.phase1DecisionSummary,
      phase2: {
        mustBuyCount: agentJson.mustBuyCount,
        recommendedCount: agentJson.recommendedCount,
        manualReviewCount: agentJson.manualReviewCount,
        postponeCount: agentJson.postponeCount,
        doNotBuyCount: agentJson.doNotBuyCount,
      },
    };
  }
  return {
    phase1: {
      mustBuyCount: agentJson.mustBuyCount,
      recommendedCount: agentJson.recommendedCount,
      manualReviewCount: agentJson.manualReviewCount,
      postponeCount: agentJson.postponeCount,
      doNotBuyCount: agentJson.doNotBuyCount,
    },
    phase2: null,
  };
}

function collectCriticalProblems(agentJson) {
  const problems = [];
  const assessment = agentJson.financial_assessment || {};
  problems.push(...(assessment.financial_data_errors || []));
  if (assessment.status === 'PRELIMINARY' &&
      (assessment.missing_fields || []).length > 0) {
    problems.push(
      `Финансовое решение не подтверждено; отсутствуют поля: ${assessment.missing_fields.join(', ')}`
    );
  }
  const missingColumns =
    agentJson.adapter_diagnostics?.missingRequiredColumns || [];
  if (missingColumns.length > 0) {
    problems.push(`Отсутствуют обязательные столбцы: ${missingColumns.length}`);
  }
  return Array.from(new Set(problems));
}

function buildPurchasingOwnerReport({
  agentJson,
  store,
  runDate,
  inputFileName,
  warnings,
}) {
  const assessment = agentJson.financial_assessment || {};
  const distributions = extractDecisionDistributions(agentJson);
  const criticalProblems = collectCriticalProblems(agentJson);
  const lines = [
    `ОТЧЁТ ВЛАДЕЛЬЦУ — МАГАЗИН «${store}»`,
    '',
    `Дата запуска: ${runDate}`,
    `Входной файл: ${inputFileName}`,
    `Итоговая сумма заказа: ${formatMoney(
      assessment.proposed_order_amount ?? agentJson.preliminary_order_sum
    )}`,
    `Товарных строк: ${agentJson.product_rows_count}`,
    `Статус финансовой оценки: ${assessment.status || 'нет данных'}`,
    `Итоговое решение для владельца: ${assessment.recommendation || 'нет данных'}`,
    '',
    ...decisionSummaryLines(
      'Распределение решений Phase 1:',
      distributions.phase1
    ),
  ];
  if (distributions.phase2) {
    lines.push(
      '',
      ...decisionSummaryLines(
        'Распределение решений Phase 2:',
        distributions.phase2
      )
    );
  }

  lines.push('', 'Предупреждения:');
  if (warnings.length === 0) lines.push('- нет');
  else warnings.forEach(warning => lines.push(`- ${warning}`));

  lines.push('', 'Критические проблемы:');
  if (criticalProblems.length === 0) lines.push('- нет');
  else criticalProblems.forEach(problem => lines.push(`- ${problem}`));

  lines.push('', agentJson.minmax_text.trimEnd(), '');
  return lines.join('\n');
}

module.exports = {
  buildPurchasingOwnerReport,
  formatMoney,
};
