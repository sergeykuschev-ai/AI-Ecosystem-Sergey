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

test('unfinished learning and sales tasks carry over to the next worked shift', async () => {
  const { store, service } = fixture();
  const employee = DEV_EMPLOYEES.find(
    item => item.employeeCode === 'seller-kapitanova'
  );
  const library = await store.listLibraryTasks();
  const knowledge = library.find(item => item.code === 'KNOW-19');
  const sales = library.find(item => item.code === 'SALE-02');

  await store.createProposal({
    id: '97000000-0000-4000-8000-000000000001',
    storeId: DEV_STORE.id,
    employeeId: employee.id,
    shiftDate: '2026-09-20',
    libraryTaskId: knowledge.id,
    taskType: knowledge.taskType,
    title: knowledge.title,
    description: knowledge.description,
    expectedResult: knowledge.expectedResult,
    reason: 'Вчерашнее обучение',
    source: 'ARTHUR',
    status: 'APPROVED',
    bitrixText: 'test',
    createdByUserId: null,
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
  });
  await store.createProposal({
    id: '97000000-0000-4000-8000-000000000002',
    storeId: DEV_STORE.id,
    employeeId: employee.id,
    shiftDate: '2026-09-20',
    libraryTaskId: sales.id,
    taskType: sales.taskType,
    title: sales.title,
    description: sales.description,
    expectedResult: sales.expectedResult,
    reason: 'Вчерашняя практика',
    source: 'ARTHUR',
    status: 'NOT_COMPLETED',
    bitrixText: 'test',
    createdByUserId: null,
    createdAt: '2026-09-20T10:01:00.000Z',
    updatedAt: '2026-09-20T10:01:00.000Z',
  });

  const shift = await store.createShift({
    id: '97000000-0000-4000-8000-000000000003',
    storeId: DEV_STORE.id,
    employeeId: employee.id,
    employeeName: employee.displayName,
    shiftDate: '2026-09-21',
    shiftKey: 'carryover',
    cash: 10000,
    acquiring: 10000,
    qr: 1000,
    receipts: 20,
    itemsSold: 40,
    upsellReceipts: 4,
    treatsRevenue: 500,
    treatsReceipts: 3,
    comment: null,
    source: 'web_manual',
    sourceRef: null,
    archivedAt: null,
    archivedBy: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    importRunId: null,
    historicalRevenue: null,
    revenueSource: 'payments',
    paymentBreakdownAvailable: true,
    sourceReference: null,
    originalImportedInput: null,
  });

  const result = await service.autoAssignForShift(shift);
  const learningTask = result.created.find(item => item.taskType === 'KNOWLEDGE');
  const salesTask = result.created.find(item => item.taskType === 'SALES');
  assert.equal(learningTask.libraryCode, 'KNOW-19');
  assert.match(learningTask.reason, /Перенос с предыдущей смены/);
  assert.equal(salesTask.libraryCode, 'SALE-02');
  assert.match(salesTask.reason, /Перенос с предыдущей смены/);
});

test('passed module becomes due for spaced review after 30 days and is auto-assigned', async () => {
  const { store, service } = fixture();
  const employee = DEV_EMPLOYEES.find(
    item => item.employeeCode === 'seller-kapitanova'
  );
  await store.createLearningAttempt({
    id: '96000000-0000-4000-8000-000000000001',
    storeId: DEV_STORE.id,
    employeeId: employee.id,
    score: 4,
    total: 4,
    percent: 100,
    passed: true,
    answers: {},
    attemptType: 'MODULE',
    moduleCode: 'KNOW-19',
    createdAt: '2026-08-20T10:00:00.000Z',
  });

  const shift = await store.createShift({
    id: '96000000-0000-4000-8000-000000000002',
    storeId: DEV_STORE.id,
    employeeId: employee.id,
    employeeName: employee.displayName,
    shiftDate: '2026-09-21',
    shiftKey: 'repeat',
    cash: 12000,
    acquiring: 18000,
    qr: 3000,
    receipts: 25,
    itemsSold: 60,
    upsellReceipts: 8,
    treatsRevenue: 1500,
    treatsReceipts: 6,
    comment: null,
    source: 'web_manual',
    sourceRef: null,
    archivedAt: null,
    archivedBy: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    importRunId: null,
    historicalRevenue: null,
    revenueSource: 'payments',
    paymentBreakdownAvailable: true,
    sourceReference: null,
    originalImportedInput: null,
  });

  const result = await service.autoAssignForShift(shift);
  const review = result.created.find(item => item.taskType === 'KNOWLEDGE');
  assert.equal(review.libraryCode, 'KNOW-19');
  assert.match(review.reason, /Закрепление знаний/);

  const actor = {
    id: employee.userId,
    role: 'SELLER',
    storeId: DEV_STORE.id,
  };
  const progress = await service.learningProgress(actor);
  const module = progress.items.find(item => item.code === 'KNOW-19');
  assert.equal(module.completed, true);
  assert.equal(module.status, 'REVIEW');

  const team = await service.teamLearningOverview(
    { storeId: DEV_STORE.id },
    { id: 'owner', role: 'OWNER', storeId: DEV_STORE.id }
  );
  const row = team.items.find(item => item.employeeId === employee.id);
  assert.equal(row.workingToday, true);
  assert.equal(row.repeatDue[0].code, 'KNOW-19');
  assert.ok(row.todayAssignments.some(item => item.libraryCode === 'KNOW-19'));
});

function syntheticKpiShift(employee, date, idSuffix) {
  return {
    id: '95000000-0000-4000-8000-' + String(idSuffix).padStart(12, '0'),
    storeId: DEV_STORE.id,
    employeeId: employee.id,
    employeeName: employee.displayName,
    shiftDate: date,
    shiftKey: 'effect-' + idSuffix,
    cash: 10000,
    acquiring: 10000,
    qr: 1000,
    receipts: 20,
    itemsSold: 30,
    upsellReceipts: 2,
    treatsRevenue: 500,
    treatsReceipts: 2,
    comment: 'KPI effect test',
    source: 'web_manual',
    sourceRef: null,
    archivedAt: null,
    archivedBy: null,
    createdAt: date + 'T10:00:00.000Z',
    updatedAt: date + 'T10:00:00.000Z',
    importRunId: null,
    historicalRevenue: null,
    revenueSource: 'payments',
    paymentBreakdownAvailable: true,
    sourceReference: null,
    originalImportedInput: null,
  };
}

async function createCompletedSalesExercise(store, employee, code, date, idSuffix) {
  const library = await store.listLibraryTasks();
  const task = library.find(item => item.code === code);
  return store.createProposal({
    id: '94000000-0000-4000-8000-' + String(idSuffix).padStart(12, '0'),
    storeId: DEV_STORE.id,
    employeeId: employee.id,
    shiftDate: date,
    libraryTaskId: task.id,
    taskType: task.taskType,
    title: task.title,
    description: task.description,
    expectedResult: task.expectedResult,
    reason: 'KPI effect test',
    source: 'ARTHUR',
    status: 'COMPLETED',
    bitrixText: 'test',
    createdByUserId: null,
    decidedByUserId: null,
    decidedAt: date + 'T10:00:00.000Z',
    approvedAt: date + 'T10:00:00.000Z',
    resultNote: 'Выполнено',
    resultMarkedByUserId: null,
    resultMarkedAt: date + 'T20:00:00.000Z',
    createdAt: date + 'T10:00:00.000Z',
    updatedAt: date + 'T20:00:00.000Z',
  });
}

test('completed KPI exercise is observed for three later shifts before new sales task', async () => {
  const { store, service } = fixture();
  const employee = DEV_EMPLOYEES.find(
    item => item.employeeCode === 'seller-kapitanova'
  );

  let id = 1;
  for (const date of ['2026-09-16', '2026-09-17', '2026-09-18']) {
    await store.createShift(syntheticKpiShift(employee, date, id++));
  }
  await createCompletedSalesExercise(store, employee, 'SALE-02', '2026-09-19', id++);
  await store.createShift(syntheticKpiShift(employee, '2026-09-20', id++));
  const todayShift = await store.createShift(
    syntheticKpiShift(employee, '2026-09-21', id++)
  );

  const result = await service.autoAssignForShift(todayShift);
  assert.equal(
    result.created.filter(item => item.taskType === 'SALES').length,
    0
  );

  const team = await service.teamLearningOverview(
    { storeId: DEV_STORE.id },
    { id: 'owner', role: 'OWNER', storeId: DEV_STORE.id }
  );
  const row = team.items.find(item => item.employeeId === employee.id);
  assert.equal(row.salesImpact.status, 'OBSERVING');
  assert.equal(row.salesImpact.afterShifts, 2);
  assert.equal(row.salesImpact.remainingShifts, 1);
});

test('after three shifts without KPI improvement system switches to alternate exercise', async () => {
  const { store, service } = fixture();
  const employee = DEV_EMPLOYEES.find(
    item => item.employeeCode === 'seller-kapitanova'
  );

  let id = 101;
  for (const date of ['2026-09-14', '2026-09-15', '2026-09-16']) {
    await store.createShift(syntheticKpiShift(employee, date, id++));
  }
  await createCompletedSalesExercise(store, employee, 'SALE-02', '2026-09-17', id++);
  for (const date of ['2026-09-18', '2026-09-19', '2026-09-20']) {
    await store.createShift(syntheticKpiShift(employee, date, id++));
  }
  const todayShift = await store.createShift(
    syntheticKpiShift(employee, '2026-09-21', id++)
  );

  const result = await service.autoAssignForShift(todayShift);
  const sales = result.created.find(item => item.taskType === 'SALES');
  assert.ok(sales);
  assert.equal(sales.libraryCode, 'SALE-04');
  assert.match(sales.reason, /Предыдущее KPI-упражнение не дало/);

  const team = await service.teamLearningOverview(
    { storeId: DEV_STORE.id },
    { id: 'owner', role: 'OWNER', storeId: DEV_STORE.id }
  );
  const row = team.items.find(item => item.employeeId === employee.id);
  assert.equal(row.salesImpact.status, 'OBSERVING');
  assert.equal(row.salesImpact.libraryCode, 'SALE-04');
  assert.equal(row.salesImpact.afterShifts, 0);
  assert.ok(row.todayAssignments.some(item =>
    item.libraryCode === 'SALE-04' &&
    /Предыдущее KPI-упражнение не дало/.test(item.reason)
  ));
});

test('automatic KPI practice needs no manual completion before effect evaluation', async () => {
  const { store, service } = fixture();
  const employee = DEV_EMPLOYEES.find(
    item => item.employeeCode === 'seller-kapitanova'
  );

  let id = 201;
  for (const date of ['2026-09-14', '2026-09-15', '2026-09-16']) {
    await store.createShift(syntheticKpiShift(employee, date, id++));
  }
  const exercise = await createCompletedSalesExercise(
    store,
    employee,
    'SALE-02',
    '2026-09-17',
    id++
  );
  await store.updateProposal(exercise.id, {
    status: 'APPROVED',
    reason: 'Автоматически на смену. KPI-проблема: средний чек.',
    resultNote: null,
    resultMarkedAt: null,
  });

  for (const date of ['2026-09-18', '2026-09-19', '2026-09-20']) {
    await store.createShift(syntheticKpiShift(employee, date, id++));
  }
  const todayShift = await store.createShift(
    syntheticKpiShift(employee, '2026-09-21', id++)
  );

  const result = await service.autoAssignForShift(todayShift);
  const switched = result.created.find(item => item.taskType === 'SALES');
  assert.ok(switched);
  assert.equal(switched.libraryCode, 'SALE-04');

  const measured = await store.getProposal(exercise.id);
  assert.equal(measured.status, 'COMPLETED');
  assert.match(measured.resultNote, /Автооценка после 3 последующих смен/);
  assert.match(measured.resultNote, /Недостаточного улучшения нет/);
});
