'use strict';

const { ApplicationError } = require('./application_error');

const ROLES = Object.freeze({
  OWNER: 'OWNER',
  MANAGER: 'MANAGER',
  SELLER: 'SELLER',
});

const PERMISSIONS = Object.freeze({
  DASHBOARD_READ: 'dashboard.read',
  MONTHS_READ: 'months.read',
  YEAR_READ: 'year.read',
  SELLERS_READ: 'sellers.read',
  BONUSES_READ: 'bonuses.read',
  BONUS_READ_OWN_AMOUNT: 'bonus.read_own_amount',
  BONUS_READ_ALL_AMOUNTS: 'bonus.read_all_amounts',
  SHIFTS_READ: 'shifts.read',
  SHIFT_CREATE: 'shift.create',
  SHIFT_CREATE_OWN: 'shift.create_own',
  SHIFT_EDIT_ANY: 'shift.edit_any',
  SHIFT_EDIT_OWN: 'shift.edit_own',
  SHIFT_ARCHIVE_ANY: 'shift.archive_any',
  SHIFT_ARCHIVE_OWN: 'shift.archive_own',
  SETTINGS_READ: 'settings.read',
  SETTINGS_WRITE: 'settings.write',
  PLAN_WRITE: 'plan.write',
  IMPORT_READ: 'import.read',
  IMPORT_WRITE: 'import.write',
  EXPORT_RUN: 'export.run',
  USERS_MANAGE: 'users.manage',
});

const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.OWNER]: Object.freeze(Object.values(PERMISSIONS)),
  [ROLES.MANAGER]: Object.freeze([
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.MONTHS_READ,
    PERMISSIONS.YEAR_READ,
    PERMISSIONS.SELLERS_READ,
    PERMISSIONS.BONUSES_READ,
    PERMISSIONS.BONUS_READ_ALL_AMOUNTS,
    PERMISSIONS.SHIFTS_READ,
    PERMISSIONS.SHIFT_CREATE,
    PERMISSIONS.SHIFT_EDIT_ANY,
    PERMISSIONS.SHIFT_ARCHIVE_ANY,
    PERMISSIONS.SETTINGS_READ,
    PERMISSIONS.PLAN_WRITE,
    PERMISSIONS.IMPORT_READ,
    PERMISSIONS.IMPORT_WRITE,
    PERMISSIONS.EXPORT_RUN,
  ]),
  [ROLES.SELLER]: Object.freeze([
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.MONTHS_READ,
    PERMISSIONS.YEAR_READ,
    PERMISSIONS.SELLERS_READ,
    PERMISSIONS.BONUSES_READ,
    PERMISSIONS.BONUS_READ_OWN_AMOUNT,
    PERMISSIONS.SHIFTS_READ,
    PERMISSIONS.SHIFT_CREATE_OWN,
    PERMISSIONS.SHIFT_EDIT_OWN,
    PERMISSIONS.SHIFT_ARCHIVE_OWN,
  ]),
});

function hasPermission(role, permission) {
  if (!role || !permission) return false;
  const normalizedRole = String(role).toUpperCase();
  const allowed = ROLE_PERMISSIONS[normalizedRole];
  if (!allowed) return false;
  return allowed.includes(permission);
}

function requirePermission(actor, permission) {
  if (!actor || !actor.role) {
    throw new ApplicationError('AUTH_REQUIRED', 'Требуется аутентификация.', 401);
  }
  if (!hasPermission(actor.role, permission)) {
    throw new ApplicationError('FORBIDDEN', 'Недостаточно прав для этой операции.', 403);
  }
}

function listPermissions(role) {
  const normalizedRole = String(role).toUpperCase();
  return ROLE_PERMISSIONS[normalizedRole] || Object.freeze([]);
}

module.exports = {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLES,
  hasPermission,
  listPermissions,
  requirePermission,
};
