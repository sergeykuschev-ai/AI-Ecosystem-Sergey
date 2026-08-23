'use strict';

const crypto = require('node:crypto');

const {
  calculateKpiMetrics,
} = require('../../../agents/business-kpi/services/calculate_kpi_metrics');
const {
  aggregateDays,
  aggregateMonth,
  aggregateSellers,
} = require('../../../agents/business-kpi/services/aggregate_month');
const {
  METRIC_CONTRACT_VERSION,
} = require('../../../agents/business-kpi/rules/metric_contract');
const { ApplicationError } = require('./application_error');
const { StorageConflictError } = require('../storage/storage_errors');
const { exportMonthWorkbook } = require('../xlsx/month_exporter');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHIFT_KEYS = new Set(['main', 'morning', 'evening']);
const WRITE_ROLES = new Set(['OWNER', 'MANAGER']);
const OWNER_ROLES = new Set(['OWNER']);
const SHIFT_SOURCES = new Set(['web_manual', 'excel_import']);
const SHIFT_INPUT_FIELDS = new Set([
  'storeId',
  'employeeId',
  'shiftDate',
  'shiftKey',
  'cash',
  'acquiring',
  'qr',
  'receipts',
  'itemsSold',
  'upsellReceipts',
  'treatsRevenue',
  'treatsReceipts',
  'comment',
]);

function requireRole(actor, roles) {
  if (!actor || !roles.has(actor.role)) {
    throw new ApplicationError(
      'FORBIDDEN',
      'Недостаточно прав для этого действия.',
      403
    );
  }
}

function requireDate(value, fieldName) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new ApplicationError(
      'VALIDATION_ERROR',
      `${fieldName} должен быть датой YYYY-MM-DD.`,
      422,
      { details: { field: fieldName } }
    );
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ApplicationError(
      'VALIDATION_ERROR',
      `${fieldName} содержит несуществующую дату.`,
      422,
      { details: { field: fieldName } }
    );
  }
  return value;
}

function requireString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApplicationError(
      'VALIDATION_ERROR',
      `${fieldName} обязателен.`,
      422,
      { details: { field: fieldName } }
    );
  }
  return value.trim();
}

function sanitizeComment(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 1000) {
    throw new ApplicationError(
      'VALIDATION_ERROR',
      'Комментарий должен быть строкой до 1000 символов.',
      422,
      { details: { field: 'comment' } }
    );
  }
  return value.trim() || null;
}

function rejectDerivedAndUnknownFields(input) {
  const unknown = Object.keys(input).find(field => !SHIFT_INPUT_FIELDS.has(field));
  if (unknown) {
    throw new ApplicationError(
      'UNSUPPORTED_SHIFT_FIELD',
      `Поле ${unknown} не поддерживается или рассчитывается сервером.`,
      422,
      { details: { field: unknown } }
    );
  }
}

function normalizeShiftInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ApplicationError(
      'VALIDATION_ERROR',
      'Данные смены должны быть JSON-объектом.',
      422
    );
  }
  rejectDerivedAndUnknownFields(input);
  const shiftKey = input.shiftKey === undefined ? 'main' : input.shiftKey;
  if (!SHIFT_KEYS.has(shiftKey)) {
    throw new ApplicationError(
      'VALIDATION_ERROR',
      'shiftKey должен быть main, morning или evening.',
      422,
      { details: { field: 'shiftKey' } }
    );
  }

  const normalized = {
    storeId: requireString(input.storeId, 'storeId'),
    employeeId: requireString(input.employeeId, 'employeeId'),
    shiftDate: requireDate(input.shiftDate, 'shiftDate'),
    shiftKey,
    cash: input.cash,
    acquiring: input.acquiring,
    qr: input.qr,
    receipts: input.receipts,
    itemsSold: input.itemsSold,
    upsellReceipts: input.upsellReceipts,
    treatsRevenue: input.treatsRevenue,
    treatsReceipts: input.treatsReceipts,
    comment: sanitizeComment(input.comment),
    historicalRevenue: null,
    revenueSource: 'payment_breakdown',
    paymentBreakdownAvailable: true,
    sourceReference: null,
  };
  try {
    calculateKpiMetrics(normalized);
  } catch (error) {
    throw new ApplicationError(
      'VALIDATION_ERROR',
      error.message === 'qr must be less than or equal to acquiring'
        ? 'QR не может быть больше эквайринга, который уже включает QR.'
        : error.message,
      422,
      { cause: error }
    );
  }
  return normalized;
}

function normalizeExcelShiftInput(input) {
  const normalized = {
    storeId: requireString(input.storeId, 'storeId'),
    employeeId: requireString(input.employeeId, 'employeeId'),
    employeeName: typeof input.employeeName === 'string' && input.employeeName.trim()
      ? input.employeeName.trim()
      : null,
    shiftDate: requireDate(input.shiftDate, 'shiftDate'),
    shiftKey: input.shiftKey || 'main',
    cash: input.cash ?? null,
    acquiring: input.acquiring ?? null,
    qr: input.qr ?? null,
    historicalRevenue: input.historicalRevenue ?? null,
    revenueSource: input.revenueSource || 'payment_breakdown',
    paymentBreakdownAvailable: input.paymentBreakdownAvailable !== false,
    receipts: input.receipts,
    itemsSold: input.itemsSold ?? null,
    upsellReceipts: input.upsellReceipts ?? null,
    treatsRevenue: input.treatsRevenue ?? null,
    treatsReceipts: input.treatsReceipts ?? null,
    comment: sanitizeComment(input.comment),
    sourceReference: input.sourceReference || null,
  };
  if (!SHIFT_KEYS.has(normalized.shiftKey) ||
      !['historical_total', 'payment_breakdown'].includes(normalized.revenueSource)) {
    throw new ApplicationError('VALIDATION_ERROR', 'Некорректный canonical Excel shift.', 422);
  }
  try {
    calculateKpiMetrics(normalized, null);
  } catch (error) {
    throw new ApplicationError('VALIDATION_ERROR', error.message, 422, { cause: error });
  }
  return normalized;
}

function shiftInputFromRecord(record) {
  return Object.fromEntries(
    Array.from(SHIFT_INPUT_FIELDS, field => [field, record[field]])
  );
}

function inputFingerprint(shift, settingsVersion) {
  const fields = [
    shift.id, shift.storeId, shift.employeeId, shift.shiftDate, shift.shiftKey,
    shift.cash, shift.acquiring, shift.qr, shift.receipts, shift.itemsSold,
    shift.upsellReceipts, shift.treatsRevenue, shift.treatsReceipts,
    settingsVersion,
  ];
  return crypto.createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

function auditRecord(action, entityId, actor, oldValue, newValue, options) {
  return {
    id: crypto.randomUUID(),
    actorId: actor.id,
    action,
    entityType: options.entityType,
    entityId,
    oldValue,
    newValue,
    source: options.source || 'web_manual',
    reason: options.reason || null,
    correlationId: options.correlationId || crypto.randomUUID(),
    occurredAt: options.now,
  };
}

class BusinessKpiService {
  constructor(options) {
    this.store = options.store;
    this.uuid = options.uuid || crypto.randomUUID;
    this.now = options.now || (() => new Date());
  }

  async requireReferences(store, input) {
    const [storeRecord, employee, settingsRecord] = await Promise.all([
      store.getStore(input.storeId),
      store.getEmployee(input.employeeId),
      store.getEffectiveSettings(input.storeId, input.shiftDate),
    ]);
    if (!storeRecord?.active) {
      throw new ApplicationError('STORE_NOT_FOUND', 'Магазин не найден.', 404);
    }
    if (!employee?.active || employee.storeId !== input.storeId) {
      throw new ApplicationError(
        'EMPLOYEE_NOT_FOUND',
        'Продавец не найден в выбранном магазине.',
        404
      );
    }
    if (!settingsRecord) {
      throw new ApplicationError(
        'SETTINGS_NOT_FOUND',
        'Для даты смены не найдены действующие настройки KPI.',
        409
      );
    }
    return { employee, settingsRecord };
  }

  async decorateShift(store, shift) {
    const [employee, settingsRecord] = await Promise.all([
      store.getEmployee(shift.employeeId),
      store.getEffectiveSettings(shift.storeId, shift.shiftDate),
    ]);
    const metrics = calculateKpiMetrics(shift, settingsRecord?.settings || null);
    return {
      ...shift,
      employeeName: shift.employeeName || employee?.displayName || null,
      historical_revenue: shift.historicalRevenue ?? null,
      revenue_source: shift.revenueSource,
      payment_breakdown_available: metrics.paymentBreakdownAvailable,
      metrics,
      settingsVersion: settingsRecord?.version || null,
    };
  }

  async saveKpiSnapshot(store, shift, settingsRecord, metrics, now) {
    await store.saveKpiResult({
      id: this.uuid(),
      storeId: shift.storeId,
      employeeId: shift.employeeId,
      shiftId: shift.id,
      settingsId: settingsRecord.id,
      periodStart: shift.shiftDate,
      calculationVersion: METRIC_CONTRACT_VERSION,
      inputFingerprint: inputFingerprint(shift, settingsRecord.version),
      result: metrics,
      calculatedAt: now,
    });
  }

  async createShift(input, actor, options = {}) {
    requireRole(actor, WRITE_ROLES);
    const normalized = normalizeShiftInput(input);
    const source = options.source || 'web_manual';
    if (!SHIFT_SOURCES.has(source)) {
      throw new ApplicationError(
        'INVALID_SHIFT_SOURCE',
        'Источник смены не поддерживается.',
        422
      );
    }
    const now = this.now().toISOString();
    try {
      return await this.store.transaction(async store => {
        const { employee, settingsRecord } = await this.requireReferences(
          store,
          normalized
        );
        const metrics = calculateKpiMetrics(normalized, settingsRecord.settings);
        const shift = await store.createShift({
          id: this.uuid(),
          ...normalized,
          employeeName: employee.displayName,
          source,
          sourceRef: options.sourceRef || null,
          archivedAt: null,
          archivedBy: null,
          createdAt: now,
          updatedAt: now,
        });
        await this.saveKpiSnapshot(store, shift, settingsRecord, metrics, now);
        await store.appendAudit(auditRecord(
          'SHIFT_CREATED',
          shift.id,
          actor,
          null,
          shift,
          {
            entityType: 'shift',
            source,
            reason: options.reason,
            correlationId: options.correlationId,
            now,
          }
        ));
        return { ...shift, metrics, settingsVersion: settingsRecord.version };
      });
    } catch (error) {
      if (error instanceof StorageConflictError) {
        throw new ApplicationError(error.code, error.message, 409, { cause: error });
      }
      throw error;
    }
  }

  async importExcelShift(input, actor, options = {}) {
    const [shift] = await this.importExcelShiftsBulk([input], actor, options);
    return shift;
  }

  async importExcelShiftsBulk(inputs, actor, options = {}) {
    requireRole(actor, WRITE_ROLES);
    const normalizedInputs = inputs.map(normalizeExcelShiftInput);
    const now = this.now().toISOString();
    return this.store.transaction(async store => {
      if (options.beforeImport) await options.beforeImport(store);
      const imported = [];
      for (const normalized of normalizedInputs) {
        const storeRecord = await store.getStore(normalized.storeId);
        const employee = await store.getEmployee(normalized.employeeId);
        if (!storeRecord?.active || !employee?.active || employee.storeId !== normalized.storeId) {
          throw new ApplicationError('EMPLOYEE_NOT_FOUND', 'Продавец или магазин не найден.', 404);
        }
        const settingsRecord = await store.getEffectiveSettings(normalized.storeId, normalized.shiftDate);
        normalized.employeeName = normalized.employeeName || employee.displayName;
        const metrics = calculateKpiMetrics(normalized, settingsRecord?.settings || null);
        const shift = await store.createShift({
          id: this.uuid(),
          ...normalized,
          source: 'excel_import',
          sourceRef: options.sourceRef || null,
          importRunId: options.importRunId || null,
          originalImportedInput: normalized,
          archivedAt: null,
          archivedBy: null,
          createdAt: now,
          updatedAt: now,
        });
        if (settingsRecord) await this.saveKpiSnapshot(store, shift, settingsRecord, metrics, now);
        await store.appendAudit(auditRecord('SHIFT_IMPORTED', shift.id, actor, null, shift, {
          entityType: 'shift', source: 'excel_import', correlationId: options.correlationId, now,
        }));
        imported.push({ ...shift, metrics, settingsVersion: settingsRecord?.version || null });
      }
      if (options.beforeCommit) await options.beforeCommit(store, imported);
      return imported;
    });
  }

  async listShifts(filters = {}) {
    const shifts = await this.store.listShifts(filters);
    return Promise.all(shifts.map(shift => this.decorateShift(this.store, shift)));
  }

  async getShift(id) {
    const shift = await this.store.getShift(id, { includeArchived: true });
    if (!shift) {
      throw new ApplicationError('SHIFT_NOT_FOUND', 'Смена не найдена.', 404);
    }
    const decorated = await this.decorateShift(this.store, shift);
    const audit = await this.store.listAudit({ entityId: id });
    return { ...decorated, audit };
  }

  async updateShift(id, patch, actor, options = {}) {
    requireRole(actor, WRITE_ROLES);
    const now = this.now().toISOString();
    try {
      return await this.store.transaction(async store => {
        const oldShift = await store.getShift(id);
        if (!oldShift) {
          throw new ApplicationError('SHIFT_NOT_FOUND', 'Смена не найдена.', 404);
        }
        rejectDerivedAndUnknownFields(patch);
        const historical = oldShift.revenueSource === 'historical_total';
        if (historical && ['cash', 'acquiring', 'qr'].some(
          field => patch[field] !== undefined && patch[field] !== null
        )) {
          throw new ApplicationError(
            'HISTORICAL_PAYMENT_OVERRIDE_NOT_SUPPORTED',
            'Нельзя придумывать платёжную разбивку для исторической смены. Оставьте cash/acquiring/QR пустыми.',
            422
          );
        }
        const normalized = historical
          ? normalizeExcelShiftInput({
            ...oldShift,
            ...patch,
            cash: null,
            acquiring: null,
            qr: null,
            historicalRevenue: oldShift.historicalRevenue,
            revenueSource: 'historical_total',
            paymentBreakdownAvailable: false,
            employeeName: oldShift.employeeName,
            sourceReference: oldShift.sourceReference,
          })
          : normalizeShiftInput({
            ...shiftInputFromRecord(oldShift),
            ...patch,
          });
        const [storeRecord, employee, settingsRecord] = await Promise.all([
          store.getStore(normalized.storeId),
          store.getEmployee(normalized.employeeId),
          store.getEffectiveSettings(normalized.storeId, normalized.shiftDate),
        ]);
        if (!storeRecord?.active || !employee?.active || employee.storeId !== normalized.storeId) {
          throw new ApplicationError('EMPLOYEE_NOT_FOUND', 'Продавец или магазин не найден.', 404);
        }
        if (!historical && !settingsRecord) {
          throw new ApplicationError('SETTINGS_NOT_FOUND', 'Для даты смены не найдены действующие настройки KPI.', 409);
        }
        const metrics = calculateKpiMetrics(normalized, settingsRecord?.settings || null);
        const updated = await store.updateShift(id, {
          ...oldShift,
          ...normalized,
          employeeName: employee.displayName,
          override: oldShift.source === 'excel_import' ? {
            source: 'web_manual', actorId: actor.id, occurredAt: now,
          } : oldShift.override || null,
          updatedAt: now,
        });
        if (settingsRecord) await this.saveKpiSnapshot(store, updated, settingsRecord, metrics, now);
        await store.appendAudit(auditRecord(
          'SHIFT_UPDATED',
          id,
          actor,
          oldShift,
          updated,
          {
            entityType: 'shift',
            reason: options.reason,
            correlationId: options.correlationId,
            now,
          }
        ));
        return { ...updated, metrics, settingsVersion: settingsRecord?.version || null };
      });
    } catch (error) {
      if (error instanceof StorageConflictError) {
        throw new ApplicationError(error.code, error.message, 409, { cause: error });
      }
      throw error;
    }
  }

  async archiveShift(id, actor, options = {}) {
    requireRole(actor, OWNER_ROLES);
    const now = this.now().toISOString();
    return this.store.transaction(async store => {
      const oldShift = await store.getShift(id);
      if (!oldShift) {
        throw new ApplicationError('SHIFT_NOT_FOUND', 'Смена не найдена.', 404);
      }
      const archived = await store.archiveShift(id, {
        archivedAt: now,
        archivedBy: actor.id,
        updatedAt: now,
      });
      await store.appendAudit(auditRecord(
        'SHIFT_ARCHIVED',
        id,
        actor,
        oldShift,
        archived,
        {
          entityType: 'shift',
          reason: options.reason,
          correlationId: options.correlationId,
          now,
        }
      ));
      return archived;
    });
  }

  async getDashboard(input) {
    const storeRecord = await this.store.getStore(input.storeId);
    if (!storeRecord?.active) {
      throw new ApplicationError('STORE_NOT_FOUND', 'Магазин не найден.', 404);
    }
    const firstDay = `${input.year}-${String(input.month).padStart(2, '0')}-01`;
    const [shifts, planRecord, settingsRecord] = await Promise.all([
      this.store.listShifts({
        storeId: input.storeId,
        year: input.year,
        month: input.month,
      }),
      this.store.getMonthlyPlan(input.storeId, input.year, input.month),
      this.store.getEffectiveSettings(input.storeId, firstDay),
    ]);
    const month = aggregateMonth(shifts, {
      ...input,
      plan: planRecord?.revenuePlan ?? null,
      settings: settingsRecord?.settings || null,
      asOf: this.now(),
    });
    return {
      month: { ...month, calculatedShifts: undefined },
      days: aggregateDays(month),
      sellers: aggregateSellers(month, settingsRecord?.settings || null),
      settingsVersion: settingsRecord?.version || null,
      settingsStatus: settingsRecord ? 'CONFIRMED' : 'UNRESOLVED',
    };
  }

  async getReferenceData(storeId) {
    const stores = await this.store.listStores();
    const selectedStoreId = storeId || stores[0]?.id || null;
    const employees = selectedStoreId
      ? await this.store.listEmployees({ storeId: selectedStoreId })
      : [];
    return { stores, employees, selectedStoreId };
  }

  async getSettings(storeId, date) {
    requireString(storeId, 'storeId');
    requireDate(date, 'date');
    const storeRecord = await this.store.getStore(storeId);
    if (!storeRecord?.active) {
      throw new ApplicationError('STORE_NOT_FOUND', 'Магазин не найден.', 404);
    }
    const record = await this.store.getEffectiveSettings(storeId, date);
    if (!record) {
      throw new ApplicationError('SETTINGS_NOT_FOUND', 'Настройки KPI не найдены.', 404);
    }
    return record;
  }

  async updateMonthlyPlan(input, actor, options = {}) {
    requireRole(actor, OWNER_ROLES);
    requireString(input.storeId, 'storeId');
    if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2200 ||
        !Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
      throw new ApplicationError(
        'VALIDATION_ERROR',
        'Год или месяц плана содержит недопустимое значение.',
        422
      );
    }
    const revenuePlan = input.revenuePlan;
    if (typeof revenuePlan !== 'number' || !Number.isFinite(revenuePlan) ||
        revenuePlan < 0) {
      throw new ApplicationError(
        'VALIDATION_ERROR',
        'План месяца должен быть неотрицательным числом.',
        422,
        { details: { field: 'revenuePlan' } }
      );
    }
    const now = this.now().toISOString();
    return this.store.transaction(async store => {
      const storeRecord = await store.getStore(input.storeId);
      if (!storeRecord?.active) {
        throw new ApplicationError('STORE_NOT_FOUND', 'Магазин не найден.', 404);
      }
      const oldPlan = await store.getMonthlyPlan(
        input.storeId,
        input.year,
        input.month
      );
      const record = await store.upsertMonthlyPlan({
        id: oldPlan?.id || this.uuid(),
        storeId: input.storeId,
        year: input.year,
        month: input.month,
        revenuePlan,
        source: 'web_manual',
        createdAt: oldPlan?.createdAt || now,
        updatedAt: now,
      });
      await store.appendAudit(auditRecord(
        oldPlan ? 'MONTHLY_PLAN_UPDATED' : 'MONTHLY_PLAN_CREATED',
        `${input.storeId}:${input.year}-${String(input.month).padStart(2, '0')}`,
        actor,
        oldPlan,
        record,
        {
          entityType: 'monthly_plan',
          reason: options.reason,
          correlationId: options.correlationId,
          now,
        }
      ));
      return record;
    });
  }

  async exportMonth(input) {
    const storeRecord = await this.store.getStore(input.storeId);
    if (!storeRecord?.active) {
      throw new ApplicationError('STORE_NOT_FOUND', 'Магазин не найден.', 404);
    }
    const [shifts, dashboard] = await Promise.all([
      this.listShifts({ storeId: input.storeId, year: input.year, month: input.month }),
      this.getDashboard(input),
    ]);
    return exportMonthWorkbook({
      ...input,
      storeName: storeRecord.name,
      shifts,
      dashboard,
      exportedAt: this.now().toISOString(),
    });
  }
}

module.exports = {
  BusinessKpiService,
  SHIFT_INPUT_FIELDS,
  auditRecord,
  normalizeShiftInput,
  normalizeExcelShiftInput,
  requireDate,
  requireRole,
  shiftInputFromRecord,
};
