'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { PERMISSIONS, ROLES, hasPermission, listPermissions, requirePermission } = require('../application/permissions');
const { ApplicationError } = require('../application/application_error');

test('OWNER has all permissions', () => {
  for (const p of Object.values(PERMISSIONS)) {
    assert.ok(hasPermission(ROLES.OWNER, p), `OWNER should have ${p}`);
  }
});

test('SELLER has read permissions for dashboard/months/year/sellers/shifts', () => {
  assert.ok(hasPermission(ROLES.SELLER, PERMISSIONS.DASHBOARD_READ));
  assert.ok(hasPermission(ROLES.SELLER, PERMISSIONS.MONTHS_READ));
  assert.ok(hasPermission(ROLES.SELLER, PERMISSIONS.YEAR_READ));
  assert.ok(hasPermission(ROLES.SELLER, PERMISSIONS.SELLERS_READ));
  assert.ok(hasPermission(ROLES.SELLER, PERMISSIONS.SHIFTS_READ));
  assert.ok(hasPermission(ROLES.SELLER, PERMISSIONS.BONUS_READ_OWN_AMOUNT));
});

test('SELLER cannot write settings/import/plan or manage users', () => {
  assert.ok(!hasPermission(ROLES.SELLER, PERMISSIONS.SETTINGS_WRITE));
  assert.ok(!hasPermission(ROLES.SELLER, PERMISSIONS.PLAN_WRITE));
  assert.ok(!hasPermission(ROLES.SELLER, PERMISSIONS.IMPORT_WRITE));
  assert.ok(!hasPermission(ROLES.SELLER, PERMISSIONS.EXPORT_RUN));
  assert.ok(!hasPermission(ROLES.SELLER, PERMISSIONS.USERS_MANAGE));
  assert.ok(!hasPermission(ROLES.SELLER, PERMISSIONS.BONUS_READ_ALL_AMOUNTS));
});

test('SELLER can create/edit/archive own shifts only', () => {
  assert.ok(hasPermission(ROLES.SELLER, PERMISSIONS.SHIFT_CREATE_OWN));
  assert.ok(hasPermission(ROLES.SELLER, PERMISSIONS.SHIFT_EDIT_OWN));
  assert.ok(hasPermission(ROLES.SELLER, PERMISSIONS.SHIFT_ARCHIVE_OWN));
  assert.ok(!hasPermission(ROLES.SELLER, PERMISSIONS.SHIFT_EDIT_ANY));
  assert.ok(!hasPermission(ROLES.SELLER, PERMISSIONS.SHIFT_ARCHIVE_ANY));
});

test('MANAGER has operational write permissions but not users.manage', () => {
  assert.ok(hasPermission(ROLES.MANAGER, PERMISSIONS.SHIFT_EDIT_ANY));
  assert.ok(hasPermission(ROLES.MANAGER, PERMISSIONS.SETTINGS_READ));
  assert.ok(hasPermission(ROLES.MANAGER, PERMISSIONS.IMPORT_WRITE));
  assert.ok(!hasPermission(ROLES.MANAGER, PERMISSIONS.USERS_MANAGE));
});

test('requirePermission throws FORBIDDEN when permission missing', () => {
  assert.throws(
    () => requirePermission({ role: ROLES.SELLER, id: 'u1' }, PERMISSIONS.SETTINGS_WRITE),
    (err) => err instanceof ApplicationError && err.code === 'FORBIDDEN' && err.statusCode === 403
  );
});

test('requirePermission throws AUTH_REQUIRED when actor missing', () => {
  assert.throws(
    () => requirePermission(null, PERMISSIONS.DASHBOARD_READ),
    (err) => err instanceof ApplicationError && err.code === 'AUTH_REQUIRED' && err.statusCode === 401
  );
});

test('requirePermission passes for allowed permission', () => {
  assert.doesNotThrow(() => requirePermission({ role: ROLES.SELLER, id: 'u1' }, PERMISSIONS.DASHBOARD_READ));
});

test('SERVICE has only read permissions needed for analytics', () => {
  assert.ok(hasPermission(ROLES.SERVICE, PERMISSIONS.DASHBOARD_READ));
  assert.ok(hasPermission(ROLES.SERVICE, PERMISSIONS.MONTHS_READ));
  assert.ok(hasPermission(ROLES.SERVICE, PERMISSIONS.YEAR_READ));
  assert.ok(hasPermission(ROLES.SERVICE, PERMISSIONS.SELLERS_READ));
  assert.ok(hasPermission(ROLES.SERVICE, PERMISSIONS.BONUSES_READ));
  assert.ok(hasPermission(ROLES.SERVICE, PERMISSIONS.BONUS_READ_ALL_AMOUNTS));
  assert.ok(hasPermission(ROLES.SERVICE, PERMISSIONS.SHIFTS_READ));
  assert.ok(hasPermission(ROLES.SERVICE, PERMISSIONS.SETTINGS_READ));
  assert.ok(hasPermission(ROLES.SERVICE, PERMISSIONS.IMPORT_READ));
  assert.ok(hasPermission(ROLES.SERVICE, PERMISSIONS.SELLER_PERFORMANCE_READ));
});

test('SERVICE cannot perform any write operation', () => {
  assert.ok(!hasPermission(ROLES.SERVICE, PERMISSIONS.SHIFT_CREATE));
  assert.ok(!hasPermission(ROLES.SERVICE, PERMISSIONS.SHIFT_EDIT_ANY));
  assert.ok(!hasPermission(ROLES.SERVICE, PERMISSIONS.SHIFT_ARCHIVE_ANY));
  assert.ok(!hasPermission(ROLES.SERVICE, PERMISSIONS.SETTINGS_WRITE));
  assert.ok(!hasPermission(ROLES.SERVICE, PERMISSIONS.PLAN_WRITE));
  assert.ok(!hasPermission(ROLES.SERVICE, PERMISSIONS.IMPORT_WRITE));
  assert.ok(!hasPermission(ROLES.SERVICE, PERMISSIONS.EXPORT_RUN));
  assert.ok(!hasPermission(ROLES.SERVICE, PERMISSIONS.USERS_MANAGE));
});

test('listPermissions returns only permissions assigned to role', () => {
  const sellerPerms = listPermissions(ROLES.SELLER);
  assert.ok(sellerPerms.includes(PERMISSIONS.DASHBOARD_READ));
  assert.ok(!sellerPerms.includes(PERMISSIONS.USERS_MANAGE));
});
