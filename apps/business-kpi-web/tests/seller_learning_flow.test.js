'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SellerTasksService,
} = require('../application/seller_tasks_service');
const {
  DEV_EMPLOYEES,
  DEV_STORE,
  InMemoryBusinessKpiStore,
} = require('../storage/in_memory_business_kpi_store');
const {
  CERTIFICATION_BANK,
} = require('../../../agents/business-kpi/rules/seller_certification_bank');

const NOW = new Date('2026-09-21T10:00:00.000Z');

function fixture() {
  const store = new InMemoryBusinessKpiStore();
  const seller = store.employees.find(
    employee => employee.employeeCode === 'seller-cherednichenko'
  );
  seller.userId = 'learning-seller';
  const service = new SellerTasksService({
    store,
    now: () => new Date(NOW),
    uuid: (() => {
      let i = 1;
      return () => {
        const suffix = String(i++).padStart(12, '0');
        return '99000000-0000-4000-8000-' + suffix;
      };
    })(),
  });
  const actor = {
    id: 'learning-seller',
    role: 'SELLER',
    storeId: DEV_STORE.id,
  };
  return { store, service, actor };
}

function answersFor(moduleCode, correct) {
  return Object.fromEntries(
    CERTIFICATION_BANK
      .filter(question => question.moduleCode === moduleCode)
      .map(question => [
        question.id,
        correct
          ? question.correctIndex
          : (question.correctIndex + 1) % question.options.length,
      ])
  );
}

test('module is completed only after a passing mini quiz', async () => {
  const { service, actor } = fixture();
  const moduleCode = 'KNOW-19';

  const quiz = await service.moduleQuiz(moduleCode, actor);
  assert.equal(quiz.total, 4);
  assert.equal(quiz.passPercent, 75);
  assert.ok(quiz.questions.every(question => question.correctIndex === undefined));

  const failed = await service.submitModuleQuiz(
    moduleCode,
    { answers: answersFor(moduleCode, false) },
    actor
  );
  assert.equal(failed.passed, false);

  let progress = await service.learningProgress(actor);
  assert.equal(
    progress.items.find(item => item.code === moduleCode).completed,
    false
  );

  const passed = await service.submitModuleQuiz(
    moduleCode,
    { answers: answersFor(moduleCode, true) },
    actor
  );
  assert.equal(passed.passed, true);

  progress = await service.learningProgress(actor);
  assert.equal(progress.completed, 1);
  assert.equal(
    progress.items.find(item => item.code === moduleCode).completed,
    true
  );
});

test('final certification unlocks only after all module quizzes pass', async () => {
  const { service, actor } = fixture();

  let certification = await service.certification(actor);
  assert.equal(certification.eligible, false);
  assert.equal(certification.questions.length, 0);

  await assert.rejects(
    () => service.submitCertification({ answers: {} }, actor),
    error => error.code === 'CERTIFICATION_LOCKED'
  );

  const moduleCodes = [...new Set(
    CERTIFICATION_BANK.map(question => question.moduleCode)
  )];
  for (const moduleCode of moduleCodes) {
    await service.submitModuleQuiz(
      moduleCode,
      { answers: answersFor(moduleCode, true) },
      actor
    );
  }

  certification = await service.certification(actor);
  assert.equal(certification.eligible, true);
  assert.equal(certification.modulesCompleted, 25);
  assert.equal(certification.questions.length, 100);
});

test('automatic shift training is idempotent and excludes store-control tasks', async () => {
  const { store, service } = fixture();
  const employee = DEV_EMPLOYEES.find(
    item => item.employeeCode === 'seller-kapitanova'
  );
  const timestamp = NOW.toISOString();
  const shift = await store.createShift({
    id: '98000000-0000-4000-8000-000000000001',
    storeId: DEV_STORE.id,
    employeeId: employee.id,
    employeeName: employee.displayName,
    shiftDate: '2026-09-21',
    shiftKey: 'main',
    cash: 12000,
    acquiring: 18000,
    qr: 3000,
    receipts: 25,
    itemsSold: 60,
    upsellReceipts: 8,
    treatsRevenue: 1500,
    treatsReceipts: 6,
    comment: 'Автотест',
    source: 'web_manual',
    sourceRef: null,
    archivedAt: null,
    archivedBy: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    importRunId: null,
    historicalRevenue: null,
    revenueSource: 'payments',
    paymentBreakdownAvailable: true,
    sourceReference: null,
    originalImportedInput: null,
  });

  const first = await service.autoAssignForShift(shift);
  assert.ok(first.created.length >= 1 && first.created.length <= 2);
  assert.equal(
    first.created.filter(item => item.taskType === 'KNOWLEDGE').length,
    1
  );
  assert.equal(
    first.created.filter(item => item.taskType === 'STORE').length,
    0
  );
  assert.ok(first.created.every(item => item.status === 'APPROVED'));

  const second = await service.autoAssignForShift(shift);
  assert.equal(second.created.length, 0);
});
