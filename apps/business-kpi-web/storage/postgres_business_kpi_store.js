'use strict';

const { Pool } = require('pg');

const {
  MISKA_AUGUST_2026_SETTINGS,
} = require('../../../agents/business-kpi/rules/reference_settings');
const {
  DEV_EMPLOYEES,
  DEV_STORE,
} = require('./in_memory_business_kpi_store');
const { StorageConflictError } = require('./storage_errors');

function dateText(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function jsonParameter(value) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function mapShift(row) {
  if (!row) return null;
  return {
    id: row.id,
    storeId: row.store_id,
    employeeId: row.employee_id,
    employeeName: row.employee_name || null,
    shiftDate: row.shift_date_text || row.shift_date,
    shiftKey: row.shift_key,
    cash: row.cash_amount === null ? null : Number(row.cash_amount),
    acquiring: row.acquiring_amount === null ? null : Number(row.acquiring_amount),
    qr: row.qr_amount === null ? null : Number(row.qr_amount),
    historicalRevenue: row.historical_revenue === null ? null : Number(row.historical_revenue),
    revenueSource: row.revenue_source,
    paymentBreakdownAvailable: row.payment_breakdown_available,
    receipts: Number(row.receipts),
    itemsSold: row.items_sold === null ? null : Number(row.items_sold),
    upsellReceipts: row.upsell_receipts === null ? null : Number(row.upsell_receipts),
    treatsRevenue: row.treats_revenue === null ? null : Number(row.treats_revenue),
    treatsReceipts: row.treats_receipts === null ? null : Number(row.treats_receipts),
    comment: row.comment,
    source: row.source,
    sourceRef: row.source_ref,
    sourceReference: row.source_reference_json,
    importRunId: row.import_run_id,
    originalImportedInput: row.original_imported_input_json,
    override: row.override_json,
    archivedAt: row.archived_at && new Date(row.archived_at).toISOString(),
    archivedBy: row.archived_by,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapImportRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    storeId: row.store_id,
    actorId: row.actor_id,
    originalFilename: row.original_file_name,
    checksum: row.source_checksum,
    status: row.status,
    detectedVersion: row.detected_version,
    detectedYear: row.detected_year === null ? null : Number(row.detected_year),
    detectedMonth: row.detected_month === null ? null : Number(row.detected_month),
    rowsRead: Number(row.rows_received),
    rowsImported: Number(row.rows_imported),
    rowsSkipped: Number(row.rows_skipped),
    warningsCount: Number(row.warnings_count),
    errorsCount: Number(row.errors_count),
    reconciliationStatus: row.reconciliation_status,
    report: row.validation_report_json,
    canonicalRows: row.canonical_rows_json,
    startedAt: new Date(row.started_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
  };
}

const SHIFT_SELECT = `
  SELECT s.*, to_char(s.shift_date, 'YYYY-MM-DD') AS shift_date_text,
         e.display_name AS employee_name
  FROM business_kpi.shifts s
  JOIN business_kpi.employees e ON e.id = s.employee_id
`;

class PostgresBusinessKpiStore {
  constructor(options = {}) {
    this.client = options.client || new Pool({
      connectionString: options.databaseUrl,
      application_name: 'business-kpi-web',
      max: 5,
    });
    this.ownsPool = !options.client;
  }

  async transaction(work) {
    const connection = typeof this.client.connect === 'function'
      ? await this.client.connect()
      : this.client;
    try {
      await connection.query('BEGIN');
      const scoped = new PostgresBusinessKpiStore({ client: connection });
      const result = await work(scoped);
      await connection.query('COMMIT');
      return result;
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      if (connection !== this.client && typeof connection.release === 'function') {
        connection.release();
      }
    }
  }

  async checkHealth() {
    const result = await this.client.query('SELECT 1 AS healthy');
    return Number(result.rows[0]?.healthy) === 1;
  }

  async listStores() {
    const result = await this.client.query(
      `SELECT id, code, name, timezone, active
       FROM business_kpi.stores WHERE active = true ORDER BY name`
    );
    return result.rows.map(row => ({
      id: row.id,
      code: row.code,
      name: row.name,
      timezone: row.timezone,
      active: row.active,
    }));
  }

  async getStore(id) {
    const result = await this.client.query(
      `SELECT id, code, name, timezone, active
       FROM business_kpi.stores WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  async listEmployees({ storeId } = {}) {
    const values = [];
    const where = ['active = true'];
    if (storeId) {
      values.push(storeId);
      where.push(`store_id = $${values.length}`);
    }
    const result = await this.client.query(
      `SELECT id, store_id, employee_code, display_name, active
       FROM business_kpi.employees
       WHERE ${where.join(' AND ')} ORDER BY display_name`,
      values
    );
    return result.rows.map(row => ({
      id: row.id,
      storeId: row.store_id,
      employeeCode: row.employee_code,
      displayName: row.display_name,
      active: row.active,
    }));
  }

  async getEmployee(id) {
    const result = await this.client.query(
      `SELECT id, store_id, employee_code, display_name, active
       FROM business_kpi.employees WHERE id = $1`,
      [id]
    );
    const row = result.rows[0];
    return row ? {
      id: row.id,
      storeId: row.store_id,
      employeeCode: row.employee_code,
      displayName: row.display_name,
      active: row.active,
    } : null;
  }

  async createShift(record) {
    try {
      await this.client.query(
        `INSERT INTO business_kpi.shifts
         (id, store_id, employee_id, shift_date, shift_key, cash_amount,
          acquiring_amount, qr_amount, receipts, items_sold, upsell_receipts,
          treats_revenue, treats_receipts, comment, source, source_ref,
          created_at, updated_at, import_run_id, historical_revenue,
          revenue_source, payment_breakdown_available, source_reference_json,
          original_imported_input_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
        [record.id, record.storeId, record.employeeId, record.shiftDate,
          record.shiftKey, record.cash, record.acquiring, record.qr,
          record.receipts, record.itemsSold, record.upsellReceipts,
          record.treatsRevenue, record.treatsReceipts, record.comment,
          record.source, record.sourceRef, record.createdAt, record.updatedAt,
          record.importRunId, record.historicalRevenue, record.revenueSource,
          record.paymentBreakdownAvailable, jsonParameter(record.sourceReference),
          jsonParameter(record.originalImportedInput)]
      );
      return this.getShift(record.id);
    } catch (error) {
      if (error.code === '23505') {
        throw new StorageConflictError(
          'DUPLICATE_SHIFT',
          'Такая смена уже существует. Измените существующую запись или укажите другую часть дня.',
          { cause: error }
        );
      }
      throw error;
    }
  }

  async getShift(id, options = {}) {
    const result = await this.client.query(
      `${SHIFT_SELECT} WHERE s.id = $1 ${
        options.includeArchived ? '' : 'AND s.archived_at IS NULL'
      }`,
      [id]
    );
    return mapShift(result.rows[0]);
  }

  async listShifts(filters = {}) {
    const clauses = [];
    const values = [];
    const add = (value, sql) => {
      values.push(value);
      clauses.push(sql.replace('?', `$${values.length}`));
    };
    if (!filters.includeArchived) clauses.push('s.archived_at IS NULL');
    if (filters.storeId) add(filters.storeId, 's.store_id = ?');
    if (filters.employeeId) add(filters.employeeId, 's.employee_id = ?');
    if (filters.year) add(filters.year, 'EXTRACT(YEAR FROM s.shift_date) = ?');
    if (filters.month) add(filters.month, 'EXTRACT(MONTH FROM s.shift_date) = ?');
    if (filters.dateFrom) add(filters.dateFrom, 's.shift_date >= ?');
    if (filters.dateTo) add(filters.dateTo, 's.shift_date <= ?');
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await this.client.query(
      `${SHIFT_SELECT} ${where} ORDER BY s.shift_date DESC, s.created_at DESC`,
      values
    );
    return result.rows.map(mapShift);
  }

  async updateShift(id, record) {
    try {
      const result = await this.client.query(
        `UPDATE business_kpi.shifts SET
           store_id=$2, employee_id=$3, shift_date=$4, shift_key=$5,
           cash_amount=$6, acquiring_amount=$7, qr_amount=$8, receipts=$9,
           items_sold=$10, upsell_receipts=$11, treats_revenue=$12,
           treats_receipts=$13, comment=$14, updated_at=$15, override_json=$16
         WHERE id=$1 AND archived_at IS NULL RETURNING id`,
        [id, record.storeId, record.employeeId, record.shiftDate,
          record.shiftKey, record.cash, record.acquiring, record.qr,
          record.receipts, record.itemsSold, record.upsellReceipts,
          record.treatsRevenue, record.treatsReceipts, record.comment,
          record.updatedAt, jsonParameter(record.override)]
      );
      return result.rows[0] ? this.getShift(id) : null;
    } catch (error) {
      if (error.code === '23505') {
        throw new StorageConflictError(
          'DUPLICATE_SHIFT',
          'Такая смена уже существует. Измените существующую запись или укажите другую часть дня.',
          { cause: error }
        );
      }
      throw error;
    }
  }

  async archiveShift(id, archive) {
    const result = await this.client.query(
      `UPDATE business_kpi.shifts
       SET archived_at=$2, archived_by=$3, updated_at=$2
       WHERE id=$1 AND archived_at IS NULL RETURNING id`,
      [id, archive.archivedAt, archive.archivedBy]
    );
    return result.rows[0]
      ? this.getShift(id, { includeArchived: true })
      : null;
  }

  async appendAudit(record) {
    await this.client.query(
      `INSERT INTO business_kpi.audit_log
       (id, actor_id, actor_type, action, entity_type, entity_id,
        old_value_json, new_value_json, source, reason, correlation_id,
        occurred_at)
       VALUES ($1,$2,'user',$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [record.id, record.actorId, record.action, record.entityType,
        record.entityId, jsonParameter(record.oldValue),
        jsonParameter(record.newValue), record.source,
        record.reason, record.correlationId, record.occurredAt]
    );
    return record;
  }

  async listAudit({ entityId } = {}) {
    const result = await this.client.query(
      `SELECT id, actor_id, action, entity_type, entity_id, old_value_json,
              new_value_json, source, reason, correlation_id, occurred_at
       FROM business_kpi.audit_log
       WHERE ($1::text IS NULL OR entity_id = $1)
       ORDER BY occurred_at`,
      [entityId || null]
    );
    return result.rows.map(row => ({
      id: row.id,
      actorId: row.actor_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      oldValue: row.old_value_json,
      newValue: row.new_value_json,
      source: row.source,
      reason: row.reason,
      correlationId: row.correlation_id,
      occurredAt: new Date(row.occurred_at).toISOString(),
    }));
  }

  async saveKpiResult(record) {
    await this.client.query(
      `INSERT INTO business_kpi.kpi_results
       (id, store_id, employee_id, shift_id, settings_id, result_scope,
        period_start, period_end, calculation_version, input_fingerprint,
        result_json, calculated_at)
       VALUES ($1,$2,$3,$4,$5,'shift',$6,$6,$7,$8,$9,$10)
       ON CONFLICT (store_id, result_scope, input_fingerprint, calculation_version)
       DO NOTHING`,
      [record.id, record.storeId, record.employeeId, record.shiftId,
        record.settingsId, record.periodStart, record.calculationVersion,
        record.inputFingerprint, jsonParameter(record.result), record.calculatedAt]
    );
    return record;
  }

  async createImportRun(record) {
    const result = await this.client.query(
      `INSERT INTO business_kpi.import_runs
       (id, store_id, actor_id, source_type, original_file_name,
        source_checksum, status, rows_received, rows_imported, rows_skipped,
        warnings_count, errors_count, reconciliation_status,
        validation_report_json, canonical_rows_json, started_at, completed_at)
       VALUES ($1,$2,$3,'excel_2026',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [record.id, record.storeId, record.actorId, record.originalFilename,
        record.checksum, record.status, record.rowsRead, record.rowsImported,
        record.rowsSkipped, record.warningsCount, record.errorsCount,
        record.reconciliationStatus, jsonParameter(record.report),
        jsonParameter(record.canonicalRows),
        record.startedAt, record.completedAt]
    );
    return mapImportRun(result.rows[0]);
  }

  async updateImportRun(id, patch) {
    const current = await this.getImportRun(id);
    if (!current) return null;
    const record = { ...current, ...patch };
    const result = await this.client.query(
      `UPDATE business_kpi.import_runs SET
         actor_id=$2, original_file_name=$3, source_checksum=$4, status=$5,
         detected_version=$6, detected_year=$7, detected_month=$8,
         rows_received=$9, rows_imported=$10, rows_skipped=$11,
         warnings_count=$12, errors_count=$13, reconciliation_status=$14,
         validation_report_json=$15, canonical_rows_json=$16, completed_at=$17
       WHERE id=$1 RETURNING *`,
      [id, record.actorId, record.originalFilename, record.checksum, record.status,
        record.detectedVersion, record.detectedYear, record.detectedMonth,
        record.rowsRead, record.rowsImported, record.rowsSkipped,
        record.warningsCount, record.errorsCount, record.reconciliationStatus,
        jsonParameter(record.report), jsonParameter(record.canonicalRows),
        record.completedAt]
    );
    return mapImportRun(result.rows[0]);
  }

  async getImportRun(id) {
    const result = await this.client.query(
      'SELECT * FROM business_kpi.import_runs WHERE id=$1',
      [id]
    );
    return mapImportRun(result.rows[0]);
  }

  async getCompletedImportByChecksum(storeId, checksum) {
    const result = await this.client.query(
      `SELECT * FROM business_kpi.import_runs
       WHERE store_id=$1 AND source_checksum=$2 AND status='COMPLETED'
       ORDER BY completed_at DESC LIMIT 1`,
      [storeId, checksum]
    );
    return mapImportRun(result.rows[0]);
  }

  async listImportRuns({ storeId } = {}) {
    const result = await this.client.query(
      `SELECT * FROM business_kpi.import_runs
       WHERE ($1::uuid IS NULL OR store_id=$1)
       ORDER BY started_at DESC`,
      [storeId || null]
    );
    return result.rows.map(mapImportRun);
  }

  async getEffectiveSettings(storeId, date) {
    const result = await this.client.query(
      `SELECT id, store_id, version, effective_from, effective_to,
              settings_json, source, created_at
       FROM business_kpi.kpi_settings
       WHERE store_id = $1 AND effective_from <= $2
         AND (effective_to IS NULL OR effective_to >= $2)
       ORDER BY version DESC LIMIT 1`,
      [storeId, date]
    );
    const row = result.rows[0];
    return row ? {
      id: row.id,
      storeId: row.store_id,
      version: Number(row.version),
      effectiveFrom: dateText(row.effective_from),
      effectiveTo: dateText(row.effective_to),
      source: row.source,
      settings: row.settings_json,
    } : null;
  }

  async createSettingsVersion(record) {
    await this.client.query(
      `INSERT INTO business_kpi.kpi_settings
       (id, store_id, version, effective_from, effective_to, settings_json,
        source, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [record.id, record.storeId, record.version, record.effectiveFrom,
        record.effectiveTo, jsonParameter(record.settings), record.source,
        record.createdAt]
    );
    return record;
  }

  async getMaxSettingsVersion(storeId) {
    const result = await this.client.query(
      `SELECT MAX(version) AS max_version
       FROM business_kpi.kpi_settings
       WHERE store_id = $1`,
      [storeId]
    );
    return result.rows[0]?.max_version === null
      ? 0
      : Number(result.rows[0].max_version);
  }

  async listSettingsVersions(storeId, date) {
    const values = [storeId];
    let dateFilter = '';
    if (date) {
      values.push(date);
      dateFilter = 'AND effective_from <= $2 AND (effective_to IS NULL OR effective_to >= $2)';
    }
    const result = await this.client.query(
      `SELECT id, store_id, version, effective_from, effective_to,
              settings_json, source, created_at
       FROM business_kpi.kpi_settings
       WHERE store_id = $1 ${dateFilter}
       ORDER BY version DESC`,
      values
    );
    return result.rows.map(row => ({
      id: row.id,
      storeId: row.store_id,
      version: Number(row.version),
      effectiveFrom: dateText(row.effective_from),
      effectiveTo: dateText(row.effective_to),
      source: row.source,
      settings: row.settings_json,
    }));
  }

  async getMonthlyPlan(storeId, year, month) {
    const result = await this.client.query(
      `SELECT id, store_id, plan_year, plan_month, revenue_plan, source,
              created_at, updated_at
       FROM business_kpi.monthly_plans
       WHERE store_id=$1 AND plan_year=$2 AND plan_month=$3`,
      [storeId, year, month]
    );
    const row = result.rows[0];
    return row ? {
      id: row.id,
      storeId: row.store_id,
      year: Number(row.plan_year),
      month: Number(row.plan_month),
      revenuePlan: Number(row.revenue_plan),
      source: row.source,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    } : null;
  }

  async upsertMonthlyPlan(record) {
    const result = await this.client.query(
      `INSERT INTO business_kpi.monthly_plans
       (id, store_id, plan_year, plan_month, revenue_plan, source,
        created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (store_id, plan_year, plan_month) DO UPDATE SET
         revenue_plan=EXCLUDED.revenue_plan, source=EXCLUDED.source,
         updated_at=EXCLUDED.updated_at
       RETURNING id`,
      [record.id, record.storeId, record.year, record.month,
        record.revenuePlan, record.source, record.createdAt, record.updatedAt]
    );
    return { ...record, id: result.rows[0].id };
  }

  async ensureDevReferenceData() {
    await this.client.query(
      `INSERT INTO business_kpi.stores (id, code, name, timezone)
       VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO NOTHING`,
      [DEV_STORE.id, DEV_STORE.code, DEV_STORE.name, DEV_STORE.timezone]
    );
    for (const employee of DEV_EMPLOYEES) {
      await this.client.query(
        `INSERT INTO business_kpi.employees
         (id, store_id, employee_code, display_name)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (store_id, employee_code) DO NOTHING`,
        [employee.id, employee.storeId, employee.employeeCode,
          employee.displayName]
      );
    }
    await this.client.query(
      `INSERT INTO business_kpi.kpi_settings
       (id, store_id, version, effective_from, settings_json, source)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (store_id, version) WHERE store_id IS NOT NULL DO NOTHING`,
      ['30000000-0000-4000-8000-000000000001', DEV_STORE.id, 1,
        MISKA_AUGUST_2026_SETTINGS.effectiveFrom,
        jsonParameter(MISKA_AUGUST_2026_SETTINGS),
        MISKA_AUGUST_2026_SETTINGS.source]
    );
    const plans = [[5, 750200], [6, 750000], [7, 745000], [8, 745000]];
    for (const [month, revenuePlan] of plans) {
      await this.client.query(
        `INSERT INTO business_kpi.monthly_plans
         (id, store_id, plan_year, plan_month, revenue_plan, source)
         VALUES (gen_random_uuid(),$1,2026,$2,$3,'issue_25_control')
         ON CONFLICT (store_id, plan_year, plan_month) DO NOTHING`,
        [DEV_STORE.id, month, revenuePlan]
      );
    }
  }

  async close() {
    if (this.ownsPool && typeof this.client.end === 'function') {
      await this.client.end();
    }
  }
}

module.exports = {
  PostgresBusinessKpiStore,
  dateText,
  mapImportRun,
  mapShift,
};
