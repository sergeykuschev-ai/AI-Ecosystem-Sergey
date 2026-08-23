'use strict';

const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

const { ApplicationError } = require('./application_error');
const { StorageConflictError } = require('../storage/storage_errors');
const { mapEmployeeNames } = require('../xlsx/employee_mapping');
const { parseKpiWorkbook } = require('../xlsx/import_adapter');

const CONTROL_TOTALS = Object.freeze({
  '2026-05': Object.freeze({ revenue: 739091.2, receipts: 727, plan: 750200 }),
  '2026-06': Object.freeze({ revenue: 736517.85, receipts: 715, plan: 750000 }),
  '2026-07': Object.freeze({ revenue: 794937.1, receipts: 735, plan: 745000 }),
  '2026-08': Object.freeze({ revenue: 593037.6, receipts: 437, plan: 745000 }),
});

function money(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function rowRevenue(row) {
  return row.revenueSource === 'historical_total'
    ? row.historicalRevenue
    : money(row.cash + row.acquiring);
}

function totals(rows) {
  const knownItems = rows.filter(row => row.itemsSold !== null);
  return {
    revenue: money(rows.reduce((sum, row) => sum + rowRevenue(row), 0)),
    receipts: rows.reduce((sum, row) => sum + row.receipts, 0),
    shifts: rows.length,
    itemsSold: rows.every(row => row.itemsSold !== null)
      ? rows.reduce((sum, row) => sum + row.itemsSold, 0)
      : null,
    knownItemsSold: knownItems.reduce((sum, row) => sum + row.itemsSold, 0),
    itemsSoldRows: knownItems.length,
  };
}

function supplementaryChecks(rows, workbookReferences = {}) {
  const grouped = new Map();
  const discrepancies = [];
  for (const row of rows) {
    const current = grouped.get(row.employeeName) || {
      employeeName: row.employeeName, shifts: 0, revenue: 0, receipts: 0,
      knownItemsSold: 0, itemsSoldRows: 0,
    };
    current.shifts += 1;
    current.revenue = money(current.revenue + rowRevenue(row));
    current.receipts += row.receipts;
    if (row.itemsSold !== null) {
      current.knownItemsSold += row.itemsSold;
      current.itemsSoldRows += 1;
    }
    grouped.set(row.employeeName, current);
    const backendAverage = row.receipts === 0 ? null : rowRevenue(row) / row.receipts;
    const referenceAverage = row.sourceReference?.averageCheck;
    if (backendAverage !== null && referenceAverage !== null &&
        Math.abs(backendAverage - referenceAverage) > 0.01) {
      discrepancies.push({
        row: row.sourceReference.row,
        field: 'averageCheck',
        backend: backendAverage,
        excelReference: referenceAverage,
      });
    }
    const backendItems = row.itemsSold === null || row.receipts === 0
      ? null : row.itemsSold / row.receipts;
    const referenceItems = row.sourceReference?.itemsPerReceipt;
    if (backendItems !== null && referenceItems !== null &&
        Math.abs(backendItems - referenceItems) > 0.01) {
      discrepancies.push({
        row: row.sourceReference.row,
        field: 'itemsPerReceipt',
        backend: backendItems,
        excelReference: referenceItems,
      });
    }
  }
  const actual = totals(rows);
  const aggregateReferences = {
    revenue: actual.revenue,
    receipts: actual.receipts,
    averageCheck: actual.receipts === 0 ? null : actual.revenue / actual.receipts,
    qr: rows.every(row => row.qr !== null)
      ? money(rows.reduce((sum, row) => sum + row.qr, 0))
      : null,
  };
  aggregateReferences.qrShare = aggregateReferences.qr === null
    ? null : aggregateReferences.qr / actual.revenue;
  for (const field of ['revenue', 'receipts', 'averageCheck', 'qr', 'qrShare']) {
    const reference = workbookReferences[field];
    const backend = aggregateReferences[field];
    if (reference !== undefined && backend !== null &&
        Math.abs(reference - backend) > (field === 'receipts' ? 0 : 0.01)) {
      discrepancies.push({
        sheet: workbookReferences.sheet,
        field,
        backend,
        excelReference: reference,
      });
    }
  }
  return {
    employeeTotals: Array.from(grouped.values()).sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'ru')),
    referenceDiscrepancies: discrepancies,
  };
}

function reconciliation(year, month, actual) {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  const expected = CONTROL_TOTALS[key] || {
    revenue: actual.revenue,
    receipts: actual.receipts,
    plan: null,
  };
  const revenueDelta = money(actual.revenue - expected.revenue);
  const receiptsDelta = actual.receipts - expected.receipts;
  return {
    expectedRevenue: expected.revenue,
    actualRevenue: actual.revenue,
    revenueDelta,
    expectedReceipts: expected.receipts,
    actualReceipts: actual.receipts,
    receiptsDelta,
    expectedPlan: expected.plan,
    status: revenueDelta === 0 && receiptsDelta === 0 ? 'PASS' : 'FAIL',
  };
}

function canonicalIdentity(row) {
  return `${row.storeId}:${row.employeeId}:${row.shiftDate}:${row.shiftKey}`;
}

function publicRun(run) {
  if (!run) return null;
  const { canonicalRows, ...safe } = run;
  return safe;
}

function settingsComparable(settings) {
  if (!settings) return null;
  return {
    targets: settings.targets,
    weights: settings.weights,
    levels: settings.levels,
    qrCoefficientTiers: settings.qrCoefficientTiers,
    fees: settings.fees,
    payment: settings.payment,
  };
}

function settingsEqual(left, right) {
  return isDeepStrictEqual(
    settingsComparable(left),
    settingsComparable(right)
  );
}

class WorkbookImportService {
  constructor(options) {
    this.store = options.store;
    this.businessKpiService = options.businessKpiService;
    this.uuid = options.uuid || crypto.randomUUID;
    this.now = options.now || (() => new Date());
  }

  async dryRun(input, actor) {
    if (!actor || !['OWNER', 'MANAGER'].includes(actor.role)) {
      throw new ApplicationError('FORBIDDEN', 'Недостаточно прав для импорта.', 403);
    }
    if (!Buffer.isBuffer(input.buffer) || input.buffer.length === 0) {
      throw new ApplicationError('EMPTY_XLSX', 'Выберите непустой XLSX-файл.', 422);
    }
    if (!/\.xlsx$/iu.test(input.filename || '')) {
      throw new ApplicationError('UNSUPPORTED_FILE', 'Поддерживаются только файлы .xlsx.', 415);
    }
    const checksum = crypto.createHash('sha256').update(input.buffer).digest('hex');
    const duplicate = await this.store.getCompletedImportByChecksum(input.storeId, checksum);
    if (duplicate) return { ...publicRun(duplicate), duplicate: true, resultCode: 'DUPLICATE_IMPORT' };

    const startedAt = this.now().toISOString();
    const run = await this.store.createImportRun({
      id: this.uuid(),
      storeId: input.storeId,
      actorId: actor.id,
      originalFilename: input.filename,
      checksum,
      status: 'PENDING',
      detectedVersion: null,
      detectedYear: null,
      detectedMonth: null,
      rowsRead: 0,
      rowsImported: 0,
      rowsSkipped: 0,
      warningsCount: 0,
      errorsCount: 0,
      reconciliationStatus: 'NOT_RUN',
      report: null,
      canonicalRows: null,
      startedAt,
      completedAt: null,
    });
    await this.store.updateImportRun(run.id, { status: 'VALIDATING' });
    try {
      const parsed = parseKpiWorkbook(input.buffer);
      const storeRecord = await this.store.getStore(input.storeId);
      if (!storeRecord?.active) {
        throw new ApplicationError('STORE_NOT_FOUND', 'Магазин не найден.', 404);
      }
      const employees = await this.store.listEmployees({ storeId: input.storeId });
      const periodStart = `${parsed.year}-${String(parsed.month).padStart(2, '0')}-01`;
      const effectiveSettings = await this.store.getEffectiveSettings(input.storeId, periodStart);
      const mapped = mapEmployeeNames(parsed.rows, employees);
      const issues = [...parsed.issues];
      for (const name of mapped.unresolved) {
        issues.push({
          severity: 'warning',
          code: 'UNKNOWN_EMPLOYEE',
          message: `Продавец «${name}» не сопоставлен детерминированно.`,
        });
        issues.push({
          severity: 'error',
          code: 'UNRESOLVED_EMPLOYEE_MAPPING',
          message: `Требуется явное сопоставление продавца «${name}» перед импортом.`,
        });
      }
      const canonicalRows = mapped.rows.map(row => ({ ...row, storeId: input.storeId }));
      const identities = new Set();
      for (const row of canonicalRows.filter(row => row.employeeId)) {
        const identity = canonicalIdentity(row);
        if (identities.has(identity)) {
          issues.push({ severity: 'error', code: 'DUPLICATE_SHIFT', message: 'Книга содержит повтор смены.', identity });
        }
        identities.add(identity);
      }
      const existing = await this.store.listShifts({
        storeId: input.storeId,
        year: parsed.year,
        month: parsed.month,
      });
      for (const shift of existing) {
        const identity = canonicalIdentity(shift);
        if (identities.has(identity)) {
          issues.push({
            severity: 'error',
            code: 'EXISTING_SHIFT_CONFLICT',
            message: 'Смена уже существует; изменённый файл не перезаписывает историю.',
            identity,
          });
        }
      }
      const actual = totals(canonicalRows);
      const supplementary = supplementaryChecks(canonicalRows, parsed.workbookReferences);
      if (supplementary.referenceDiscrepancies.length > 0) {
        issues.push({
          severity: 'warning',
          code: 'EXCEL_REFERENCE_DISCREPANCY',
          message: `Backend отличается от ${supplementary.referenceDiscrepancies.length} Excel reference-значений; authoritative inputs не изменены.`,
        });
      }
      const check = reconciliation(parsed.year, parsed.month, actual);
      if (check.status === 'FAIL') {
        issues.push({ severity: 'error', code: 'CONTROL_TOTAL_MISMATCH', message: 'Контрольные суммы не совпадают.', reconciliation: check });
      }
      let settingsAction = 'UNRESOLVED';
      if (parsed.settings.status === 'CONFIRMED') {
        if (effectiveSettings) {
          if (!settingsEqual(
            effectiveSettings.settings,
            parsed.settings.extracted
          )) {
            issues.push({
              severity: 'error',
              code: 'SETTINGS_CONFLICT',
              message: 'Подтверждённые настройки workbook отличаются от действующей версии.',
            });
          } else {
            settingsAction = 'USE_EXISTING';
          }
        } else {
          settingsAction = 'CREATE_EFFECTIVE_VERSION';
        }
      }
      const warnings = issues.filter(item => item.severity === 'warning');
      const errors = issues.filter(item => item.severity === 'error');
      const invalidRows = new Set(errors.map(item => item.row).filter(Boolean));
      const validRows = canonicalRows.length - invalidRows.size;
      const report = {
        file: input.filename,
        store: { id: storeRecord.id, name: storeRecord.name },
        detected: {
          version: parsed.version,
          year: parsed.year,
          month: parsed.month,
          dataSheet: parsed.dataSheet,
          headerRow: parsed.headerRow,
          sheets: parsed.workbookSheets,
        },
        rows: { read: canonicalRows.length, valid: validRows },
        totals: actual,
        ...supplementary,
        paymentBreakdownAvailable: parsed.paymentBreakdownAvailable,
        settings: {
          status: parsed.settings.status,
          sheet: parsed.settings.sheet,
          action: settingsAction,
          candidate: parsed.settings.extracted,
        },
        warnings,
        errors,
        reconciliation: check,
      };
      const validated = await this.store.updateImportRun(run.id, {
        status: 'VALIDATING',
        detectedVersion: parsed.version,
        detectedYear: parsed.year,
        detectedMonth: parsed.month,
        rowsRead: canonicalRows.length,
        rowsSkipped: invalidRows.size,
        warningsCount: warnings.length,
        errorsCount: errors.length,
        reconciliationStatus: errors.length === 0 ? 'PREVIEW_PASS' : 'PREVIEW_FAILED',
        report,
        canonicalRows,
      });
      return publicRun(validated);
    } catch (error) {
      const applicationError = error instanceof ApplicationError
        ? error
        : new ApplicationError('MALFORMED_OR_UNSUPPORTED_XLSX', error.message, 422, { cause: error });
      await this.store.updateImportRun(run.id, {
        status: 'FAILED',
        errorsCount: 1,
        report: { errors: [{ severity: 'error', code: applicationError.code, message: applicationError.message }] },
        completedAt: this.now().toISOString(),
      });
      throw applicationError;
    }
  }

  async commit(runId, actor) {
    const run = await this.store.getImportRun(runId);
    if (!run) throw new ApplicationError('IMPORT_RUN_NOT_FOUND', 'Запуск импорта не найден.', 404);
    if (run.status === 'COMPLETED') return { ...publicRun(run), duplicate: true, resultCode: 'DUPLICATE_IMPORT' };
    if (run.status !== 'VALIDATING' || run.errorsCount > 0 || !run.canonicalRows) {
      throw new ApplicationError('IMPORT_NOT_READY', 'Импорт нельзя подтвердить: dry-run содержит ошибки.', 409);
    }
    await this.store.updateImportRun(run.id, { status: 'IMPORTING' });
    try {
      await this.businessKpiService.importExcelShiftsBulk(run.canonicalRows, actor, {
        importRunId: run.id,
        sourceRef: `${run.originalFilename}#sha256:${run.checksum}`,
        correlationId: run.id,
        beforeImport: async store => {
          if (run.report.settings.action !== 'CREATE_EFFECTIVE_VERSION') return;
          const effectiveFrom = `${run.detectedYear}-${String(run.detectedMonth).padStart(2, '0')}-01`;
          await store.createSettingsVersion({
            id: this.uuid(),
            storeId: run.storeId,
            version: run.detectedYear * 100 + run.detectedMonth,
            effectiveFrom,
            effectiveTo: null,
            source: `excel_import:${run.checksum}`,
            settings: {
              ...run.report.settings.candidate,
              version: run.detectedYear * 100 + run.detectedMonth,
              effectiveFrom,
              effectiveTo: null,
              source: `excel_import:${run.checksum}`,
            },
            createdAt: this.now().toISOString(),
          });
        },
        beforeCommit: async (store, imported) => {
          await store.updateImportRun(run.id, { status: 'RECONCILING' });
          const actual = totals(imported);
          const check = reconciliation(run.detectedYear, run.detectedMonth, actual);
          if (check.status !== 'PASS') {
            throw new ApplicationError('RECONCILIATION_FAILED', 'Reconciliation не прошла; импорт отменён.', 409, { details: check });
          }
          await store.updateImportRun(run.id, {
            status: 'COMPLETED',
            rowsImported: imported.length,
            rowsSkipped: 0,
            reconciliationStatus: 'PASS',
            report: { ...run.report, reconciliation: check },
            canonicalRows: null,
            completedAt: this.now().toISOString(),
          });
        },
      });
      return publicRun(await this.store.getImportRun(run.id));
    } catch (error) {
      const conflict = error instanceof StorageConflictError || error.code === 'DUPLICATE_SHIFT';
      const failed = await this.store.updateImportRun(run.id, {
        status: 'FAILED',
        rowsImported: 0,
        errorsCount: run.errorsCount + 1,
        reconciliationStatus: 'FAILED',
        report: {
          ...run.report,
          errors: [...(run.report?.errors || []), {
            severity: 'error',
            code: conflict ? 'EXISTING_SHIFT_CONFLICT' : (error.code || 'IMPORT_FAILED'),
            message: error.message,
          }],
        },
        canonicalRows: null,
        completedAt: this.now().toISOString(),
      });
      throw new ApplicationError(
        conflict ? 'EXISTING_SHIFT_CONFLICT' : 'IMPORT_FAILED',
        conflict ? 'Смена уже существует; атомарный импорт отменён.' : error.message,
        409,
        { details: { importRun: publicRun(failed) }, cause: error }
      );
    }
  }

  async list(storeId) {
    return { items: (await this.store.listImportRuns({ storeId })).map(publicRun) };
  }
}

module.exports = {
  CONTROL_TOTALS,
  WorkbookImportService,
  canonicalIdentity,
  publicRun,
  settingsComparable,
  settingsEqual,
  reconciliation,
  totals,
};
