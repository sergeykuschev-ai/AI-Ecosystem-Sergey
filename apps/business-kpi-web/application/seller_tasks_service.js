'use strict';

const { ApplicationError } = require('./application_error');
const { PERMISSIONS, requirePermission } = require('./permissions');
const {
  buildSellerPerformance,
  TREND_MODES,
} = require('../../../agents/business-kpi/services/seller_performance_analytics');
const { buildTaskProposals } = require('../../../agents/business-kpi/services/seller_task_planner');
const { StorageConflictError } = require('../storage/storage_errors');

const PROPOSAL_STATUSES = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  COMPLETED: 'COMPLETED',
  NOT_COMPLETED: 'NOT_COMPLETED',
});

const HISTORY_WINDOW_DAYS = 45;
const LIST_DEFAULT_LIMIT = 500;

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
    requirePermission(actor, PERMISSIONS.TASKS_READ);
    return { items: await this.store.listLibraryTasks() };
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

    const [employees, settingsRecord, library, existing, shifts, dayShifts] = await Promise.all([
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

    const proposals = buildTaskProposals({
      sellers,
      targets: settingsRecord?.settings?.targets || null,
      performanceItems: performance.items,
      historyEntries,
      shiftDate,
      today: todayText,
      library,
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
