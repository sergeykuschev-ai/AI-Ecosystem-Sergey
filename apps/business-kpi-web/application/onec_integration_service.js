'use strict';

const crypto = require('node:crypto');

const {
  calculateKpiMetrics,
} = require('../../../agents/business-kpi/services/calculate_kpi_metrics');
const { ApplicationError } = require('./application_error');

const CONTRACT_VERSION = '1.0';
const MAX_BATCH_RECORDS = 500;
const RECORD_FIELDS = new Set([
  'recordId', 'storeCode', 'employeeCode', 'businessDate', 'sourceUpdatedAt',
  'cash', 'acquiring', 'qr', 'b2b', 'b2bOrders', 'receipts', 'itemsSold',
  'returnsAmount', 'returnReceipts', 'upsellReceipts',
  'treatsRevenue', 'treatsReceipts',
]);

function sortForJson(value) {
  if (Array.isArray(value)) return value.map(sortForJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, sortForJson(value[key])])
  );
}

function stableStringify(value) {
  return JSON.stringify(sortForJson(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}
function requiredText(value, fieldName, maxLength = 160) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApplicationError('ONEC_VALIDATION_ERROR', `${fieldName} обязателен.`, 422);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new ApplicationError(
      'ONEC_VALIDATION_ERROR',
      `${fieldName} превышает допустимую длину.`,
      422
    );
  }
  return normalized;
}

function dateText(value, fieldName) {
  const text = requiredText(value, fieldName, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new ApplicationError('ONEC_VALIDATION_ERROR', `${fieldName} должен быть YYYY-MM-DD.`, 422);
  }
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new ApplicationError('ONEC_VALIDATION_ERROR', `${fieldName} содержит неверную дату.`, 422);
  }
  return text;
}

function timestampText(value, fieldName) {
  const text = requiredText(value, fieldName, 80);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.valueOf())) {
    throw new ApplicationError('ONEC_VALIDATION_ERROR', `${fieldName} содержит неверное время.`, 422);
  }
  return parsed.toISOString();
}
function money(value, fieldName, options = {}) {
  if (value === null || value === undefined) {
    if (options.optional) return null;
    if (options.defaultValue !== undefined) return options.defaultValue;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ApplicationError(
      'ONEC_VALIDATION_ERROR',
      `${fieldName} должен быть неотрицательным числом.`,
      422
    );
  }
  return Math.round(value * 100) / 100;
}

function count(value, fieldName, options = {}) {
  if (value === null || value === undefined) {
    if (options.optional) return null;
    if (options.defaultValue !== undefined) return options.defaultValue;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new ApplicationError(
      'ONEC_VALIDATION_ERROR',
      `${fieldName} должен быть неотрицательным целым числом.`,
      422
    );
  }
  return value;
}

function normalizeRecord(input, index) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ApplicationError('ONEC_VALIDATION_ERROR', `records[${index}] должен быть объектом.`, 422);
  }
  const unknown = Object.keys(input).find(field => !RECORD_FIELDS.has(field));
  if (unknown) {
    throw new ApplicationError(
      'ONEC_UNSUPPORTED_FIELD',
      `Поле records[${index}].${unknown} не поддерживается контрактом ${CONTRACT_VERSION}.`,
      422
    );
  }
  const normalized = {
    recordId: requiredText(input.recordId, `records[${index}].recordId`),
    storeCode: requiredText(input.storeCode, `records[${index}].storeCode`, 80),
    employeeCode: input.employeeCode == null || input.employeeCode === ''
      ? null
      : requiredText(input.employeeCode, `records[${index}].employeeCode`, 120),
    businessDate: dateText(input.businessDate, `records[${index}].businessDate`),
    sourceUpdatedAt: timestampText(input.sourceUpdatedAt, `records[${index}].sourceUpdatedAt`),
    cash: money(input.cash, `records[${index}].cash`),
    acquiring: money(input.acquiring, `records[${index}].acquiring`),
    qr: money(input.qr, `records[${index}].qr`),
    b2b: money(input.b2b, `records[${index}].b2b`, { defaultValue: 0 }),
    b2bOrders: count(input.b2bOrders, `records[${index}].b2bOrders`, { defaultValue: 0 }),
    receipts: count(input.receipts, `records[${index}].receipts`),
    itemsSold: count(input.itemsSold, `records[${index}].itemsSold`, { optional: true }),
    returnsAmount: money(input.returnsAmount, `records[${index}].returnsAmount`, { defaultValue: 0 }),
    returnReceipts: count(input.returnReceipts, `records[${index}].returnReceipts`, { defaultValue: 0 }),
    upsellReceipts: count(input.upsellReceipts, `records[${index}].upsellReceipts`, { optional: true }),
    treatsRevenue: money(input.treatsRevenue, `records[${index}].treatsRevenue`, { optional: true }),
    treatsReceipts: count(input.treatsReceipts, `records[${index}].treatsReceipts`, { optional: true }),
  };
  if (normalized.qr > normalized.acquiring) {
    throw new ApplicationError(
      'ONEC_VALIDATION_ERROR',
      `records[${index}].qr не может быть больше acquiring: QR уже входит в эквайринг.`,
      422
    );
  }
  return normalized;
}
function normalizeBatch(input, idempotencyHeader) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ApplicationError('ONEC_VALIDATION_ERROR', 'Тело пакета должно быть JSON-объектом.', 422);
  }
  const contractVersion = requiredText(input.contractVersion, 'contractVersion', 20);
  if (contractVersion !== CONTRACT_VERSION) {
    throw new ApplicationError(
      'ONEC_CONTRACT_VERSION_UNSUPPORTED',
      `Поддерживается contractVersion=${CONTRACT_VERSION}.`,
      422
    );
  }
  const sourceInstance = requiredText(input.sourceInstance, 'sourceInstance', 120);
  const batchId = requiredText(input.batchId, 'batchId', 160);
  const headerKey = idempotencyHeader ? String(idempotencyHeader).trim() : null;
  if (headerKey && headerKey !== batchId) {
    throw new ApplicationError(
      'ONEC_IDEMPOTENCY_MISMATCH',
      'X-Idempotency-Key должен совпадать с batchId.',
      422
    );
  }
  if (!Array.isArray(input.records) || input.records.length === 0) {
    throw new ApplicationError('ONEC_VALIDATION_ERROR', 'records должен содержать хотя бы одну запись.', 422);
  }
  if (input.records.length > MAX_BATCH_RECORDS) {
    throw new ApplicationError(
      'ONEC_BATCH_TOO_LARGE',
      `В одном пакете допускается не более ${MAX_BATCH_RECORDS} записей.`,
      413
    );
  }
  return {
    contractVersion,
    sourceInstance,
    batchId,
    records: input.records.map(normalizeRecord),
  };
}
function auditRecord(action, shift, actor, sourceReference, now, correlationId) {
  return {
    id: crypto.randomUUID(),
    actorId: actor.id,
    actorType: 'future_1c',
    action,
    entityType: 'shift',
    entityId: shift.id,
    oldValue: null,
    newValue: shift,
    source: '1c',
    reason: null,
    correlationId: correlationId || crypto.randomUUID(),
    occurredAt: now,
    sourceReference,
  };
}

function compareShadowValue(incoming, manual, tolerance = 0) {
  if (incoming === null || incoming === undefined) {
    return { checked: false, missingManual: false, delta: null, match: null };
  }
  if (manual === null || manual === undefined) {
    return { checked: false, missingManual: true, delta: null, match: null };
  }
  const delta = Math.round((Number(incoming) - Number(manual)) * 100) / 100;
  return {
    checked: true,
    missingManual: false,
    delta,
    match: Math.abs(delta) <= tolerance,
  };
}

function buildShadowComparison(record, shift) {
  if (!shift) {
    return {
      status: 'no_manual_record',
      manualShiftId: null,
      manualSource: null,
      differences: {},
      missingManualFields: [],
      comparedFields: [],
    };
  }
  const specs = [
    ['cash', 0.01],
    ['acquiring', 0.01],
    ['qr', 0.01],
    ['b2b', 0.01],
    ['receipts', 0],
    ['itemsSold', 0],
  ];
  const differences = {};
  const missingManualFields = [];
  const comparedFields = [];
  let mismatch = false;
  for (const [field, tolerance] of specs) {
    const comparison = compareShadowValue(record[field], shift[field], tolerance);
    if (comparison.missingManual) {
      missingManualFields.push(field);
      continue;
    }
    if (!comparison.checked) continue;
    comparedFields.push(field);
    if (!comparison.match) {
      mismatch = true;
      differences[field] = comparison.delta;
    }
  }
  return {
    status: mismatch ? 'differs_manual' : 'matched_manual',
    manualShiftId: shift.id,
    manualSource: shift.source,
    differences,
    missingManualFields,
    comparedFields,
  };
}

class OnecIntegrationService {
  constructor(options) {
    this.store = options.store;
    this.businessKpiService = options.businessKpiService;
    this.uuid = options.uuid || crypto.randomUUID;
    this.now = options.now || (() => new Date());
  }

  async resolveReferences(store, record) {
    const storeRecord = await store.getStoreByCode(record.storeCode);
    if (!storeRecord?.active) {
      throw new ApplicationError(
        'ONEC_STORE_MAPPING_MISSING',
        `Не найден активный магазин для storeCode=${record.storeCode}.`,
        409
      );
    }
    const employeeCode = record.employeeCode || `${record.storeCode}-store-input`;
    const employee = await store.getEmployeeByCode(storeRecord.id, employeeCode);
    if (!employee?.active) {
      throw new ApplicationError(
        'ONEC_EMPLOYEE_MAPPING_MISSING',
        `Не найден employeeCode=${employeeCode} для магазина ${record.storeCode}.`,
        409
      );
    }
    return { storeRecord, employee, employeeCode };
  }
  async syncShift(store, batch, record, references, actor, recordHash, options) {
    const sourceRef = `1c:${batch.sourceInstance}:${record.recordId}`;
    const shiftInput = {
      storeId: references.storeRecord.id,
      employeeId: references.employee.id,
      shiftDate: record.businessDate,
      shiftKey: 'main',
      cash: record.cash,
      acquiring: record.acquiring,
      qr: record.qr,
      b2b: record.b2b,
      b2bOrders: record.b2bOrders,
      receipts: record.receipts,
      itemsSold: record.itemsSold,
      upsellReceipts: record.upsellReceipts,
      treatsRevenue: record.treatsRevenue,
      treatsReceipts: record.treatsReceipts,
      comment: null,
      historicalRevenue: null,
      revenueSource: 'payment_breakdown',
      paymentBreakdownAvailable: true,
    };
    const sourceReference = {
      contractVersion: batch.contractVersion,
      sourceInstance: batch.sourceInstance,
      recordId: record.recordId,
      sourceUpdatedAt: record.sourceUpdatedAt,
      returnsAmount: record.returnsAmount,
      returnReceipts: record.returnReceipts,
      payloadSha256: recordHash,
    };
    const identity = await store.getActiveShiftByIdentity(
      shiftInput.storeId,
      shiftInput.employeeId,
      shiftInput.shiftDate,
      shiftInput.shiftKey
    );
    const bySource = await store.getShiftBySourceRef(sourceRef);
    if (identity && (!bySource || identity.id !== bySource.id)) {
      throw new ApplicationError(
        'ONEC_SHIFT_SOURCE_CONFLICT',
        'Для этого магазина, сотрудника и даты уже существует запись из другого источника.',
        409
      );
    }
    if (bySource && bySource.source !== '1c') {
      throw new ApplicationError('ONEC_SHIFT_SOURCE_CONFLICT', 'Существующая запись не принадлежит 1С.', 409);
    }
    const settingsRecord = await store.getEffectiveSettings(
      shiftInput.storeId,
      shiftInput.shiftDate
    );
    let metrics;
    try {
      metrics = calculateKpiMetrics(shiftInput, settingsRecord?.settings || null);
    } catch (error) {
      throw new ApplicationError('ONEC_VALIDATION_ERROR', error.message, 422, { cause: error });
    }
    const now = this.now().toISOString();
    let shift;
    let status;
    if (bySource) {
      shift = await store.updateShift(bySource.id, {
        ...bySource,
        ...shiftInput,
        source: '1c',
        sourceRef,
        sourceReference,
        updatedAt: now,
      });
      status = 'updated';
    } else {
      shift = await store.createShift({
        id: this.uuid(),
        ...shiftInput,
        employeeName: references.employee.displayName,
        source: '1c',
        sourceRef,
        sourceReference,
        importRunId: null,
        originalImportedInput: null,
        archivedAt: null,
        archivedBy: null,
        createdAt: now,
        updatedAt: now,
      });
      status = 'created';
    }
    if (settingsRecord) {
      await this.businessKpiService.saveKpiSnapshot(
        store,
        shift,
        settingsRecord,
        metrics,
        now
      );
    }
    const audit = auditRecord(
      status === 'created' ? 'SHIFT_ONEC_CREATED' : 'SHIFT_ONEC_UPDATED',
      shift,
      actor,
      sourceReference,
      now,
      options.correlationId
    );
    if (status === 'updated') audit.oldValue = bySource;
    await store.appendAudit(audit);
    return { shift, metrics, status };
  }
  async ingestDailySales(payload, actor, options = {}) {
    if (!actor || actor.role !== 'SERVICE') {
      throw new ApplicationError('FORBIDDEN', 'Интеграция 1С доступна только сервисной учётной записи.', 403);
    }
    let batch = null;
    let payloadHash = null;
    try {
      batch = normalizeBatch(payload, options.idempotencyKey);
      payloadHash = sha256({ mode: 'apply', batch });
      const existingBatch = await this.store.getOnecBatchByKey(batch.batchId);
    if (existingBatch) {
      if (existingBatch.payloadSha256 !== payloadHash) {
        throw new ApplicationError(
          'ONEC_IDEMPOTENCY_CONFLICT',
          'batchId уже использован для другого содержимого.',
          409
        );
      }
      return {
        ...(existingBatch.result || {}),
        batchId: batch.batchId,
        duplicateBatch: true,
      };
    }

      return await this.store.transaction(async store => {
      const createdBatch = await store.createOnecBatch({
        id: this.uuid(),
        idempotencyKey: batch.batchId,
        sourceInstance: batch.sourceInstance,
        contractVersion: batch.contractVersion,
        payloadSha256: payloadHash,
        status: 'PROCESSING',
        recordsReceived: batch.records.length,
        recordsApplied: 0,
        payload: { mode: 'apply', ...batch },
        result: null,
        error: null,
        receivedAt: this.now().toISOString(),
        completedAt: null,
      });
      if (!createdBatch) {
        const raced = await store.getOnecBatchByKey(batch.batchId);
        if (raced?.payloadSha256 === payloadHash) {
          return { ...(raced.result || {}), batchId: batch.batchId, duplicateBatch: true };
        }
        throw new ApplicationError('ONEC_IDEMPOTENCY_CONFLICT', 'Конфликт batchId.', 409);
      }
      const results = [];
      let applied = 0;
      for (const record of batch.records) {
        const recordHash = sha256(record);
        const references = await this.resolveReferences(store, record);
        const previous = await store.getOnecDailySalesRecord(
          batch.sourceInstance,
          record.recordId
        );
        if (previous && previous.payloadSha256 !== recordHash &&
            new Date(record.sourceUpdatedAt) <= new Date(previous.sourceUpdatedAt)) {
          throw new ApplicationError(
            'ONEC_STALE_RECORD',
            `Запись ${record.recordId} старее уже принятой версии.`,
            409
          );
        }

        let shiftResult;
        if (previous && previous.payloadSha256 === recordHash && previous.appliedShiftId) {
          const existingShift = await store.getShift(previous.appliedShiftId);
          if (existingShift) {
            shiftResult = { shift: existingShift, status: 'unchanged', metrics: null };
          }
        }
        if (!shiftResult) {
          shiftResult = await this.syncShift(
            store,
            batch,
            record,
            references,
            actor,
            recordHash,
            options
          );
        }
        await store.upsertOnecDailySalesRecord({
          id: previous?.id || this.uuid(),
          batchId: createdBatch.id,
          sourceInstance: batch.sourceInstance,
          externalRecordId: record.recordId,
          storeId: references.storeRecord.id,
          employeeId: references.employee.id,
          businessDate: record.businessDate,
          cash: record.cash,
          acquiring: record.acquiring,
          qr: record.qr,
          b2b: record.b2b,
          b2bOrders: record.b2bOrders,
          receipts: record.receipts,
          itemsSold: record.itemsSold,
          returnsAmount: record.returnsAmount,
          returnReceipts: record.returnReceipts,
          sourceUpdatedAt: record.sourceUpdatedAt,
          payloadSha256: recordHash,
          payload: record,
          appliedShiftId: shiftResult.shift.id,
          appliedAt: this.now().toISOString(),
        });
        if (shiftResult.status !== 'unchanged') applied += 1;
        results.push({
          recordId: record.recordId,
          storeCode: record.storeCode,
          employeeCode: references.employeeCode,
          businessDate: record.businessDate,
          status: shiftResult.status,
          shiftId: shiftResult.shift.id,
        });
      }
      const result = {
        contractVersion: CONTRACT_VERSION,
        mode: 'apply',
        batchId: batch.batchId,
        sourceInstance: batch.sourceInstance,
        duplicateBatch: false,
        recordsReceived: batch.records.length,
        recordsApplied: applied,
        records: results,
      };
      await store.completeOnecBatch(createdBatch.id, {
        status: 'COMPLETED',
        recordsApplied: applied,
        result,
        completedAt: this.now().toISOString(),
      });
      return result;
      });
    } catch (error) {
      try {
        const rawBatchId = batch?.batchId ||
          (typeof options.idempotencyKey === 'string' ? options.idempotencyKey.trim() : null) ||
          (typeof payload?.batchId === 'string' ? payload.batchId.trim() : null);
        const rawSource = batch?.sourceInstance ||
          (typeof payload?.sourceInstance === 'string' ? payload.sourceInstance.trim() : null);
        const rawVersion = batch?.contractVersion ||
          (typeof payload?.contractVersion === 'string' ? payload.contractVersion.trim() : null);
        await this.store.recordOnecFailure({
          id: this.uuid(),
          idempotencyKey: rawBatchId || null,
          sourceInstance: rawSource || null,
          contractVersion: rawVersion || null,
          payloadSha256: payloadHash || sha256(payload),
          errorCode: error.code || 'ONEC_INTERNAL_ERROR',
          errorMessage: error.message || 'Ошибка обработки пакета 1С.',
          errorDetails: error.details || null,
          payload,
          failedAt: this.now().toISOString(),
        });
      } catch (logError) {
        console.error('Failed to persist 1C integration failure', {
          errorMessage: logError.message,
        });
      }
      throw error;
    }
  }

  async ingestShadowDailySales(payload, actor, options = {}) {
    if (!actor || actor.role !== 'SERVICE') {
      throw new ApplicationError(
        'FORBIDDEN',
        'Интеграция 1С доступна только сервисной учётной записи.',
        403
      );
    }
    let batch = null;
    let payloadHash = null;
    try {
      batch = normalizeBatch(payload, options.idempotencyKey);
      payloadHash = sha256({ mode: 'shadow', batch });
      const existingBatch = await this.store.getOnecBatchByKey(batch.batchId);
      if (existingBatch) {
        if (existingBatch.payloadSha256 !== payloadHash) {
          throw new ApplicationError(
            'ONEC_IDEMPOTENCY_CONFLICT',
            'batchId уже использован для другого содержимого или режима.',
            409
          );
        }
        return {
          ...(existingBatch.result || {}),
          batchId: batch.batchId,
          duplicateBatch: true,
        };
      }

      return await this.store.transaction(async store => {
        const createdBatch = await store.createOnecBatch({
          id: this.uuid(),
          idempotencyKey: batch.batchId,
          sourceInstance: batch.sourceInstance,
          contractVersion: batch.contractVersion,
          payloadSha256: payloadHash,
          status: 'PROCESSING',
          recordsReceived: batch.records.length,
          recordsApplied: 0,
          payload: { mode: 'shadow', ...batch },
          result: null,
          error: null,
          receivedAt: this.now().toISOString(),
          completedAt: null,
        });
        if (!createdBatch) {
          const raced = await store.getOnecBatchByKey(batch.batchId);
          if (raced?.payloadSha256 === payloadHash) {
            return {
              ...(raced.result || {}),
              batchId: batch.batchId,
              duplicateBatch: true,
            };
          }
          throw new ApplicationError('ONEC_IDEMPOTENCY_CONFLICT', 'Конфликт batchId.', 409);
        }

        const results = [];
        for (const record of batch.records) {
          const recordHash = sha256(record);
          const references = await this.resolveReferences(store, record);
          const previous = await store.getOnecDailySalesRecord(
            batch.sourceInstance,
            record.recordId
          );
          if (previous && previous.appliedShiftId) {
            throw new ApplicationError(
              'ONEC_SHADOW_AFTER_APPLY',
              `Запись ${record.recordId} уже применена в KPI и не может быть переведена в shadow.`,
              409
            );
          }
          if (previous && previous.payloadSha256 !== recordHash &&
              new Date(record.sourceUpdatedAt) <= new Date(previous.sourceUpdatedAt)) {
            throw new ApplicationError(
              'ONEC_STALE_RECORD',
              `Запись ${record.recordId} старее уже принятой версии.`,
              409
            );
          }

          const manualShift = await store.getActiveShiftByIdentity(
            references.storeRecord.id,
            references.employee.id,
            record.businessDate,
            'main'
          );
          if (manualShift?.source === '1c') {
            throw new ApplicationError(
              'ONEC_SHADOW_AFTER_APPLY',
              `Запись ${record.recordId} уже существует как применённая запись 1С.`,
              409
            );
          }
          const comparison = buildShadowComparison(record, manualShift);

          await store.upsertOnecDailySalesRecord({
            id: previous?.id || this.uuid(),
            batchId: createdBatch.id,
            sourceInstance: batch.sourceInstance,
            externalRecordId: record.recordId,
            storeId: references.storeRecord.id,
            employeeId: references.employee.id,
            businessDate: record.businessDate,
            cash: record.cash,
            acquiring: record.acquiring,
            qr: record.qr,
            b2b: record.b2b,
            b2bOrders: record.b2bOrders,
            receipts: record.receipts,
            itemsSold: record.itemsSold,
            returnsAmount: record.returnsAmount,
            returnReceipts: record.returnReceipts,
            sourceUpdatedAt: record.sourceUpdatedAt,
            payloadSha256: recordHash,
            payload: record,
            appliedShiftId: null,
            appliedAt: null,
          });
          results.push({
            recordId: record.recordId,
            storeCode: record.storeCode,
            employeeCode: references.employeeCode,
            businessDate: record.businessDate,
            ...comparison,
          });
        }

        const result = {
          contractVersion: CONTRACT_VERSION,
          mode: 'shadow',
          batchId: batch.batchId,
          sourceInstance: batch.sourceInstance,
          duplicateBatch: false,
          recordsReceived: batch.records.length,
          recordsApplied: 0,
          recordsShadowed: batch.records.length,
          records: results,
        };
        await store.completeOnecBatch(createdBatch.id, {
          status: 'COMPLETED',
          recordsApplied: 0,
          result,
          completedAt: this.now().toISOString(),
        });
        return result;
      });
    } catch (error) {
      try {
        const rawBatchId = batch?.batchId ||
          (typeof options.idempotencyKey === 'string' ? options.idempotencyKey.trim() : null) ||
          (typeof payload?.batchId === 'string' ? payload.batchId.trim() : null);
        const rawSource = batch?.sourceInstance ||
          (typeof payload?.sourceInstance === 'string' ? payload.sourceInstance.trim() : null);
        const rawVersion = batch?.contractVersion ||
          (typeof payload?.contractVersion === 'string' ? payload.contractVersion.trim() : null);
        await this.store.recordOnecFailure({
          id: this.uuid(),
          idempotencyKey: rawBatchId || null,
          sourceInstance: rawSource || null,
          contractVersion: rawVersion || null,
          payloadSha256: payloadHash || sha256({ mode: 'shadow', payload }),
          errorCode: error.code || 'ONEC_INTERNAL_ERROR',
          errorMessage: error.message || 'Ошибка shadow-обработки пакета 1С.',
          errorDetails: error.details || null,
          payload: { mode: 'shadow', request: payload },
          failedAt: this.now().toISOString(),
        });
      } catch (logError) {
        console.error('Failed to persist 1C shadow failure', {
          errorMessage: logError.message,
        });
      }
      throw error;
    }
  }

  async status(actor, options = {}) {
    if (!actor || actor.role !== 'SERVICE') {
      throw new ApplicationError('FORBIDDEN', 'Статус интеграции доступен только сервису.', 403);
    }
    const limit = Number.isInteger(options.limit) && options.limit > 0
      ? Math.min(options.limit, 50)
      : 20;
    const [batches, failures] = await Promise.all([
      this.store.listOnecBatches({ limit }),
      this.store.listOnecFailures({ limit }),
    ]);
    return {
      contractVersion: CONTRACT_VERSION,
      batches,
      failures,
    };
  }
}

module.exports = {
  CONTRACT_VERSION,
  MAX_BATCH_RECORDS,
  OnecIntegrationService,
  normalizeBatch,
  normalizeRecord,
  sha256,
  stableStringify,
};
