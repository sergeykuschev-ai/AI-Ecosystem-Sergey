'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SELLER_TASK_LIBRARY,
} = require('../../../agents/business-kpi/rules/seller_task_library');
const {
  buildTaskProposals,
} = require('../../../agents/business-kpi/services/seller_task_planner');
const {
  ONBOARDING_PHASES,
  buildOnboardingProgress,
  buildTodayTrainingRecommendation,
  certificationWeakModules,
} = require('../../../agents/business-kpi/rules/seller_training_path');

const KNOWLEDGE = SELLER_TASK_LIBRARY.filter(item => item.type === 'KNOWLEDGE');

function progress(completedCodes = []) {
  return KNOWLEDGE.map(item => ({
    code: item.code,
    completed: completedCodes.includes(item.code),
    status: completedCodes.includes(item.code) ? 'COMPLETED' : 'NOT_STARTED',
  }));
}

test('onboarding path covers all 25 modules in five ordered phases', () => {
  assert.equal(ONBOARDING_PHASES.length, 5);
  const allCodes = ONBOARDING_PHASES.flatMap(phase => phase.codes);
  assert.equal(allCodes.length, 25);
  assert.equal(new Set(allCodes).size, 25);

  const first = buildOnboardingProgress(progress(), KNOWLEDGE);
  assert.equal(first.currentPhase.index, 1);
  assert.equal(first.nextModule.code, 'KNOW-19');
  assert.equal(first.certificationReady, false);

  const foundationDone = buildOnboardingProgress(
    progress(['KNOW-19', 'KNOW-20', 'KNOW-21']),
    KNOWLEDGE
  );
  assert.equal(foundationDone.currentPhase.index, 2);
  assert.equal(foundationDone.nextModule.code, 'KNOW-04');
});

test('KPI miss recommends the matching sales practice before normal onboarding', () => {
  const onboarding = buildOnboardingProgress(progress(), KNOWLEDGE);
  const recommendation = buildTodayTrainingRecommendation({
    onboarding,
    latestAttempt: null,
    weakModules: [],
    performanceItem: {
      itemsPerReceipt: 1.8,
      averageCheck: 1400,
      revenuePerShift: 26000,
    },
    targets: {
      itemsPerReceipt: 2.5,
      averageCheck: 1200,
      shiftRevenue: 24000,
    },
    library: SELLER_TASK_LIBRARY,
  });
  assert.equal(recommendation.kind, 'KPI_COACHING');
  assert.equal(recommendation.practiceCode, 'SALE-08');
});

test('failed certification weak module outranks KPI coaching', () => {
  const bank = [
    { id: 'Q1', moduleCode: 'KNOW-03', correctIndex: 1 },
    { id: 'Q2', moduleCode: 'KNOW-03', correctIndex: 0 },
    { id: 'Q3', moduleCode: 'KNOW-19', correctIndex: 0 },
  ];
  const attempt = {
    passed: false,
    percent: 67,
    answers: { Q1: 0, Q2: 1, Q3: 0 },
  };
  const weak = certificationWeakModules(attempt, bank, KNOWLEDGE);
  assert.equal(weak[0].code, 'KNOW-03');
  assert.equal(weak[0].wrong, 2);

  const recommendation = buildTodayTrainingRecommendation({
    onboarding: buildOnboardingProgress(progress(), KNOWLEDGE),
    latestAttempt: attempt,
    weakModules: weak,
    performanceItem: { itemsPerReceipt: 1.5 },
    targets: { itemsPerReceipt: 2.5 },
    library: SELLER_TASK_LIBRARY,
  });
  assert.equal(recommendation.kind, 'CERTIFICATION_REVIEW');
  assert.equal(recommendation.moduleCode, 'KNOW-03');
});

test('planner prioritizes a certification review module even inside rotation window', () => {
  const proposals = buildTaskProposals({
    sellers: [{ id: 'e1', displayName: 'Продавец', participatesInSellerKpi: true }],
    targets: null,
    performanceItems: [],
    historyEntries: [{
      employeeId: 'e1',
      shiftDate: '2026-09-20',
      libraryCode: 'KNOW-03',
      status: 'COMPLETED',
      source: 'ARTHUR',
    }],
    shiftDate: '2026-09-22',
    today: '2026-09-21',
    library: SELLER_TASK_LIBRARY,
    knowledgePriorityByEmployee: { e1: ['KNOW-03'] },
  });
  const knowledge = proposals.find(item => item.taskType === 'KNOWLEDGE');
  assert.equal(knowledge.libraryCode, 'KNOW-03');
  assert.match(knowledge.reason, /аттестации/i);
});
