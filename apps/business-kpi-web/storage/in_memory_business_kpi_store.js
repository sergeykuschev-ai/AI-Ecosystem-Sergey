'use strict';

const {
  MISKA_AUGUST_2026_SETTINGS,
} = require('../../../agents/business-kpi/rules/reference_settings');
const { StorageConflictError } = require('./storage_errors');

const DEV_STORE = Object.freeze({
  id: '10000000-0000-4000-8000-000000000001',
  code: 'miska',
  name: 'Миска',
  timezone: 'Asia/Vladivostok',
  active: true,
});
const DEV_EMPLOYEES = Object.freeze([
  Object.freeze({
    id: '20000000-0000-4000-8000-000000000001',
    storeId: DEV_STORE.id,
    employeeCode: 'seller-demo-1',
    displayName: 'Продавец 1',
    active: true,
  }),
  ...[
    ['20000000-0000-4000-8000-000000000003', 'seller-gorbunova', 'Горбунова'],
    ['20000000-0000-4000-8000-000000000004', 'seller-kapitanova', 'Капитанова'],
    ['20000000-0000-4000-8000-000000000005', 'seller-kushchev', 'Кущев'],
    ['20000000-0000-4000-8000-000000000006', 'seller-cherednichenko', 'Чередниченко'],
  ].map(([id, employeeCode, displayName]) => Object.freeze({
    id, storeId: DEV_STORE.id, employeeCode, displayName, active: true,
  })),
  Object.freeze({
    id: '20000000-0000-4000-8000-000000000002',
    storeId: DEV_STORE.id,
    employeeCode: 'seller-demo-2',
    displayName: 'Продавец 2',
    active: true,
  }),
]);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function matchesShift(shift, filters) {
  if (!filters.includeArchived && shift.archivedAt) return false;
  if (filters.storeId && shift.storeId !== filters.storeId) return false;
  if (filters.employeeId && shift.employeeId !== filters.employeeId) return false;
  if (filters.year && Number(shift.shiftDate.slice(0, 4)) !== filters.year) {
    return false;
  }
  if (filters.month && Number(shift.shiftDate.slice(5, 7)) !== filters.month) {
    return false;
  }
  if (filters.dateFrom && shift.shiftDate < filters.dateFrom) return false;
  if (filters.dateTo && shift.shiftDate > filters.dateTo) return false;
  return true;
}

class InMemoryBusinessKpiStore {
  constructor(options = {}) {
    const seed = options.seed !== false;
    this.stores = seed ? [clone(DEV_STORE)] : [];
    this.employees = seed ? clone(DEV_EMPLOYEES) : [];
    this.users = [];
    this.sessions = [];
    this.shifts = [];
    this.audit = [];
    this.kpiResults = [];
    this.importRuns = [];
    this.settings = seed ? [{
      id: '30000000-0000-4000-8000-000000000001',
      storeId: DEV_STORE.id,
      ...clone(MISKA_AUGUST_2026_SETTINGS),
      settings: clone(MISKA_AUGUST_2026_SETTINGS),
    }] : [];
    this.plans = seed ? [
      { storeId: DEV_STORE.id, year: 2026, month: 5, revenuePlan: 750200 },
      { storeId: DEV_STORE.id, year: 2026, month: 6, revenuePlan: 750000 },
      { storeId: DEV_STORE.id, year: 2026, month: 7, revenuePlan: 745000 },
      { storeId: DEV_STORE.id, year: 2026, month: 8, revenuePlan: 745000 },
    ] : [];
  }

  async transaction(work) {
    const snapshot = clone({
      stores: this.stores,
      employees: this.employees,
      users: this.users,
      sessions: this.sessions,
      shifts: this.shifts,
      audit: this.audit,
      kpiResults: this.kpiResults,
      settings: this.settings,
      plans: this.plans,
      importRuns: this.importRuns,
    });
    try {
      return await work(this);
    } catch (error) {
      Object.assign(this, snapshot);
      throw error;
    }
  }

  async listStores() {
    return clone(this.stores.filter(store => store.active));
  }

  async listEmployees({ storeId } = {}) {
    return clone(this.employees.filter(employee =>
      employee.active && (!storeId || employee.storeId === storeId)
    ));
  }

  async getEmployee(id) {
    return clone(this.employees.find(employee => employee.id === id) || null);
  }

  async getStore(id) {
    return clone(this.stores.find(store => store.id === id) || null);
  }

  async createShift(record) {
    const duplicate = this.shifts.find(shift =>
      !shift.archivedAt &&
      shift.storeId === record.storeId &&
      shift.employeeId === record.employeeId &&
      shift.shiftDate === record.shiftDate &&
      shift.shiftKey === record.shiftKey
    );
    if (duplicate) {
      throw new StorageConflictError(
        'DUPLICATE_SHIFT',
        'Такая смена уже существует. Измените существующую запись или укажите другую часть дня.'
      );
    }
    this.shifts.push(clone(record));
    return clone(record);
  }

  async getShift(id, options = {}) {
    const shift = this.shifts.find(item =>
      item.id === id && (options.includeArchived || !item.archivedAt)
    );
    return clone(shift || null);
  }

  async listShifts(filters = {}) {
    return clone(this.shifts
      .filter(shift => matchesShift(shift, filters))
      .sort((left, right) =>
        right.shiftDate.localeCompare(left.shiftDate) ||
        right.createdAt.localeCompare(left.createdAt)
      ));
  }

  async updateShift(id, record) {
    const index = this.shifts.findIndex(shift => shift.id === id);
    if (index < 0 || this.shifts[index].archivedAt) return null;
    const duplicate = this.shifts.find(shift =>
      shift.id !== id && !shift.archivedAt &&
      shift.storeId === record.storeId &&
      shift.employeeId === record.employeeId &&
      shift.shiftDate === record.shiftDate &&
      shift.shiftKey === record.shiftKey
    );
    if (duplicate) {
      throw new StorageConflictError(
        'DUPLICATE_SHIFT',
        'Такая смена уже существует. Измените существующую запись или укажите другую часть дня.'
      );
    }
    this.shifts[index] = clone(record);
    return clone(record);
  }

  async archiveShift(id, archive) {
    const index = this.shifts.findIndex(shift => shift.id === id);
    if (index < 0 || this.shifts[index].archivedAt) return null;
    this.shifts[index] = {
      ...this.shifts[index],
      ...clone(archive),
    };
    return clone(this.shifts[index]);
  }

  async appendAudit(record) {
    this.audit.push(clone(record));
    return clone(record);
  }

  async listAudit({ entityId } = {}) {
    return clone(this.audit.filter(item => !entityId || item.entityId === entityId));
  }

  async saveKpiResult(record) {
    this.kpiResults.push(clone(record));
    return clone(record);
  }

  async createImportRun(record) {
    this.importRuns.push(clone(record));
    return clone(record);
  }

  async updateImportRun(id, patch) {
    const index = this.importRuns.findIndex(run => run.id === id);
    if (index < 0) return null;
    this.importRuns[index] = { ...this.importRuns[index], ...clone(patch) };
    return clone(this.importRuns[index]);
  }

  async getImportRun(id) {
    return clone(this.importRuns.find(run => run.id === id) || null);
  }

  async getCompletedImportByChecksum(storeId, checksum) {
    return clone(this.importRuns.find(run =>
      run.storeId === storeId && run.checksum === checksum && run.status === 'COMPLETED'
    ) || null);
  }

  async listImportRuns({ storeId } = {}) {
    return clone(this.importRuns.filter(run => !storeId || run.storeId === storeId)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt)));
  }

  async getEffectiveSettings(storeId, date) {
    const candidates = this.settings.filter(item =>
      item.storeId === storeId &&
      item.effectiveFrom <= date &&
      (!item.effectiveTo || item.effectiveTo >= date)
    ).sort((left, right) => right.version - left.version);
    return clone(candidates[0] || null);
  }

  async createSettingsVersion(record) {
    this.settings.push(clone(record));
    return clone(record);
  }

  async getMaxSettingsVersion(storeId) {
    const versions = this.settings
      .filter(item => item.storeId === storeId)
      .map(item => item.version);
    return versions.length ? Math.max(...versions) : 0;
  }

  async listSettingsVersions(storeId, date) {
    let candidates = this.settings.filter(item => item.storeId === storeId);
    if (date) {
      candidates = candidates.filter(
        item => item.effectiveFrom <= date &&
          (!item.effectiveTo || item.effectiveTo >= date)
      );
    }
    return clone(candidates.sort((left, right) => right.version - left.version));
  }

  async getMonthlyPlan(storeId, year, month) {
    return clone(this.plans.find(plan =>
      plan.storeId === storeId && plan.year === year && plan.month === month
    ) || null);
  }

  async upsertMonthlyPlan(record) {
    const index = this.plans.findIndex(plan =>
      plan.storeId === record.storeId &&
      plan.year === record.year &&
      plan.month === record.month
    );
    if (index >= 0) this.plans[index] = clone(record);
    else this.plans.push(clone(record));
    return clone(record);
  }

  async createUser(record) {
    const user = { ...clone(record), active: record.active !== false };
    this.users.push(user);
    return clone(user);
  }

  async getUserById(id) {
    return clone(this.users.find(user => user.id === id) || null);
  }

  async getUserByExternalId(externalId) {
    return clone(this.users.find(user => user.externalId === externalId) || null);
  }

  async updateUserPasswordHash(userId, passwordHash) {
    const user = this.users.find(u => u.id === userId);
    if (user) user.passwordHash = passwordHash;
  }

  async updateUserLastLogin(userId, lastLoginAt) {
    const user = this.users.find(u => u.id === userId);
    if (user) {
      user.lastLoginAt = lastLoginAt instanceof Date ? lastLoginAt.toISOString() : lastLoginAt;
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
    }
  }

  async incrementFailedLogins(userId, maxAttempts, lockoutMs) {
    const user = this.users.find(u => u.id === userId);
    if (!user) return;
    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
    if (user.failedLoginAttempts >= maxAttempts) {
      user.lockedUntil = new Date(Date.now() + lockoutMs).toISOString();
    }
  }

  async resetFailedLogins(userId) {
    const user = this.users.find(u => u.id === userId);
    if (user) {
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
    }
  }

  async getEmployeeByUserId(userId) {
    return clone(this.employees.find(employee => employee.userId === userId) || null);
  }

  async createSession(record) {
    const session = clone(record);
    this.sessions.push(session);
    return clone(session);
  }

  async getSessionByTokenHash(tokenHash) {
    return clone(this.sessions.find(session => session.tokenHash === tokenHash) || null);
  }

  async touchSession(sessionId, lastUsedAt) {
    const session = this.sessions.find(s => s.id === sessionId);
    if (session) {
      session.lastUsedAt = lastUsedAt instanceof Date ? lastUsedAt.toISOString() : lastUsedAt;
    }
  }

  async deleteSessionByTokenHash(tokenHash) {
    this.sessions = this.sessions.filter(session => session.tokenHash !== tokenHash);
  }

  async deleteUserSessions(userId) {
    this.sessions = this.sessions.filter(session => session.userId !== userId);
  }

  async deleteExpiredSessions(before) {
    const threshold = before instanceof Date ? before.toISOString() : before;
    this.sessions = this.sessions.filter(session => session.expiresAt > threshold);
  }

  async close() {}

  async checkHealth() {
    return true;
  }
}

module.exports = {
  DEV_EMPLOYEES,
  DEV_STORE,
  InMemoryBusinessKpiStore,
};
