'use strict';

const { ApplicationError } = require('./application_error');
const { PERMISSIONS, hasPermission, requirePermission } = require('./permissions');
const {
  buildSellerPerformance,
  TREND_MODES,
} = require('../../../agents/business-kpi/services/seller_performance_analytics');
const { buildTaskProposals } = require('../../../agents/business-kpi/services/seller_task_planner');
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
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
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

function latestCertificationAttempt(attempts) {
  return (attempts || [])
    .filter(attempt => attempt.attemptType === 'CERTIFICATION')
    .sort((left, right) =>
      String(right.createdAt).localeCompare(String(left.createdAt)))[0] || null;
}

function learningProgressFromHistory(library, history, moduleAttempts = []) {
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
  let completed = 0;
  const items = library.map(task => {
    const latest = byCode.get(task.code);
    const completedByQuiz = completedCodes.has(task.code);
    if (completedByQuiz) completed += 1;
    let status = completedByQuiz ? 'COMPLETED' : 'NOT_STARTED';
    if (!completedByQuiz && latest?.status === PROPOSAL_STATUSES.NOT_COMPLETED) status = 'REVIEW';
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
  }

  async listLibrary(actor) {
    requirePermission(actor, PERMISSIONS.LEARNING_READ);
    const items = await this.store.listLibraryTasks();
    return {
      items: hasPermission(actor.role, PERMISSIONS.TASKS_READ)
        ? items
        : items.filter(task => task.taskType === 'KNOWLEDGE'),
    };
  }

  async learningProgress(actor) {
    requirePermission(actor, PERMISSIONS.LEARNING_READ);
    const library = (await this.store.listLibraryTasks())
      .filter(task => task.taskType === 'KNOWLEDGE');
    const employee = await this.store.getEmployeeByUserId(actor.id);
    if (!employee) {
      const progress = learningProgressFromHistory(library, []);
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
    const progress = learningProgressFromHistory(library, history, attempts);
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
    return {
      storeId,
      asOfDate: todayText,
      passPercent: PASS_PERCENT,
      totalModules: knowledge.length,
      certificationQuestions: CERTIFICATION_BANK.length,
      items: sellers.map(employee => {
        const employeeAttempts = attempts.filter(item => item.employeeId === employee.id);
        const progress = learningProgressFromHistory(
          knowledge,
          history.filter(item => item.employeeId === employee.id),
          employeeAttempts.filter(item => item.attemptType === 'MODULE')
        );
        const onboarding = buildOnboardingProgress(progress.items, knowledge);
        const latestAttempt = latestCertificationAttempt(employeeAttempts);
        const weakModules = certificationWeakModules(
          latestAttempt,
          CERTIFICATION_BANK,
          knowledge
        );
        const performanceItem = performanceByEmployee.get(employee.id) || null;
        const recommendation = buildTodayTrainingRecommendation({
          onboarding,
          latestAttempt,
          weakModules,
          performanceItem,
          targets: settingsRecord?.settings?.targets || null,
          library,
        });
        return {
          employeeId: employee.id,
          displayName: employee.displayName,
          modulesCompleted: progress.completed,
          modulesTotal: progress.total,
          learningPercent: progress.percent,
          onboarding,
          latestAttempt: certificationSummary(latestAttempt),
          weakModules: weakModules.slice(0, 3),
          recommendation,
        };
      }),
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

    const [settingsRecord, library, existing, shifts, attempts] = await Promise.all([
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
    const proposals = buildTaskProposals({
      sellers: [employee],
      targets: settingsRecord?.settings?.targets || null,
      performanceItems: performance.items,
      historyEntries,
      shiftDate,
      today: todayText,
      library,
      knowledgePriorityByEmployee: {
        [employee.id]: weakModules.map(item => item.code),
      },
    }).filter(proposal =>
      proposal.taskType === 'KNOWLEDGE' || proposal.taskType === 'SALES');

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
      const key = proposal.employeeId + '|' + proposal.shiftDate + '|' + proposal.libraryCode;
      if (existingKeys.has(key)) continue;
      const timestamp = this.now().toISOString();
      try {
        const bitrixText = buildBitrixText({
          title: task.title,
          description: task.description,
          expectedResult: task.expectedResult,
          materialText: task.materialText,
          questions: task.questions,
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
