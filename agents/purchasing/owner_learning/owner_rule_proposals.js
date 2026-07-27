const crypto = require('node:crypto');

const REPORT_VERSION = 'owner-rule-proposals-v0.3';
const SOURCE_PATTERNS_VERSION = 'owner-learning-patterns-v0.2';
const RULE_TYPE = 'ITEM_DECISION';
const PROPOSAL_STATUS = 'PENDING';
const SUPPORTED_DECISIONS = new Set(['BUY', 'SKIP', 'DEFER']);
const PROPOSAL_WARNING =
  'Предложение ещё не подтверждено владельцем и не применяется агентом.';
const AUTOMATION_NOTICE =
  'Ни одно предложение не применяется автоматически. Для создания правила ' +
  'требуется отдельное подтверждение владельца.';
const DECISION_LABELS = Object.freeze({
  BUY: 'Заказать',
  SKIP: 'Не заказывать',
  DEFER: 'Отложить',
});

function optionalString(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function validRate(value) {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

function buildProposalId(stableItemKey, proposedDecision, ruleType = RULE_TYPE) {
  const key = optionalString(stableItemKey);
  const decision = optionalString(proposedDecision)?.toUpperCase() || null;
  const type = optionalString(ruleType);
  if (!key || !decision || !type) {
    throw new TypeError(
      'Proposal ID требует stableItemKey, proposedDecision и ruleType.'
    );
  }
  const digest = crypto
    .createHash('sha256')
    .update(`${type}\u0000${key}\u0000${decision}`, 'utf8')
    .digest('hex')
    .slice(0, 24);
  return `owner-rule-${digest}`;
}

function usuallyAgreesWithAgent(agreementCount, overrideCount) {
  if (
    !nonNegativeInteger(agreementCount) ||
    !nonNegativeInteger(overrideCount) ||
    agreementCount === overrideCount
  ) {
    return null;
  }
  return agreementCount > overrideCount;
}

function formatRate(value) {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function timesText(value) {
  const lastTwo = value % 100;
  const last = value % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return `${value} раз`;
  if (last === 1) return `${value} раз`;
  if (last >= 2 && last <= 4) return `${value} раза`;
  return `${value} раз`;
}

function casesText(value) {
  return value === 1 ? 'В 1 случае' : `В ${value} случаях`;
}

function buildExplanation(candidate, proposedDecision) {
  return [
    `Владелец выбрал ${proposedDecision} ${
      timesText(candidate.consecutiveSameDecisionCount)
    } подряд.`,
    `Решение ${proposedDecision} составляет ${
      formatRate(candidate.dominantDecisionRate)
    }% из ${candidate.totalOwnerDecisions} сохранённых решений.`,
    `${casesText(candidate.overrideCount)} оно переопределяло рекомендацию ` +
      'агента.',
  ].join(' ');
}

function validCandidate(candidate) {
  const decision = optionalString(
    candidate?.dominantOwnerDecision
  )?.toUpperCase();
  return Boolean(
    optionalString(candidate?.stableItemKey) &&
    optionalString(candidate?.name) &&
    SUPPORTED_DECISIONS.has(decision) &&
    nonNegativeInteger(candidate?.totalOwnerDecisions) &&
    candidate.totalOwnerDecisions > 0 &&
    validRate(candidate?.dominantDecisionRate) &&
    nonNegativeInteger(candidate?.consecutiveSameDecisionCount) &&
    nonNegativeInteger(candidate?.agreementCount) &&
    nonNegativeInteger(candidate?.overrideCount)
  );
}

function proposalFromCandidate(candidate) {
  const proposedDecision = candidate.dominantOwnerDecision.toUpperCase();
  return {
    proposalId: buildProposalId(
      candidate.stableItemKey,
      proposedDecision,
      RULE_TYPE
    ),
    stableItemKey: candidate.stableItemKey,
    name: candidate.name,
    brand: optionalString(candidate.brand),
    proposedDecision,
    ruleType: RULE_TYPE,
    status: PROPOSAL_STATUS,
    evidence: {
      totalOwnerDecisions: candidate.totalOwnerDecisions,
      dominantDecisionRate: candidate.dominantDecisionRate,
      consecutiveSameDecisionCount:
        candidate.consecutiveSameDecisionCount,
      agreementCount: candidate.agreementCount,
      overrideCount: candidate.overrideCount,
      usuallyAgreesWithAgent: usuallyAgreesWithAgent(
        candidate.agreementCount,
        candidate.overrideCount
      ),
    },
    explanation: buildExplanation(candidate, proposedDecision),
    warning: PROPOSAL_WARNING,
  };
}

function buildOwnerRuleProposals(patternsReport = {}, options = {}) {
  const candidates = Array.isArray(patternsReport.ruleCandidates)
    ? patternsReport.ruleCandidates
    : [];
  const proposals = [];
  let skippedInvalidCandidates = 0;
  for (const candidate of candidates) {
    if (!validCandidate(candidate)) {
      skippedInvalidCandidates += 1;
      continue;
    }
    proposals.push(proposalFromCandidate(candidate));
  }
  proposals.sort((left, right) =>
    left.proposalId.localeCompare(right.proposalId)
  );
  return {
    reportVersion: REPORT_VERSION,
    generatedAt: optionalString(options.generatedAt) ||
      optionalString(patternsReport.generatedAt),
    sourcePatternsVersion:
      optionalString(patternsReport.reportVersion) ||
      SOURCE_PATTERNS_VERSION,
    candidatesCount: candidates.length,
    proposalsCount: proposals.length,
    skippedInvalidCandidates,
    proposals,
  };
}

function agreementLabel(value) {
  if (value === true) return 'да';
  if (value === false) return 'нет';
  return 'недостаточно данных';
}

function buildOwnerRuleProposalsMarkdown(report) {
  const lines = [
    '# Предложения правил владельца',
    '',
    `- Кандидатов найдено: ${report.candidatesCount}`,
    `- Предложений сформировано: ${report.proposalsCount}`,
    `- Некорректных кандидатов пропущено: ${
      report.skippedInvalidCandidates
    }`,
    '',
    AUTOMATION_NOTICE,
    '',
    '## Предложения',
    '',
  ];
  if (!Array.isArray(report.proposals) || report.proposals.length === 0) {
    lines.push(
      'Пока нет предложений правил. Необходимо накопить минимум три ' +
        'последовательных одинаковых решения владельца с достаточной ' +
        'устойчивостью.',
      ''
    );
    return lines.join('\n');
  }
  for (const proposal of report.proposals) {
    lines.push(
      `### ${proposal.name}`,
      '',
      `- Бренд: ${proposal.brand || 'не указан'}`,
      `- Предлагаемое решение: ${
        DECISION_LABELS[proposal.proposedDecision]
      } (${proposal.proposedDecision})`,
      `- Решений владельца всего: ${
        proposal.evidence.totalOwnerDecisions
      }`,
      `- Одинаковых решений подряд: ${
        proposal.evidence.consecutiveSameDecisionCount
      }`,
      `- Доля доминирующего решения: ${
        formatRate(proposal.evidence.dominantDecisionRate)
      }%`,
      `- Совпадает ли обычно с агентом: ${
        agreementLabel(proposal.evidence.usuallyAgreesWithAgent)
      }`,
      `- ID предложения: ${proposal.proposalId}`,
      '- Статус: ожидает подтверждения',
      '',
      proposal.explanation,
      '',
      proposal.warning,
      ''
    );
  }
  return lines.join('\n');
}

function unavailableOwnerRuleProposals(generatedAt, sourceVersion, errorCode) {
  return {
    reportVersion: REPORT_VERSION,
    generatedAt: optionalString(generatedAt),
    sourcePatternsVersion: optionalString(sourceVersion) ||
      SOURCE_PATTERNS_VERSION,
    status: 'unavailable',
    errorCode: optionalString(errorCode) || 'PROPOSALS_UNAVAILABLE',
    candidatesCount: null,
    proposalsCount: null,
    skippedInvalidCandidates: null,
    proposals: [],
  };
}

function unavailableOwnerRuleProposalsMarkdown() {
  return [
    '# Предложения правил владельца',
    '',
    AUTOMATION_NOTICE,
    '',
    'Предложения временно недоступны. Основной расчёт заказа завершён.',
    '',
  ].join('\n');
}

module.exports = {
  AUTOMATION_NOTICE,
  PROPOSAL_WARNING,
  REPORT_VERSION,
  RULE_TYPE,
  buildOwnerRuleProposals,
  buildOwnerRuleProposalsMarkdown,
  buildProposalId,
  unavailableOwnerRuleProposals,
  unavailableOwnerRuleProposalsMarkdown,
  usuallyAgreesWithAgent,
};
