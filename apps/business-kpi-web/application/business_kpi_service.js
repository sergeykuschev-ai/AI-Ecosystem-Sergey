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
const { PERMISSIONS, hasPermission } = require('./permissions');
const { StorageConflictError } = require('../storage/storage_errors');
const { exportMonthWorkbook } = require('../xlsx/month_exporter');

const DATA_STATUS = Object.freeze({
  NO_DATA: 'NO_DATA',
  PARTIAL: 'PARTIAL',
  COMPLETE: 'COMPLETE',
});

function resolveDataStatus(monthAggregate) {
  if (monthAggregate.shiftsCount === 0) return DATA_STATUS.NO_DATA;
  const partial = !monthAggregate.paymentBreakdownAvailable ||
    monthAggregate.calculatedShifts.some(
      item => item.metrics.kpiStatus !== 'COMPLETE'
    );
  return partial ? DATA_STATUS.PARTIAL : DATA_STATUS.COMPLETE;
}

function sumYearTotals(months) {
  let revenue = 0;
  let receipts = 0;
  let itemsSold = 0;
  let shiftsCount = 0;
  let dataDays = 0;
  let plan = 0;
  let planCount = 0;
  for (const month of months) {
    if (month.dataStatus === DATA_STATUS.NO_DATA) continue;
    revenue += month.revenue || 0;
    receipts += month.receipts || 0;
    itemsSold += month.itemsSold || 0;
    shiftsCount += month.shiftsCount || 0;
    dataDays += month.dataDays || 0;
    if (month.plan !== null && month.plan !== undefined) {
      plan += month.plan;
      planCount += 1;
    }
  }
  return { revenue, receipts, itemsSold, shiftsCount, dataDays, plan, planCount };
}

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

async function linkedEmployeeId(store, actor) {
  if (!actor || actor.role !== 'SELLER') return null;
  const employee = await store.getEmployeeByUserId(actor.id);
  return employee?.id || null;
}

function requireShiftWritePermission({ actor, permission, oldShift, linkedEmployeeId }) {
  if (!actor || !actor.role) {
    throw new ApplicationError('AUTH_REQUIRED', 'Требуется аутентификация.', 401);
  }
  if (!hasPermission(actor.role, permission)) {
    throw new ApplicationError('FORBIDDEN', 'Недостаточно прав для этой операции.', 403);
  }
  if (actor.role === 'SELLER') {
    if (!linkedEmployeeId) {
      throw new ApplicationError(
        'FORBIDDEN',
        'Учётная запись продавца не связана с сотрудником.',
        403
      );
    }
    if (oldShift && oldShift.source !== 'web_manual') {
      throw new ApplicationError(
        'FORBIDDEN',
        'Нельзя редактировать смены, созданные импортом или другой системой.',
        403
      );
    }
    if (oldShift && oldShift.employeeId !== linkedEmployeeId) {
      throw new ApplicationError(
        'FORBIDDEN',
        'Нельзя редактировать чужую смену.',
        403
      );
    }
  }
}

function validateKpiSettings(settings) {
  const errors = [];
  const requireNumber = (value, name, min = null, max = null) => {
    if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
      errors.push(`${name} должно быть числом.`);
      return false;
    }
    if (min !== null && value < min) {
      errors.push(`${name} не может быть меньше ${min}.`);
      return false;
    }
    if (max !== null && value > max) {
      errors.push(`${name} не может быть больше ${max}.`);
      return false;
    }
    return true;
  };

  const targets = settings.targets || {};
  requireNumber(targets.averageCheck, 'Цель среднего чека', 0);
  requireNumber(targets.itemsPerReceipt, 'Цель товаров в чеке', 0);
  requireNumber(targets.upsellReceiptShare, 'Цель допродаж', 0, 1);
  requireNumber(targets.treatsRevenue, 'Цель лакомств за смену', 0);
  requireNumber(targets.treatsReceiptShare, 'Цель чеков с лакомствами', 0, 1);
  if (targets.qrShare !== null) {
    requireNumber(targets.qrShare, 'Цель QR', 0, 1);
  }
  requireNumber(targets.shiftRevenue, 'Цель смены', 0);
  requireNumber(targets.sellerShifts, 'Норма смен продавца', 0);

  const weights = settings.weights || {};
  const weightKeys = ['shiftPlan', 'averageCheck', 'itemsPerReceipt', 'upsell', 'treats'];
  let weightSum = 0;
  for (const key of weightKeys) {
    if (requireNumber(weights[key], `Вес ${key}`, 0, 100)) {
      weightSum += weights[key];
    }
  }
  if (Math.abs(weightSum - 100) > 0.001) {
    errors.push(`Сумма весов KPI должна быть 100 (сейчас ${weightSum}).`);
  }

  const fees = settings.fees || {};
  requireNumber(fees.acquiring, 'Комиссия эквайринга', 0, 1);
  requireNumber(fees.qr, 'Комиссия QR', 0, 1);

  if (typeof settings.payment?.qrIncludedInAcquiring !== 'boolean') {
    errors.push('Укажите, входит ли QR в эквайринг.');
  }

  const levels = settings.levels || [];
  for (let i = 0; i < levels.length; i += 1) {
    const level = levels[i];
    if (typeof level.name !== 'string' || !level.name.trim()) {
      errors.push(`Уровень ${i + 1}: название обязательно.`);
    }
    requireNumber(level.minimumScore, `Уровень ${i + 1}: минимальный KPI`, 0, 100);
    requireNumber(level.bonusBase, `Уровень ${i + 1}: база премии`, 0);
  }

  const tiers = settings.qrCoefficientTiers || [];
  let previousUpper = -1;
  for (let i = 0; i < tiers.length; i += 1) {
    const tier = tiers[i];
    const isLast = i === tiers.length - 1;
    if (!isLast) {
      if (requireNumber(tier.upperExclusive, `QR tier ${i + 1}: верхняя граница`, 0, 1)) {
        if (tier.upperExclusive <= previousUpper) {
          errors.push(`QR tier ${i + 1}: границы должны идти по возрастанию.`);
        }
      }
      previousUpper = tier.upperExclusive;
    }
    requireNumber(tier.coefficient, `QR tier ${i + 1}: коэффициент`, 0);
  }

  return errors;
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
    const normalized = normalizeShiftInput(input);
    const source = options.source || 'web_manual';
    if (!SHIFT_SOURCES.has(source)) {
      throw new ApplicationError(
        'INVALID_SHIFT_SOURCE',
        'Источник смены не поддерживается.',
        422
      );
    }
    const canCreateAny = hasPermission(actor?.role, PERMISSIONS.SHIFT_CREATE);
    const canCreateOwn = hasPermission(actor?.role, PERMISSIONS.SHIFT_CREATE_OWN);
    if (!canCreateAny && !canCreateOwn) {
      throw new ApplicationError('FORBIDDEN', 'Недостаточно прав для создания смены.', 403);
    }
    const now = this.now().toISOString();
    try {
      return await this.store.transaction(async store => {
        if (actor.role === 'SELLER') {
          const employeeId = await linkedEmployeeId(store, actor);
          if (!employeeId) {
            throw new ApplicationError(
              'FORBIDDEN',
              'Учётная запись продавца не связана с сотрудником.',
              403
            );
          }
          if (normalized.employeeId !== employeeId) {
            throw new ApplicationError(
              'FORBIDDEN',
              'Можно создавать смену только за себя.',
              403
            );
          }
        }
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
    const now = this.now().toISOString();
    try {
      return await this.store.transaction(async store => {
        const oldShift = await store.getShift(id);
        if (!oldShift) {
          throw new ApplicationError('SHIFT_NOT_FOUND', 'Смена не найдена.', 404);
        }
        const permission = hasPermission(actor?.role, PERMISSIONS.SHIFT_EDIT_ANY)
          ? PERMISSIONS.SHIFT_EDIT_ANY
          : PERMISSIONS.SHIFT_EDIT_OWN;
        const employeeId = await linkedEmployeeId(store, actor);
        requireShiftWritePermission({
          actor,
          permission,
          oldShift,
          linkedEmployeeId: employeeId,
        });
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
    const now = this.now().toISOString();
    return this.store.transaction(async store => {
      const oldShift = await store.getShift(id);
      if (!oldShift) {
        throw new ApplicationError('SHIFT_NOT_FOUND', 'Смена не найдена.', 404);
      }
      const permission = hasPermission(actor?.role, PERMISSIONS.SHIFT_ARCHIVE_ANY)
        ? PERMISSIONS.SHIFT_ARCHIVE_ANY
        : PERMISSIONS.SHIFT_ARCHIVE_OWN;
      const employeeId = await linkedEmployeeId(store, actor);
      requireShiftWritePermission({
        actor,
        permission,
        oldShift,
        linkedEmployeeId: employeeId,
      });
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

  async getDashboard(input, actor) {
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
    const sellers = aggregateSellers(month, settingsRecord?.settings || null);
    const redactedSellers = await this.redactSellerBonuses(sellers, actor);
    return {
      month: {
        ...month,
        calculatedShifts: undefined,
        dataStatus: resolveDataStatus(month),
      },
      days: aggregateDays(month),
      sellers: redactedSellers,
      settingsVersion: settingsRecord?.version || null,
      settingsStatus: settingsRecord ? 'CONFIRMED' : 'UNRESOLVED',
    };
  }

  async redactSellerBonuses(sellers, actor) {
    if (!actor || actor.role !== 'SELLER') return sellers;
    const canSeeAll = hasPermission(actor.role, PERMISSIONS.BONUS_READ_ALL_AMOUNTS);
    const canSeeOwn = hasPermission(actor.role, PERMISSIONS.BONUS_READ_OWN_AMOUNT);
    if (canSeeAll || !canSeeOwn) return sellers;
    const ownEmployeeId = await linkedEmployeeId(this.store, actor);
    return sellers.map(seller => {
      if (seller.employeeId === ownEmployeeId) return seller;
      return {
        ...seller,
        bonus: null,
        bonusStatus: 'ACCESS_DENIED',
        bonusDetails: null,
      };
    });
  }

  async getToday(input) {
    const storeRecord = await this.store.getStore(input.storeId);
    if (!storeRecord?.active) {
      throw new ApplicationError('STORE_NOT_FOUND', 'Магазин не найден.', 404);
    }
    const today = this.now().toISOString().slice(0, 10);
    const shifts = await this.store.listShifts({
      storeId: input.storeId,
      dateFrom: today,
      dateTo: today,
    });
    const decorated = await Promise.all(
      shifts.map(shift => this.decorateShift(this.store, shift))
    );
    const totalRevenue = decorated.reduce(
      (sum, shift) => sum + (shift.metrics?.revenue || 0),
      0
    );
    const totalReceipts = decorated.reduce(
      (sum, shift) => sum + (shift.receipts || 0),
      0
    );
    const totalItems = decorated.reduce(
      (sum, shift) =>
        sum + (shift.itemsSold === null || shift.itemsSold === undefined
          ? 0
          : shift.itemsSold),
      0
    );
    const totalQr = decorated.reduce(
      (sum, shift) => sum + (shift.qr === null || shift.qr === undefined ? 0 : shift.qr),
      0
    );
    return {
      date: today,
      shifts: decorated,
      aggregate: {
        shiftsCount: decorated.length,
        revenue: totalRevenue,
        receipts: totalReceipts,
        averageCheck: totalReceipts > 0 ? totalRevenue / totalReceipts : null,
        itemsSold: totalItems,
        itemsPerReceipt: totalItems > 0 && totalReceipts > 0 ? totalItems / totalReceipts : null,
        qr: totalQr,
        qrShare: totalRevenue > 0 ? totalQr / totalRevenue : null,
        dataStatus: decorated.length === 0
          ? DATA_STATUS.NO_DATA
          : (decorated.every(s => s.metrics?.kpiStatus === 'COMPLETE')
            ? DATA_STATUS.COMPLETE
            : DATA_STATUS.PARTIAL),
      },
    };
  }

  async listMonths(input) {
    const storeRecord = await this.store.getStore(input.storeId);
    if (!storeRecord?.active) {
      throw new ApplicationError('STORE_NOT_FOUND', 'Магазин не найден.', 404);
    }
    const months = [];
    let previousRevenue = null;
    for (let month = 1; month <= 12; month += 1) {
      const firstDay = `${input.year}-${String(month).padStart(2, '0')}-01`;
      const [shifts, planRecord, settingsRecord] = await Promise.all([
        this.store.listShifts({
          storeId: input.storeId,
          year: input.year,
          month,
        }),
        this.store.getMonthlyPlan(input.storeId, input.year, month),
        this.store.getEffectiveSettings(input.storeId, firstDay),
      ]);
      const aggregate = aggregateMonth(shifts, {
        year: input.year,
        month,
        plan: planRecord?.revenuePlan ?? null,
        settings: settingsRecord?.settings || null,
        asOf: this.now(),
      });
      const dataStatus = resolveDataStatus(aggregate);
      const change = previousRevenue !== null && dataStatus !== DATA_STATUS.NO_DATA
        ? aggregate.revenue - previousRevenue
        : null;
      previousRevenue = dataStatus === DATA_STATUS.NO_DATA ? previousRevenue : aggregate.revenue;
      months.push({
        year: input.year,
        month,
        plan: aggregate.plan,
        revenue: aggregate.revenue,
        planCompletion: aggregate.planCompletion,
        receipts: aggregate.receipts,
        averageCheck: aggregate.averageCheck,
        itemsPerReceipt: aggregate.itemsPerReceipt,
        qr: aggregate.qr,
        qrShare: aggregate.qrShare,
        shiftsCount: aggregate.shiftsCount,
        dataDays: aggregate.dataDays,
        dataStatus,
        forecast: aggregate.forecast,
        changeFromPreviousMonth: change,
      });
    }
    return months;
  }

  async getYearSummary(input) {
    const storeRecord = await this.store.getStore(input.storeId);
    if (!storeRecord?.active) {
      throw new ApplicationError('STORE_NOT_FOUND', 'Магазин не найден.', 404);
    }
    const months = await this.listMonths(input);
    const now = this.now();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;
    const isCurrentMonth = m => m.year === currentYear && m.month === currentMonth;

    const dataMonths = months.filter(m => m.dataStatus !== DATA_STATUS.NO_DATA);
    const completedMonths = dataMonths.filter(m => !isCurrentMonth(m));
    const currentMonthData = dataMonths.find(isCurrentMonth) || null;

    const totals = sumYearTotals(months);
    const completedTotals = sumYearTotals(completedMonths);

    const averageCheck = totals.receipts > 0 ? totals.revenue / totals.receipts : null;
    const itemsPerReceipt = totals.itemsSold > 0 && totals.receipts > 0
      ? totals.itemsSold / totals.receipts
      : null;
    const planCompletion = totals.plan > 0 ? totals.revenue / totals.plan : null;

    const completedAverageCheck = completedTotals.receipts > 0
      ? completedTotals.revenue / completedTotals.receipts
      : null;
    const completedItemsPerReceipt = completedTotals.itemsSold > 0 && completedTotals.receipts > 0
      ? completedTotals.itemsSold / completedTotals.receipts
      : null;
    const completedPlanCompletion = completedTotals.plan > 0
      ? completedTotals.revenue / completedTotals.plan
      : null;

    const sortedByRevenue = [...completedMonths].sort(
      (left, right) => right.revenue - left.revenue
    );
    const sortedByCompletion = [...completedMonths].sort(
      (left, right) => (right.planCompletion || 0) - (left.planCompletion || 0)
    );
    const hasConfirmedFuturePlans = months.some(
      m => (input.year < currentYear) ||
        (input.year === currentYear && m.month > currentMonth && m.plan !== null)
    );
    return {
      year: input.year,
      months,
      currentMonth: currentMonthData,
      ytd: {
        revenue: totals.revenue,
        plan: totals.plan,
        planCount: totals.planCount,
        planCompletion,
        receipts: totals.receipts,
        averageCheck,
        itemsSold: totals.itemsSold,
        itemsPerReceipt,
        shiftsCount: totals.shiftsCount,
        dataDays: totals.dataDays,
      },
      ytdCompleted: {
        revenue: completedTotals.revenue,
        plan: completedTotals.plan,
        planCount: completedTotals.planCount,
        planCompletion: completedPlanCompletion,
        receipts: completedTotals.receipts,
        averageCheck: completedAverageCheck,
        itemsSold: completedTotals.itemsSold,
        itemsPerReceipt: completedItemsPerReceipt,
        shiftsCount: completedTotals.shiftsCount,
        dataDays: completedTotals.dataDays,
      },
      currentMonthSummary: currentMonthData
        ? {
          month: currentMonthData.month,
          revenue: currentMonthData.revenue,
          plan: currentMonthData.plan,
          planCompletion: currentMonthData.planCompletion,
          forecast: currentMonthData.forecast,
        }
        : null,
      bests: {
        revenue: sortedByRevenue[0] || null,
        completion: sortedByCompletion[0] || null,
      },
      worsts: {
        revenue: sortedByRevenue[sortedByRevenue.length - 1] || null,
        completion: sortedByCompletion[sortedByCompletion.length - 1] || null,
      },
      hasConfirmedFuturePlans,
    };
  }

  async getBonuses(input, actor) {
    const storeRecord = await this.store.getStore(input.storeId);
    if (!storeRecord?.active) {
      throw new ApplicationError('STORE_NOT_FOUND', 'Магазин не найден.', 404);
    }
    const dashboard = await this.getDashboard(input, actor);
    const canSeeAllAmounts = hasPermission(actor?.role, PERMISSIONS.BONUS_READ_ALL_AMOUNTS);
    const canSeeOwnAmount = hasPermission(actor?.role, PERMISSIONS.BONUS_READ_OWN_AMOUNT);
    const ownEmployeeId = canSeeOwnAmount && actor?.role === 'SELLER'
      ? await linkedEmployeeId(this.store, actor)
      : null;
    const items = dashboard.sellers.map(seller => {
      const isOwnSeller = seller.employeeId === ownEmployeeId;
      const canSeeAmount = canSeeAllAmounts || (canSeeOwnAmount && isOwnSeller);
      return {
        employeeId: seller.employeeId,
        employeeName: seller.employeeName,
        shiftsCount: seller.shiftsCount,
        revenuePerShift: seller.revenuePerShift,
        averageKpi: seller.averageKpi,
        kpiLevel: seller.kpiLevel,
        qrShare: seller.qrShare,
        bonus: canSeeAmount ? seller.bonus : null,
        bonusStatus: canSeeAmount ? seller.bonusStatus : 'ACCESS_DENIED',
        bonusDetails: canSeeAmount ? seller.bonusDetails : null,
      };
    });
    return {
      year: input.year,
      month: input.month,
      planCompletion: dashboard.month.planCompletion,
      dataStatus: dashboard.month.dataStatus,
      items,
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

  async listSettingsVersions(storeId, date) {
    requireString(storeId, 'storeId');
    const storeRecord = await this.store.getStore(storeId);
    if (!storeRecord?.active) {
      throw new ApplicationError('STORE_NOT_FOUND', 'Магазин не найден.', 404);
    }
    return this.store.listSettingsVersions(storeId, date || null);
  }

  async createSettingsVersion(input, actor, options = {}) {
    requireRole(actor, OWNER_ROLES);
    requireString(input.storeId, 'storeId');
    requireDate(input.effectiveFrom, 'effectiveFrom');
    if (!input.reason || typeof input.reason !== 'string' || !input.reason.trim()) {
      throw new ApplicationError(
        'VALIDATION_ERROR',
        'Причина изменения настроек обязательна.',
        422,
        { details: { field: 'reason' } }
      );
    }
    const storeRecord = await this.store.getStore(input.storeId);
    if (!storeRecord?.active) {
      throw new ApplicationError('STORE_NOT_FOUND', 'Магазин не найден.', 404);
    }
    const settings = input.settings;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new ApplicationError(
        'VALIDATION_ERROR',
        'Настройки KPI должны быть объектом.',
        422
      );
    }
    const validationErrors = validateKpiSettings(settings);
    if (validationErrors.length > 0) {
      throw new ApplicationError(
        'VALIDATION_ERROR',
        validationErrors.join(' '),
        422,
        { details: { errors: validationErrors } }
      );
    }
    const now = this.now().toISOString();
    return this.store.transaction(async store => {
      const maxVersion = await store.getMaxSettingsVersion(input.storeId);
      const record = await store.createSettingsVersion({
        id: this.uuid(),
        storeId: input.storeId,
        version: maxVersion + 1,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: null,
        settings,
        source: 'web_manual',
        createdAt: now,
      });
      await store.appendAudit(auditRecord(
        'SETTINGS_VERSION_CREATED',
        record.id,
        actor,
        null,
        record,
        {
          entityType: 'kpi_settings',
          reason: input.reason,
          correlationId: options.correlationId,
          now,
        }
      ));
      return record;
    });
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

  async exportMonth(input, actor) {
    const storeRecord = await this.store.getStore(input.storeId);
    if (!storeRecord?.active) {
      throw new ApplicationError('STORE_NOT_FOUND', 'Магазин не найден.', 404);
    }
    const [shifts, dashboard] = await Promise.all([
      this.listShifts({ storeId: input.storeId, year: input.year, month: input.month }),
      this.getDashboard(input, actor),
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
