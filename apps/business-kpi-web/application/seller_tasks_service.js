'use strict';

const { ApplicationError } = require('./application_error');
const { PERMISSIONS, hasPermission, requirePermission } = require('./permissions');
const {
  buildSellerPerformance,
  TREND_MODES,
} = require('../../../agents/business-kpi/services/seller_performance_analytics');
const { buildTaskProposals, KPI_TASK_MAP } = require('../../../agents/business-kpi/services/seller_task_planner');
const { StorageConflictError } = require('../storage/storage_errors');
const {
  CERTIFICATION_BANK,
  PASS_PERCENT,
  publicCertificationQuestions,
} = require('../../../agents/business-kpi/rules/seller_certification_bank');
const {
  buildOnboardingProgress,
  buildTodayTrainingRecommendation,
  certificationWeakModules,
} = require('../../../agents/business-kpi/rules/seller_training_path');
const {
  latestMeasurableSalesImpact,
  allMeasurableSalesImpacts,
  findSalesEscalation,
  buildExerciseEffectivenessRanking,
} = require('../../../agents/business-kpi/rules/seller_training_effect');
const {
  enrichTrainingTask,
} = require('../../../agents/business-kpi/rules/seller_training_content');
const {
  loadMinMaxCatalog,
  applyMinMaxToTrainingTask,
  trainingModulePriority,
} = require('./seller_minmax_catalog');

const PROPOSAL_STATUSES = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  COMPLETED: 'COMPLETED',
  NOT_COMPLETED: 'NOT_COMPLETED',
});

const HISTORY_WINDOW_DAYS = 45;
const LIST_DEFAULT_LIMIT = 500;
const MODULE_PASS_PERCENT = 75;
const REPEAT_INTERVAL_DAYS = 30;

/* A planner-eligible seller: active store employee participating in seller KPI
   with a linked portal account. Employees without an account (demo/technical
   placeholders like «Продавец 1») and OWNER-linked records never get
   auto-generated assignments. */
function isEligibleSeller(employee) {
  return employee.active !== false &&
    employee.participatesInSellerKpi !== false &&
    Boolean(employee.userId);
}

function requireString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApplicationError('VALIDATION_ERROR', `${fieldName} обязателен.`, 422);
  }
  return value.trim();
}

function requireDate(value, fieldName) {
  const text = requireString(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new ApplicationError('VALIDATION_ERROR', `${fieldName} должен быть датой YYYY-MM-DD.`, 422);
  }
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new ApplicationError('VALIDATION_ERROR', `${fieldName} содержит несуществующую дату.`, 422);
  }
  return text;
}

function shiftDateText(value) {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Vladivostok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = type => parts.find(item => item.type === type)?.value;
  return part('year') + '-' + part('month') + '-' + part('day');
}

function daysAgoText(todayText, days) {
  const date = new Date(todayText + 'T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function passedModuleCodes(attempts) {
  return new Set(
    (attempts || [])
      .filter(attempt =>
        attempt.attemptType === 'MODULE' &&
        attempt.passed === true &&
        attempt.moduleCode)
      .map(attempt => attempt.moduleCode)
  );
}

function latestPassedModuleAttempts(attempts) {
  const latest = new Map();
  for (const attempt of attempts || []) {
    if (attempt.attemptType !== 'MODULE' || !attempt.passed || !attempt.moduleCode) continue;
    const current = latest.get(attempt.moduleCode);
    if (!current || String(attempt.createdAt).localeCompare(String(current.createdAt)) > 0) {
      latest.set(attempt.moduleCode, attempt);
    }
  }
  return latest;
}

function repeatDueModuleCodes(attempts, todayText, intervalDays = REPEAT_INTERVAL_DAYS) {
  const today = new Date(todayText + 'T00:00:00.000Z');
  return [...latestPassedModuleAttempts(attempts).entries()]
    .map(([code, attempt]) => {
      const passedAt = new Date(String(attempt.createdAt).slice(0, 10) + 'T00:00:00.000Z');
      const ageDays = Math.floor((today - passedAt) / 86400000);
      return { code, ageDays, passedAt: attempt.createdAt };
    })
    .filter(item => item.ageDays >= intervalDays)
    .sort((left, right) => right.ageDays - left.ageDays || left.code.localeCompare(right.code));
}

function unresolvedCarryover(existing, attempts, todayText) {
  const latestPass = latestPassedModuleAttempts(attempts);
  const prior = (existing || [])
    .filter(item =>
      item.shiftDate < todayText &&
      item.status !== PROPOSAL_STATUSES.REJECTED &&
      (item.taskType === 'KNOWLEDGE' || item.taskType === 'SALES'))
    .sort((left, right) =>
      String(right.shiftDate).localeCompare(String(left.shiftDate)) ||
      String(right.createdAt || '').localeCompare(String(left.createdAt || '')));

  const byType = new Map();
  for (const item of prior) {
    if (byType.has(item.taskType)) continue;
    if (item.taskType === 'SALES') {
      const automaticKpiPractice =
        item.status === PROPOSAL_STATUSES.APPROVED &&
        item.source === 'ARTHUR' &&
        item.createdByUserId === null &&
        String(item.reason || '').startsWith('Автоматически на смену.');
      if (automaticKpiPractice) continue;
      if ([PROPOSAL_STATUSES.APPROVED, PROPOSAL_STATUSES.NOT_COMPLETED].includes(item.status)) {
        byType.set(item.taskType, item);
      }
      continue;
    }
    const passed = latestPass.get(item.libraryCode);
    const passedDate = passed ? String(passed.createdAt).slice(0, 10) : null;
    if (!passedDate || item.shiftDate > passedDate) {
      byType.set(item.taskType, item);
    }
  }
  return {
    knowledge: byType.get('KNOWLEDGE') || null,
    sales: byType.get('SALES') || null,
  };
}

function latestCertificationAttempt(attempts) {
  return (attempts || [])
    .filter(attempt => attempt.attemptType === 'CERTIFICATION')
    .sort((left, right) =>
      String(right.createdAt).localeCompare(String(left.createdAt)))[0] || null;
}

function learningProgressFromHistory(library, history, moduleAttempts = [], todayText = null) {
  const byCode = new Map();
  for (const proposal of history) {
    if (proposal.taskType !== 'KNOWLEDGE' || !proposal.libraryCode) continue;
    if (proposal.status === PROPOSAL_STATUSES.REJECTED) continue;
    const current = byCode.get(proposal.libraryCode);
    if (!current || String(proposal.shiftDate).localeCompare(String(current.shiftDate)) >= 0) {
      byCode.set(proposal.libraryCode, proposal);
    }
  }
  const completedCodes = passedModuleCodes(moduleAttempts);
  const repeatDueCodes = new Set(
    todayText ? repeatDueModuleCodes(moduleAttempts, todayText).map(item => item.code) : []
  );
  let completed = 0;
  const items = library.map(task => {
    const latest = byCode.get(task.code);
    const completedByQuiz = completedCodes.has(task.code);
    if (completedByQuiz) completed += 1;
    let status = completedByQuiz ? 'COMPLETED' : 'NOT_STARTED';
    if (completedByQuiz && repeatDueCodes.has(task.code)) status = 'REVIEW';
    else if (!completedByQuiz && latest?.status === PROPOSAL_STATUSES.NOT_COMPLETED) status = 'REVIEW';
    else if (!completedByQuiz && latest &&
      [PROPOSAL_STATUSES.PENDING, PROPOSAL_STATUSES.APPROVED, PROPOSAL_STATUSES.COMPLETED].includes(latest.status)) {
      status = 'ASSIGNED';
    }
    return {
      code: task.code,
      status,
      completed: completedByQuiz,
      shiftDate: latest?.shiftDate || null,
    };
  });
  return {
    total: library.length,
    completed,
    percent: library.length ? Math.round((completed / library.length) * 100) : 0,
    items,
  };
}

function publicModuleQuestions(moduleCode) {
  return CERTIFICATION_BANK
    .filter(question => question.moduleCode === moduleCode)
    .map(({ correctIndex, ...question }) => question);
}

function moduleQuizSummary(attempt) {
  if (!attempt) return null;
  return {
    id: attempt.id,
    moduleCode: attempt.moduleCode,
    score: attempt.score,
    total: attempt.total,
    percent: attempt.percent,
    passed: attempt.passed,
    createdAt: attempt.createdAt,
  };
}

function latestModuleFailures(attempts) {
  const latest = new Map();
  for (const attempt of (attempts || [])
    .filter(item => item.attemptType === 'MODULE' && item.moduleCode)
    .sort((left, right) =>
      String(right.createdAt).localeCompare(String(left.createdAt)))) {
    if (!latest.has(attempt.moduleCode)) latest.set(attempt.moduleCode, attempt);
  }
  return [...latest.values()].filter(attempt => !attempt.passed);
}

function buildSellerPeriodSummary({
  days,
  todayText,
  attempts,
  impacts,
  proposals,
}) {
  const from = daysAgoText(todayText, days - 1);
  const inWindow = value => String(value || '').slice(0, 10) >= from &&
    String(value || '').slice(0, 10) <= todayText;
  const moduleAttempts = (attempts || []).filter(item =>
    item.attemptType === 'MODULE' && inWindow(item.createdAt));
  const passedModules = new Set(
    moduleAttempts.filter(item => item.passed).map(item => item.moduleCode)
  );
  const certificationAttempts = (attempts || []).filter(item =>
    item.attemptType === 'CERTIFICATION' && inWindow(item.createdAt));
  const mature = (impacts || []).filter(item =>
    ['EFFECTIVE', 'NO_IMPROVEMENT'].includes(item.status) &&
    inWindow(item.assignmentDate));
  const deltaValues = mature
    .map(item => item.deltaPercent)
    .filter(Number.isFinite);
  const taskRows = (proposals || []).filter(item => inWindow(item.shiftDate));
  return {
    days,
    from,
    to: todayText,
    modulesPassed: passedModules.size,
    moduleChecks: moduleAttempts.length,
    moduleChecksFailed: moduleAttempts.filter(item => !item.passed).length,
    certifications: certificationAttempts.length,
    certificationsPassed: certificationAttempts.filter(item => item.passed).length,
    salesExercisesEvaluated: mature.length,
    salesExercisesEffective: mature.filter(item => item.status === 'EFFECTIVE').length,
    salesExercisesNoImprovement: mature.filter(item =>
      item.status === 'NO_IMPROVEMENT').length,
    averageKpiDeltaPercent: deltaValues.length
      ? Math.round((deltaValues.reduce((sum, value) => sum + value, 0) /
          deltaValues.length) * 10) / 10
      : null,
    assignments: taskRows.length,
    assignmentsCompleted: taskRows.filter(item =>
      item.status === PROPOSAL_STATUSES.COMPLETED).length,
  };
}

function certificationSummary(attempt) {
  if (!attempt) return null;
  return {
    id: attempt.id,
    score: attempt.score,
    total: attempt.total,
    percent: attempt.percent,
    passed: attempt.passed,
    createdAt: attempt.createdAt,
  };
}

function buildBitrixText(proposal) {
  const lines = [`Задача: ${proposal.title}`, ''];
  if (proposal.materialText) {
    lines.push(proposal.materialText, '');
    if (Array.isArray(proposal.productExamples) && proposal.productExamples.length) {
      lines.push('Актуально по Min/Max «Миски»:');
      proposal.productExamples.slice(0, 5).forEach((example, index) => {
        lines.push((index + 1) + '. ' + example);
      });
      lines.push('');
    }
    if (Array.isArray(proposal.questions) && proposal.questions.length) {
      lines.push('Ответь:');
      proposal.questions.forEach((question, index) => {
        lines.push(`${index + 1}. ${question}`);
      });
      lines.push('');
    }
    lines.push('Время: до 15 минут.');
    return lines.join('\n');
  }
  lines.push(proposal.description, '');
  if (proposal.expectedResult) {
    lines.push(`Ожидаемый результат: ${proposal.expectedResult}`, '');
  }
  lines.push('Результат: написать в задаче Битрикс24, что сделано и какие проблемы обнаружены.');
  return lines.join('\n');
}

class SellerTasksService {
  constructor(options = {}) {
    if (!options.store) {
      throw new Error('SellerTasksService requires a store.');
    }
    this.store = options.store;
    this.now = options.now || (() => new Date());
    this.uuid = options.uuid || (() => require('node:crypto').randomUUID());
    this.minMaxPath = options.minMaxPath ||
      process.env.MISKA_MINMAX_XLSX_PATH ||
      null;
    this.minMaxCatalogLoader = options.minMaxCatalogLoader || loadMinMaxCatalog;
  }

  async currentMinMaxCatalog() {
    if (!this.minMaxPath) return null;
    try {
      return await this.minMaxCatalogLoader(this.minMaxPath);
    } catch (error) {
      console.error('MISKA Min/Max training catalog unavailable', {
        errorMessage: error.message,
      });
      return null;
    }
  }

  async listLibrary(actor) {
    requirePermission(actor, PERMISSIONS.LEARNING_READ);
    const items = await this.store.listLibraryTasks();
    const visible = hasPermission(actor.role, PERMISSIONS.TASKS_READ)
      ? items
      : items.filter(task => task.taskType === 'KNOWLEDGE');
    const todayText = shiftDateText(this.now());
    const minMaxCatalog = await this.currentMinMaxCatalog();
    return {
      minMax: minMaxCatalog ? {
        source: 'MINMAX',
        sourceLabel: 'Min/Max «Миски»',
        totalItems: minMaxCatalog.totalItems,
        fileUpdatedAt: minMaxCatalog.fileUpdatedAt,
      } : null,
      items: visible.map(task =>
        applyMinMaxToTrainingTask(
          enrichTrainingTask(task, todayText),
          minMaxCatalog
        )),
    };
  }

  async learningProgress(actor) {
    requirePermission(actor, PERMISSIONS.LEARNING_READ);
    const library = (await this.store.listLibraryTasks())
      .filter(task => task.taskType === 'KNOWLEDGE');
    const employee = await this.store.getEmployeeByUserId(actor.id);
    if (!employee) {
      const progress = learningProgressFromHistory(library, [], [], shiftDateText(this.now()));
      return {
        employeeId: null,
        ...progress,
        onboarding: buildOnboardingProgress(progress.items, library),
      };
    }
    const [history, attempts] = await Promise.all([
      this.store.listProposals({
        storeId: employee.storeId,
        employeeId: employee.id,
        limit: LIST_DEFAULT_LIMIT,
      }),
      this.store.listLearningAttempts({
        employeeId: employee.id,
        attemptType: 'MODULE',
        limit: 5000,
      }),
    ]);
    const progress = learningProgressFromHistory(library, history, attempts, shiftDateText(this.now()));
    return {
      employeeId: employee.id,
      ...progress,
      onboarding: buildOnboardingProgress(progress.items, library),
    };
  }

  async moduleQuiz(moduleCodeInput, actor) {
    requirePermission(actor, PERMISSIONS.LEARNING_READ);
    const moduleCode = requireString(moduleCodeInput, 'moduleCode').toUpperCase();
    const employee = await this.store.getEmployeeByUserId(actor.id);
    if (!employee || employee.participatesInSellerKpi === false) {
      throw new ApplicationError(
        'SELLER_NOT_LINKED',
        'Проверка модуля доступна только продавцу с привязанным профилем.',
        403
      );
    }
    const library = await this.store.listLibraryTasks();
    const task = library.find(item =>
      item.taskType === 'KNOWLEDGE' && item.code === moduleCode);
    if (!task) {
      throw new ApplicationError('MODULE_NOT_FOUND', 'Учебный модуль не найден.', 404);
    }
    const questions = publicModuleQuestions(moduleCode);
    if (!questions.length) {
      throw new ApplicationError(
        'MODULE_QUIZ_NOT_READY',
        'Для модуля пока нет проверочных вопросов.',
        409
      );
    }
    const attempts = await this.store.listLearningAttempts({
      employeeId: employee.id,
      attemptType: 'MODULE',
      moduleCode,
      limit: 1,
    });
    return {
      moduleCode,
      title: task.title,
      total: questions.length,
      passPercent: MODULE_PASS_PERCENT,
      latestAttempt: moduleQuizSummary(attempts[0]),
      questions,
    };
  }

  async submitModuleQuiz(moduleCodeInput, input, actor) {
    requirePermission(actor, PERMISSIONS.LEARNING_READ);
    const moduleCode = requireString(moduleCodeInput, 'moduleCode').toUpperCase();
    const employee = await this.store.getEmployeeByUserId(actor.id);
    if (!employee || employee.participatesInSellerKpi === false) {
      throw new ApplicationError(
        'SELLER_NOT_LINKED',
        'Проверка модуля доступна только продавцу с привязанным профилем.',
        403
      );
    }
    const questions = CERTIFICATION_BANK.filter(
      question => question.moduleCode === moduleCode
    );
    if (!questions.length) {
      throw new ApplicationError('MODULE_NOT_FOUND', 'Учебный модуль не найден.', 404);
    }
    const answers = input?.answers;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      throw new ApplicationError('VALIDATION_ERROR', 'Ответы проверки обязательны.', 422);
    }
    let score = 0;
    const normalized = {};
    for (const question of questions) {
      const answer = answers[question.id];
      if (!Number.isInteger(answer) || answer < 0 || answer >= question.options.length) {
        throw new ApplicationError(
          'VALIDATION_ERROR',
          'Нужно ответить на все вопросы модуля.',
          422
        );
      }
      normalized[question.id] = answer;
      if (answer === question.correctIndex) score += 1;
    }
    const percent = Math.round((score / questions.length) * 100);
    const now = this.now().toISOString();
    const attempt = await this.store.createLearningAttempt({
      id: this.uuid(),
      storeId: employee.storeId,
      employeeId: employee.id,
      score,
      total: questions.length,
      percent,
      passed: percent >= MODULE_PASS_PERCENT,
      answers: normalized,
      attemptType: 'MODULE',
      moduleCode,
      createdAt: now,
    });

    if (attempt.passed) {
      const proposals = await this.store.listProposals({
        storeId: employee.storeId,
        employeeId: employee.id,
        limit: LIST_DEFAULT_LIMIT,
      });
      const current = proposals
        .filter(proposal =>
          proposal.libraryCode === moduleCode &&
          proposal.status !== PROPOSAL_STATUSES.REJECTED)
        .sort((left, right) =>
          String(right.shiftDate).localeCompare(String(left.shiftDate)))[0];
      if (current && current.status !== PROPOSAL_STATUSES.COMPLETED) {
        await this.store.updateProposal(current.id, {
          status: PROPOSAL_STATUSES.COMPLETED,
          resultNote: 'Модуль пройден через мини-проверку: ' + score + '/' + questions.length + '.',
          resultMarkedAt: now,
        });
      }
    }
    return moduleQuizSummary(attempt);
  }

  async certification(actor) {
    requirePermission(actor, PERMISSIONS.LEARNING_READ);
    const employee = await this.store.getEmployeeByUserId(actor.id);
    if (!employee) {
      return {
        title: 'Итоговая аттестация продавца «Миски»',
        total: CERTIFICATION_BANK.length,
        passPercent: PASS_PERCENT,
        employeeId: null,
        eligible: false,
        modulesCompleted: 0,
        modulesTotal: 25,
        latestAttempt: null,
        questions: [],
      };
    }
    const [library, history, attempts] = await Promise.all([
      this.store.listLibraryTasks(),
      this.store.listProposals({
        storeId: employee.storeId,
        employeeId: employee.id,
        limit: LIST_DEFAULT_LIMIT,
      }),
      this.store.listLearningAttempts({ employeeId: employee.id, limit: 5000 }),
    ]);
    const knowledge = library.filter(task => task.taskType === 'KNOWLEDGE');
    const moduleAttempts = attempts.filter(attempt => attempt.attemptType === 'MODULE');
    const progress = learningProgressFromHistory(knowledge, history, moduleAttempts);
    const eligible = progress.total > 0 && progress.completed === progress.total;
    const latestAttempt = latestCertificationAttempt(attempts);
    return {
      title: 'Итоговая аттестация продавца «Миски»',
      total: CERTIFICATION_BANK.length,
      passPercent: PASS_PERCENT,
      employeeId: employee.id,
      eligible,
      modulesCompleted: progress.completed,
      modulesTotal: progress.total,
      latestAttempt: certificationSummary(latestAttempt),
      questions: eligible ? publicCertificationQuestions() : [],
    };
  }

  async submitCertification(input, actor) {
    requirePermission(actor, PERMISSIONS.LEARNING_READ);
    const employee = await this.store.getEmployeeByUserId(actor.id);
    if (!employee || employee.participatesInSellerKpi === false) {
      throw new ApplicationError(
        'SELLER_NOT_LINKED',
        'Аттестация доступна только продавцу с привязанным профилем.',
        403
      );
    }
    const [library, moduleAttempts] = await Promise.all([
      this.store.listLibraryTasks(),
      this.store.listLearningAttempts({
        employeeId: employee.id,
        attemptType: 'MODULE',
        limit: 5000,
      }),
    ]);
    const knowledge = library.filter(task => task.taskType === 'KNOWLEDGE');
    const passed = passedModuleCodes(moduleAttempts);
    if (knowledge.some(task => !passed.has(task.code))) {
      throw new ApplicationError(
        'CERTIFICATION_LOCKED',
        'Сначала нужно успешно пройти проверки всех 25 учебных модулей.',
        409
      );
    }
    const answers = input?.answers;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      throw new ApplicationError('VALIDATION_ERROR', 'Ответы аттестации обязательны.', 422);
    }
    let score = 0;
    const normalized = {};
    for (const question of CERTIFICATION_BANK) {
      const answer = answers[question.id];
      if (!Number.isInteger(answer) || answer < 0 || answer >= question.options.length) {
        throw new ApplicationError(
          'VALIDATION_ERROR',
          'Нужно ответить на все ' + CERTIFICATION_BANK.length + ' вопросов.',
          422
        );
      }
      normalized[question.id] = answer;
      if (answer === question.correctIndex) score += 1;
    }
    const percent = Math.round((score / CERTIFICATION_BANK.length) * 100);
    const now = this.now().toISOString();
    const attempt = await this.store.createLearningAttempt({
      id: this.uuid(),
      storeId: employee.storeId,
      employeeId: employee.id,
      score,
      total: CERTIFICATION_BANK.length,
      percent,
      passed: percent >= PASS_PERCENT,
      answers: normalized,
      attemptType: 'CERTIFICATION',
      moduleCode: null,
      createdAt: now,
    });
    return certificationSummary(attempt);
  }

  async teamLearningOverview(input, actor) {
    requirePermission(actor, PERMISSIONS.TASKS_READ);
    const storeId = requireString(input.storeId || actor.storeId, 'storeId');
    const todayText = shiftDateText(this.now());
    const year = Number(todayText.slice(0, 4));
    const month = Number(todayText.slice(5, 7));
    const windowStartTotal = year * 12 + (month - 1) - 3;
    const windowStartYear = Math.floor(windowStartTotal / 12);
    const windowStartMonth = (windowStartTotal % 12) + 1;
    const windowStartDate = windowStartYear + '-' + String(windowStartMonth).padStart(2, '0') + '-01';
    const windowEndDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

    const [employees, library, history, attempts, settingsRecord, shifts] = await Promise.all([
      this.store.listEmployees({ storeId }),
      this.store.listLibraryTasks(),
      this.store.listProposals({ storeId, limit: 5000 }),
      this.store.listLearningAttempts({storeId, limit: 5000 }),
      this.store.getEffectiveSettings(storeId, todayText),
      this.store.listShifts({
        storeId,
        dateFrom: windowStartDate,
        dateTo: windowEndDate,
      }),
    ]);
    const knowledge = library.filter(task => task.taskType === 'KNOWLEDGE');
    const sellers = employees.filter(isEligibleSeller);
    const performance = buildSellerPerformance({
      shifts,
      employees: sellers,
      settings: settingsRecord?.settings || null,
      year,
      month,
      mode: TREND_MODES.SHIFTS,
    });
    const performanceByEmployee = new Map(
      performance.items.map(item => [item.employeeId, item])
    );
    const exerciseRanking = buildExerciseEffectivenessRanking({
      proposals: history,
      shifts,
      settings: settingsRecord?.settings || null,
      targets: settingsRecord?.settings?.targets || null,
    });
    const teamItems = sellers.map(employee => {
        const employeeAttempts = attempts.filter(item => item.employeeId === employee.id);
        const employeeHistory = history.filter(item => item.employeeId === employee.id);
        const moduleAttempts = employeeAttempts.filter(item => item.attemptType === 'MODULE');
        const progress = learningProgressFromHistory(
          knowledge,
          employeeHistory,
          moduleAttempts,
          todayText
        );
        const onboarding = buildOnboardingProgress(progress.items, knowledge);
        const latestAttempt = latestCertificationAttempt(employeeAttempts);
        const weakModules = certificationWeakModules(
          latestAttempt,
          CERTIFICATION_BANK,
          knowledge
        );
        const performanceItem = performanceByEmployee.get(employee.id) || null;
        const salesImpact = latestMeasurableSalesImpact({
          proposals: employeeHistory,
          shifts,
          settings: settingsRecord?.settings || null,
          targets: settingsRecord?.settings?.targets || null,
        });
        const salesImpacts = allMeasurableSalesImpacts({
          proposals: employeeHistory,
          shifts,
          settings: settingsRecord?.settings || null,
          targets: settingsRecord?.settings?.targets || null,
        });
        const salesEscalation = findSalesEscalation({
          proposals: employeeHistory,
          shifts,
          settings: settingsRecord?.settings || null,
          targets: settingsRecord?.settings?.targets || null,
        });
        const moduleFailures = latestModuleFailures(employeeAttempts);
        const carryover = unresolvedCarryover(employeeHistory, moduleAttempts, todayText);
        const repeatDue = repeatDueModuleCodes(moduleAttempts, todayText);
        const todayAssignments = employeeHistory
          .filter(item =>
            item.shiftDate === todayText &&
            item.status !== PROPOSAL_STATUSES.REJECTED &&
            (item.taskType === 'KNOWLEDGE' || item.taskType === 'SALES'))
          .map(item => ({
            id: item.id,
            taskType: item.taskType,
            title: item.title,
            status: item.status,
            libraryCode: item.libraryCode,
            reason: item.reason || null,
          }));
        const exceptions = [];
        if (salesEscalation) {
          exceptions.push({
            level: 'CRITICAL',
            kind: 'SALES_ESCALATION',
            title: salesEscalation.metricLabel + ': нужен разбор',
            detail: salesEscalation.reason,
          });
        }
        if (latestAttempt?.passed === false) {
          exceptions.push({
            level: 'HIGH',
            kind: 'CERTIFICATION_FAILED',
            title: 'Аттестация не сдана',
            detail: 'Последний результат: ' + latestAttempt.percent + '%.',
          });
        }
        if (moduleFailures.length) {
          exceptions.push({
            level: 'MEDIUM',
            kind: 'MODULE_CHECK_FAILED',
            title: 'Есть непройденные мини-проверки',
            detail: 'Тем с последней неудачной попыткой: ' + moduleFailures.length + '.',
          });
        }
        if (carryover.knowledge || carryover.sales) {
          exceptions.push({
            level: 'MEDIUM',
            kind: 'CARRYOVER',
            title: 'Есть перенос с прошлой смены',
            detail: 'Незакрытые задания получили приоритет.',
          });
        }

        let recommendation = buildTodayTrainingRecommendation({
          onboarding,
          latestAttempt,
          weakModules,
          performanceItem,
          targets: settingsRecord?.settings?.targets || null,
          library,
        });
        if (salesEscalation) {
          recommendation = {
            kind: 'OWNER_REVIEW',
            title: salesEscalation.metricLabel + ': нужен разбор',
            reason: salesEscalation.reason,
          };
        } else if (carryover.knowledge || carryover.sales) {
          const firstCarry = carryover.knowledge || carryover.sales;
          recommendation = {
            kind: 'CARRYOVER',
            title: firstCarry.title,
            reason: 'Невыполненное задание с предыдущей смены имеет приоритет.',
          };
        } else if (repeatDue.length) {
          const repeatTask = knowledge.find(item => item.code === repeatDue[0].code);
          recommendation = {
            kind: 'SPACED_REVIEW',
            title: repeatTask?.title || repeatDue[0].code,
            moduleCode: repeatDue[0].code,
            reason: 'Прошло ' + repeatDue[0].ageDays +
              ' дн. после успешной проверки — пора закрепить знания.',
          };
        }
        return {
          employeeId: employee.id,
          displayName: employee.displayName,
          modulesCompleted: progress.completed,
          modulesTotal: progress.total,
          learningPercent: progress.percent,
          onboarding,
          latestAttempt: certificationSummary(latestAttempt),
          weakModules: weakModules.slice(0, 3),
          repeatDue: repeatDue.slice(0, 3),
          carryover: {
            knowledge: carryover.knowledge ? {
              title: carryover.knowledge.title,
              libraryCode: carryover.knowledge.libraryCode,
              shiftDate: carryover.knowledge.shiftDate,
              status: carryover.knowledge.status,
            } : null,
            sales: carryover.sales ? {
              title: carryover.sales.title,
              libraryCode: carryover.sales.libraryCode,
              shiftDate: carryover.sales.shiftDate,
              status: carryover.sales.status,
            } : null,
          },
          workingToday: shifts.some(shift =>
            shift.employeeId === employee.id && shift.shiftDate === todayText),
          todayAssignments,
          salesImpact,
          salesEscalation,
          latestModuleFailures: moduleFailures.slice(0, 3).map(item => ({
            moduleCode: item.moduleCode,
            percent: item.percent,
            createdAt: item.createdAt,
          })),
          summaries: {
            days7: buildSellerPeriodSummary({
              days: 7,
              todayText,
              attempts: employeeAttempts,
              impacts: salesImpacts,
              proposals: employeeHistory,
            }),
            days30: buildSellerPeriodSummary({
              days: 30,
              todayText,
              attempts: employeeAttempts,
              impacts: salesImpacts,
              proposals: employeeHistory,
            }),
          },
          exceptions,
          recommendation,
        };
      });
    return {
      storeId,
      asOfDate: todayText,
      passPercent: PASS_PERCENT,
      totalModules: knowledge.length,
      certificationQuestions: CERTIFICATION_BANK.length,
      exerciseRanking,
      exceptionCount: teamItems.reduce((sum, item) => sum + item.exceptions.length, 0),
      items: teamItems,
    };
  }

  async autoAssignForShift(shift) {
    if (!shift?.storeId || !shift?.employeeId || !shift?.shiftDate) {
      return { created: [], skipped: 'INVALID_SHIFT' };
    }
    const shiftDate = shiftDateText(shift.shiftDate);
    const todayText = shiftDateText(this.now());
    if (shiftDate !== todayText) {
      return { created: [], skipped: 'NOT_TODAY' };
    }

    const [storeRecord, employee] = await Promise.all([
      this.store.getStore(shift.storeId),
      this.store.getEmployee(shift.employeeId),
    ]);
    if (storeRecord?.code !== 'miska' || !isEligibleSeller(employee)) {
      return { created: [], skipped: 'NOT_ELIGIBLE' };
    }

    const year = Number(shiftDate.slice(0, 4));
    const month = Number(shiftDate.slice(5, 7));
    const windowStartTotal = year * 12 + (month - 1) - 3;
    const windowStartYear = Math.floor(windowStartTotal / 12);
    const windowStartMonth = (windowStartTotal % 12) + 1;
    const windowStartDate = windowStartYear + '-' +
      String(windowStartMonth).padStart(2, '0') + '-01';
    const windowEndDate = new Date(Date.UTC(year, month, 0))
      .toISOString().slice(0, 10);

    const [settingsRecord, library, existing, shifts, attempts, minMaxCatalog] = await Promise.all([
      this.store.getEffectiveSettings(shift.storeId, shiftDate),
      this.store.listLibraryTasks(),
      this.store.listProposals({
        storeId: shift.storeId,
        employeeId: employee.id,
        dateFrom: shiftDateText(new Date(
          this.now().getTime() - HISTORY_WINDOW_DAYS * 86400000
        )),
        limit: LIST_DEFAULT_LIMIT,
      }),
      this.store.listShifts({
        storeId: shift.storeId,
        dateFrom: windowStartDate,
        dateTo: windowEndDate,
      }),
      this.store.listLearningAttempts({
        storeId: shift.storeId,
        employeeId: employee.id,
        limit: 5000,
      }),
      this.currentMinMaxCatalog(),
    ]);

    const performance = buildSellerPerformance({
      shifts,
      employees: [employee],
      settings: settingsRecord?.settings || null,
      year,
      month,
      mode: TREND_MODES.SHIFTS,
    });
    const historyEntries = existing.map(proposal => ({
      employeeId: proposal.employeeId,
      shiftDate: proposal.shiftDate,
      libraryCode: proposal.libraryCode,
      status: proposal.status,
      source: proposal.source,
    }));
    for (const code of passedModuleCodes(attempts)) {
      historyEntries.push({
        employeeId: employee.id,
        shiftDate: '2000-01-01',
        libraryCode: code,
        status: PROPOSAL_STATUSES.COMPLETED,
        source: 'QUIZ',
      });
    }

    const knowledge = library.filter(task => task.taskType === 'KNOWLEDGE');
    const latestAttempt = latestCertificationAttempt(attempts);
    const weakModules = certificationWeakModules(
      latestAttempt,
      CERTIFICATION_BANK,
      knowledge
    );
    const carryover = unresolvedCarryover(existing, attempts, todayText);
    const repeatDue = repeatDueModuleCodes(attempts, todayText);
    const salesImpact = latestMeasurableSalesImpact({
      proposals: existing,
      shifts,
      settings: settingsRecord?.settings || null,
      targets: settingsRecord?.settings?.targets || null,
    });
    const salesEscalation = findSalesEscalation({
      proposals: existing,
      shifts,
      settings: settingsRecord?.settings || null,
      targets: settingsRecord?.settings?.targets || null,
    });
    if (salesImpact &&
        ['EFFECTIVE', 'NO_IMPROVEMENT'].includes(salesImpact.status)) {
      const measured = existing.find(item => item.id === salesImpact.proposalId);
      if (measured?.status === PROPOSAL_STATUSES.APPROVED) {
        const effectText = salesImpact.status === 'EFFECTIVE'
          ? 'Есть эффект'
          : 'Недостаточного улучшения нет';
        const deltaText = Number.isFinite(salesImpact.deltaPercent)
          ? (salesImpact.deltaPercent > 0 ? '+' : '') +
            salesImpact.deltaPercent + '%'
          : 'н/д';
        await this.store.updateProposal(measured.id, {
          status: PROPOSAL_STATUSES.COMPLETED,
          resultNote:
            'Автооценка после ' + salesImpact.windowShifts +
            ' последующих смен. ' + effectText + ': ' +
            salesImpact.metricLabel + ' ' +
            salesImpact.baseline + ' → ' + salesImpact.after +
            ' (' + deltaText + ').',
          resultMarkedAt: this.now().toISOString(),
        });
      }
    }
    const knowledgePriority = [
      ...(carryover.knowledge?.libraryCode ? [carryover.knowledge.libraryCode] : []),
      ...weakModules.map(item => item.code),
      ...repeatDue.map(item => item.code),
    ];
    const assortmentPriority = trainingModulePriority(minMaxCatalog);
    const assortmentPriorityCodes = assortmentPriority.map(item => item.moduleCode);
    const alternateSalesCodes = salesImpact?.status === 'NO_IMPROVEMENT'
      ? (KPI_TASK_MAP[salesImpact.metricKey] || [])
        .filter(code => code !== salesImpact.libraryCode)
      : [];
    let proposals = buildTaskProposals({
      sellers: [employee],
      targets: settingsRecord?.settings?.targets || null,
      performanceItems: performance.items,
      historyEntries,
      shiftDate,
      today: todayText,
      library,
      knowledgePriorityByEmployee: {
        [employee.id]: knowledgePriority,
      },
      knowledgeRotationPriorityByEmployee: {
        [employee.id]: assortmentPriorityCodes,
      },
      salesPriorityByEmployee: {
        [employee.id]: alternateSalesCodes,
      },
    }).filter(proposal =>
      proposal.taskType === 'KNOWLEDGE' || proposal.taskType === 'SALES');

    if (salesImpact?.status === 'OBSERVING' || salesEscalation) {
      proposals = proposals.filter(proposal => proposal.taskType !== 'SALES');
    }

    const libraryByCodeForPriority = new Map(library.map(task => [task.code, task]));
    if (carryover.sales?.libraryCode) {
      const carryTask = libraryByCodeForPriority.get(carryover.sales.libraryCode);
      if (carryTask) {
        proposals = proposals.filter(proposal => proposal.taskType !== 'SALES');
        proposals.unshift({
          employeeId: employee.id,
          employeeName: employee.displayName,
          libraryCode: carryTask.code,
          taskType: 'SALES',
          shiftDate,
          reason: 'Перенос с предыдущей смены: задание не было выполнено.',
        });
      }
    }
    proposals = proposals.map(proposal => {
      if (carryover.knowledge?.libraryCode === proposal.libraryCode) {
        return {
          ...proposal,
          reason: 'Перенос с предыдущей смены: учебная тема не закрыта мини-проверкой.',
        };
      }
      if (repeatDue.some(item => item.code === proposal.libraryCode) &&
          !weakModules.some(item => item.code === proposal.libraryCode)) {
        const due = repeatDue.find(item => item.code === proposal.libraryCode);
        return {
          ...proposal,
          reason: 'Закрепление знаний: прошло ' + due.ageDays +
            ' дн. после успешной мини-проверки.',
        };
      }
      const assortmentRow = assortmentPriority.find(
        item => item.moduleCode === proposal.libraryCode
      );
      if (proposal.taskType === 'KNOWLEDGE' &&
          assortmentRow &&
          !carryover.knowledge &&
          !weakModules.some(item => item.code === proposal.libraryCode) &&
          !repeatDue.some(item => item.code === proposal.libraryCode)) {
        return {
          ...proposal,
          reason:
            'Приоритет Min/Max: в теме сейчас ' +
            assortmentRow.inStockItems + ' поз. в наличии, ' +
            assortmentRow.highPriorityItems + ' поз. ABC A/B, ' +
            assortmentRow.incomingItems + ' поз. в пути/заказе.',
        };
      }
      return proposal;
    });

    const todayAssignments = existing.filter(proposal =>
      proposal.shiftDate === shiftDate &&
      proposal.status !== PROPOSAL_STATUSES.REJECTED);
    const occupiedTypes = new Set(
      todayAssignments
        .filter(proposal =>
          proposal.taskType === 'KNOWLEDGE' || proposal.taskType === 'SALES')
        .map(proposal => proposal.taskType)
    );
    const existingKeys = new Set(
      todayAssignments.map(proposal =>
        proposal.employeeId + '|' + proposal.shiftDate + '|' + proposal.libraryCode)
    );
    const libraryByCode = new Map(library.map(task => [task.code, task]));
    const created = [];

    for (const proposal of proposals) {
      if (occupiedTypes.has(proposal.taskType)) continue;
      const task = libraryByCode.get(proposal.libraryCode);
      if (!task) continue;
      const assignmentTask = proposal.taskType === 'KNOWLEDGE'
        ? applyMinMaxToTrainingTask(
          enrichTrainingTask(task, todayText),
          minMaxCatalog
        )
        : task;
      const key = proposal.employeeId + '|' + proposal.shiftDate + '|' + proposal.libraryCode;
      if (existingKeys.has(key)) continue;
      const timestamp = this.now().toISOString();
      try {
        const bitrixText = buildBitrixText({
          title: assignmentTask.title,
          description: assignmentTask.description,
          expectedResult: assignmentTask.expectedResult,
          materialText: assignmentTask.materialText,
          questions: assignmentTask.questions,
          productExamples: assignmentTask.productExamples,
        });
        const record = await this.store.createProposal({
          id: this.uuid(),
          storeId: shift.storeId,
          employeeId: employee.id,
          shiftDate,
          libraryTaskId: task.id,
          taskType: task.taskType,
          title: task.title,
          description: task.description,
          expectedResult: task.expectedResult,
          reason: 'Автоматически на смену. ' + proposal.reason,
          source: 'ARTHUR',
          status: PROPOSAL_STATUSES.APPROVED,
          bitrixText,
          createdByUserId: null,
          decidedByUserId: null,
          decidedAt: timestamp,
          approvedAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        created.push(record);
        occupiedTypes.add(proposal.taskType);
        existingKeys.add(key);
      } catch (error) {
        if (!(error instanceof StorageConflictError)) throw error;
      }
    }
    return {
      created,
      sellerId: employee.id,
      shiftDate,
    };
  }

  async generateProposals(input, actor) {
    requirePermission(actor, PERMISSIONS.TASKS_MANAGE);
    const storeId = requireString(input.storeId, 'storeId');
    const shiftDate = requireDate(input.shiftDate, 'shiftDate');
    const todayText = shiftDateText(this.now());

    const storeRecord = await this.store.getStore(storeId);
    if (!storeRecord?.active) {
      throw new ApplicationError('STORE_NOT_FOUND', 'Магазин не найден.', 404);
    }

    const shiftYear = Number(shiftDate.slice(0, 4));
    const shiftMonth = Number(shiftDate.slice(5, 7));
    const windowStartTotal = shiftYear * 12 + (shiftMonth - 1) - 3;
    const windowStartYear = Math.floor(windowStartTotal / 12);
    const windowStartMonth = (windowStartTotal % 12) + 1;
    const windowStartDate = `${windowStartYear}-${String(windowStartMonth).padStart(2, '0')}-01`;
    const windowEndDate = new Date(Date.UTC(shiftYear, shiftMonth, 0)).toISOString().slice(0, 10);

    const [employees, settingsRecord, library, existing, shifts, dayShifts, attempts] = await Promise.all([
      this.store.listEmployees({ storeId }),
      this.store.getEffectiveSettings(storeId, shiftDate),
      this.store.listLibraryTasks(),
      this.store.listProposals({
        storeId,
        dateFrom: shiftDateText(new Date(this.now().getTime() - HISTORY_WINDOW_DAYS * 86400000)),
        limit: LIST_DEFAULT_LIMIT,
      }),
      this.store.listShifts({
        storeId,
        dateFrom: windowStartDate,
        dateTo: windowEndDate,
      }),
      this.store.listShifts({
        storeId,
        dateFrom: shiftDate,
        dateTo: shiftDate,
      }),
      this.store.listLearningAttempts({ storeId, limit: 5000 }),
    ]);
    const assignedEmployees = new Set(
      existing
        .filter(proposal =>
          proposal.status !== PROPOSAL_STATUSES.REJECTED && proposal.shiftDate === shiftDate)
        .map(proposal => proposal.employeeId)
    );
    const eligibleSellers = employees.filter(isEligibleSeller);

    /* Resolve exactly who works the chosen shift. Planner must never guess:
       either the store's shift data names the seller, or the owner picks one
       explicitly. No «every active employee» fallback. */
    let sellers;
    let sellerSource;
    if (input.employeeId) {
      const picked = eligibleSellers.find(employee => employee.id === input.employeeId);
      if (!picked) {
        throw new ApplicationError('EMPLOYEE_NOT_FOUND', 'Продавец не найден.', 404);
      }
      sellers = [picked];
      sellerSource = 'MANUAL';
    } else {
      const shiftEmployeeIds = new Set(dayShifts.map(shift => shift.employeeId));
      sellers = eligibleSellers.filter(employee => shiftEmployeeIds.has(employee.id));
      sellerSource = 'SHIFT';
    }
    if (!sellers.length) {
      return {
        sellerResolved: false,
        sellerSource: 'NONE',
        eligibleSellers: eligibleSellers.map(employee => ({
          id: employee.id,
          displayName: employee.displayName,
        })),
        created: [],
        skippedDuplicates: [],
      };
    }
    sellers = sellers.filter(employee => !assignedEmployees.has(employee.id));

    const performance = buildSellerPerformance({
      shifts,
      employees: sellers,
      settings: settingsRecord?.settings || null,
      year: shiftYear,
      month: shiftMonth,
      mode: TREND_MODES.SHIFTS,
    });

    const historyEntries = existing.map(proposal => ({
      employeeId: proposal.employeeId,
      shiftDate: proposal.shiftDate,
      libraryCode: proposal.libraryCode,
      status: proposal.status,
      source: proposal.source,
    }));
    for (const employee of sellers) {
      const completedByQuiz = passedModuleCodes(
        attempts.filter(item => item.employeeId === employee.id)
      );
      for (const code of completedByQuiz) {
        historyEntries.push({
          employeeId: employee.id,
          shiftDate: '2000-01-01',
          libraryCode: code,
          status: PROPOSAL_STATUSES.COMPLETED,
          source: 'QUIZ',
        });
      }
    }

    const knowledge = library.filter(task => task.taskType === 'KNOWLEDGE');
    const knowledgePriorityByEmployee = Object.fromEntries(
      sellers.map(employee => {
        const latestAttempt = latestCertificationAttempt(
          attempts.filter(item => item.employeeId === employee.id)
        );
        const weakModules = certificationWeakModules(
          latestAttempt,
          CERTIFICATION_BANK,
          knowledge
        );
        return [employee.id, weakModules.map(item => item.code)];
      })
    );

    const proposals = buildTaskProposals({
      sellers,
      targets: settingsRecord?.settings?.targets || null,
      performanceItems: performance.items,
      historyEntries,
      shiftDate,
      today: todayText,
      library,
      knowledgePriorityByEmployee,
    });

    const existingKeys = new Set(
      existing
        .filter(proposal => proposal.status !== PROPOSAL_STATUSES.REJECTED)
        .map(proposal => `${proposal.employeeId}|${proposal.shiftDate}|${proposal.libraryCode}`)
    );
    const libraryByCode = new Map(library.map(task => [task.code, task]));
    const created = [];
    const skipped = [];
    for (const proposal of proposals) {
      const task = libraryByCode.get(proposal.libraryCode);
      if (!task) continue;
      if (existingKeys.has(`${proposal.employeeId}|${proposal.shiftDate}|${proposal.libraryCode}`)) {
        skipped.push(proposal.libraryCode);
        continue;
      }
      const timestamp = this.now().toISOString();
      try {
        const record = await this.store.createProposal({
          id: this.uuid(),
          storeId,
          employeeId: proposal.employeeId,
          shiftDate: proposal.shiftDate,
          libraryTaskId: task.id,
          taskType: task.taskType,
          title: task.title,
          description: task.description,
          expectedResult: task.expectedResult,
          reason: proposal.reason,
          source: 'ARTHUR',
          status: PROPOSAL_STATUSES.PENDING,
          bitrixText: null,
          createdByUserId: actor.id,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        existingKeys.add(`${proposal.employeeId}|${proposal.shiftDate}|${proposal.libraryCode}`);
        created.push(record);
      } catch (error) {
        if (error instanceof StorageConflictError) {
          skipped.push(proposal.libraryCode);
          continue;
        }
        throw error;
      }
    }
    return {
      sellerResolved: true,
      sellerSource,
      sellers: sellers.map(employee => ({ id: employee.id, displayName: employee.displayName })),
      created,
      skippedDuplicates: skipped,
    };
  }

  /* Read-only seller resolution for the portal picker: who works the given
     date according to shift data, plus the full eligible seller list the
     owner can choose from. Never creates anything. */
  async resolveShiftSeller(input, actor) {
    requirePermission(actor, PERMISSIONS.TASKS_READ);
    const storeId = requireString(input.storeId, 'storeId');
    const shiftDate = requireDate(input.shiftDate, 'shiftDate');

    const storeRecord = await this.store.getStore(storeId);
    if (!storeRecord?.active) {
      throw new ApplicationError('STORE_NOT_FOUND', 'Магазин не найден.', 404);
    }
    const [employees, dayShifts] = await Promise.all([
      this.store.listEmployees({ storeId }),
      this.store.listShifts({ storeId, dateFrom: shiftDate, dateTo: shiftDate }),
    ]);
    const eligibleSellers = employees.filter(isEligibleSeller);
    const shiftEmployeeIds = new Set(dayShifts.map(shift => shift.employeeId));
    const shiftSellers = eligibleSellers.filter(employee => shiftEmployeeIds.has(employee.id));
    return {
      resolved: shiftSellers.length > 0,
      sellerSource: shiftSellers.length ? 'SHIFT' : 'NONE',
      seller: shiftSellers.length
        ? { id: shiftSellers[0].id, displayName: shiftSellers[0].displayName }
        : null,
      eligibleSellers: eligibleSellers.map(employee => ({
        id: employee.id,
        displayName: employee.displayName,
      })),
    };
  }

  async listProposals(filters, actor) {
    requirePermission(actor, PERMISSIONS.TASKS_READ);
    const items = await this.store.listProposals({
      storeId: filters.storeId || undefined,
      status: filters.status || undefined,
      employeeId: filters.employeeId || undefined,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      limit: LIST_DEFAULT_LIMIT,
    });
    return { items };
  }

  async listHistory(filters, actor) {
    requirePermission(actor, PERMISSIONS.TASKS_READ);
    const items = await this.store.listProposals({
      storeId: filters.storeId || undefined,
      employeeId: filters.employeeId || undefined,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      limit: LIST_DEFAULT_LIMIT,
    });
    return { items };
  }

  async _getProposalOrThrow(id) {
    const proposal = await this.store.getProposal(id);
    if (!proposal) {
      throw new ApplicationError('TASK_NOT_FOUND', 'Задание не найдено.', 404);
    }
    return proposal;
  }

  async approve(id, actor, patch = {}) {
    requirePermission(actor, PERMISSIONS.TASKS_MANAGE);
    const proposal = await this._getProposalOrThrow(id);
    if (proposal.status !== PROPOSAL_STATUSES.PENDING) {
      throw new ApplicationError(
        'INVALID_TASK_STATUS',
        `Утвердить можно только предложение в статусе PENDING (текущий: ${proposal.status}).`,
        409
      );
    }
    const updated = {
      title: patch.title !== undefined ? requireString(patch.title, 'title') : proposal.title,
      description: patch.description !== undefined
        ? requireString(patch.description, 'description')
        : proposal.description,
      expectedResult: patch.expectedResult !== undefined
        ? (patch.expectedResult === null ? null : String(patch.expectedResult).trim())
        : proposal.expectedResult,
    };
    const decidedAt = this.now().toISOString();
    return this.store.updateProposal(id, {
      ...updated,
      status: PROPOSAL_STATUSES.APPROVED,
      bitrixText: buildBitrixText({ ...proposal, ...updated, materialText: proposal.materialText, questions: proposal.questions }),
      decidedByUserId: actor.id,
      decidedAt,
      approvedAt: decidedAt,
    });
  }

  async reject(id, actor) {
    requirePermission(actor, PERMISSIONS.TASKS_MANAGE);
    const proposal = await this._getProposalOrThrow(id);
    if (proposal.status !== PROPOSAL_STATUSES.PENDING) {
      throw new ApplicationError(
        'INVALID_TASK_STATUS',
        `Отклонить можно только предложение в статусе PENDING (текущий: ${proposal.status}).`,
        409
      );
    }
    return this.store.updateProposal(id, {
      status: PROPOSAL_STATUSES.REJECTED,
      decidedByUserId: actor.id,
      decidedAt: this.now().toISOString(),
    });
  }

  async markResult(id, result, note, actor) {
    requirePermission(actor, PERMISSIONS.TASKS_MANAGE);
    const status = result === 'COMPLETED'
      ? PROPOSAL_STATUSES.COMPLETED
      : PROPOSAL_STATUSES.NOT_COMPLETED;
    const proposal = await this._getProposalOrThrow(id);
    if (proposal.status !== PROPOSAL_STATUSES.APPROVED) {
      throw new ApplicationError(
        'INVALID_TASK_STATUS',
        `Отметить результат можно только для утверждённого задания (текущий статус: ${proposal.status}).`,
        409
      );
    }
    return this.store.updateProposal(id, {
      status,
      resultNote: note === null || note === undefined ? null : String(note).trim() || null,
      resultMarkedByUserId: actor.id,
      resultMarkedAt: this.now().toISOString(),
    });
  }

  async assignManual(input, actor) {
    requirePermission(actor, PERMISSIONS.TASKS_MANAGE);
    const storeId = requireString(input.storeId, 'storeId');
    const employeeId = requireString(input.employeeId, 'employeeId');
    const shiftDate = requireDate(input.shiftDate, 'shiftDate');

    const storeRecord = await this.store.getStore(storeId);
    if (!storeRecord?.active) {
      throw new ApplicationError('STORE_NOT_FOUND', 'Магазин не найден.', 404);
    }
    const employee = await this.store.getEmployee(employeeId);
    if (!employee || employee.storeId !== storeId || employee.active === false ||
        !isEligibleSeller(employee)) {
      throw new ApplicationError('EMPLOYEE_NOT_FOUND', 'Продавец не найден.', 404);
    }

    let task = null;
    if (input.libraryCode) {
      const library = await this.store.listLibraryTasks();
      task = library.find(item => item.code === input.libraryCode) || null;
      if (!task) {
        throw new ApplicationError('TASK_NOT_FOUND', 'Задание из библиотеки не найдено.', 404);
      }
    } else {
      task = {
        id: null,
        code: null,
        taskType: ['STORE', 'KNOWLEDGE', 'SALES'].includes(input.taskType) ? input.taskType : 'STORE',
        title: requireString(input.title, 'title'),
        description: requireString(input.description, 'description'),
        expectedResult: input.expectedResult ? String(input.expectedResult).trim() : null,
        materialText: null,
        questions: null,
      };
    }

    const timestamp = this.now().toISOString();
    const record = await this.store.createProposal({
      id: this.uuid(),
      storeId,
      employeeId,
      shiftDate,
      libraryTaskId: task.id,
      taskType: task.taskType,
      title: task.title,
      description: task.description,
      expectedResult: task.expectedResult,
      reason: input.reason ? String(input.reason).trim() : 'Назначено владельцем вручную.',
      source: 'MANUAL',
      status: PROPOSAL_STATUSES.APPROVED,
      bitrixText: null,
      createdByUserId: actor.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const bitrixText = buildBitrixText(record);
    return this.store.updateProposal(record.id, { bitrixText });
  }
}

module.exports = {
  PROPOSAL_STATUSES,
  SellerTasksService,
  buildBitrixText,
};
