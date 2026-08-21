'use strict';

const { canonicalSupplierName } = require('./demand_engine');

const SUPPLIER_SCOPES = Object.freeze({
  SAME_SUPPLIER: 'SAME_SUPPLIER',
  SUPPLIER_UNASSIGNED: 'SUPPLIER_UNASSIGNED',
  OTHER_SUPPLIER: 'OTHER_SUPPLIER',
});

function resolveSupplierGroup(supplier) {
  if (supplier === null || supplier === undefined) return null;
  const value = typeof supplier === 'string' ? supplier : String(supplier);
  if (value.trim() === '') return null;
  return canonicalSupplierName(value);
}

function collectReportSupplierGroups(rows) {
  const groups = new Set();
  if (!Array.isArray(rows)) return groups;
  for (const row of rows) {
    const supplier = row?.supplier;
    const group = resolveSupplierGroup(supplier);
    if (group !== null) {
      groups.add(group);
    }
  }
  return groups;
}

function readRuleSupplier(rule) {
  if (!rule?.canonical || !Object.hasOwn(rule.canonical, 'supplier')) {
    return undefined;
  }
  const supplier = rule.canonical.supplier;
  if (supplier === null || supplier === undefined) return null;
  const value = typeof supplier === 'string' ? supplier : String(supplier);
  return value.trim() === '' ? null : value;
}

function readMatrixItemSupplier(item) {
  if (!item || !Object.hasOwn(item, 'supplier')) {
    return undefined;
  }
  const supplier = item.supplier;
  if (supplier === null || supplier === undefined) return null;
  const value = typeof supplier === 'string' ? supplier : String(supplier);
  return value.trim() === '' ? null : value;
}

function supplierScope(supplierReader, target, reportSupplierGroups) {
  const supplier = supplierReader(target);
  if (supplier === undefined) {
    return SUPPLIER_SCOPES.SAME_SUPPLIER;
  }
  if (supplier === null) {
    return reportSupplierGroups.size === 0
      ? SUPPLIER_SCOPES.SAME_SUPPLIER
      : SUPPLIER_SCOPES.SUPPLIER_UNASSIGNED;
  }
  if (reportSupplierGroups.size === 0) {
    return SUPPLIER_SCOPES.SAME_SUPPLIER;
  }
  const group = resolveSupplierGroup(supplier);
  return reportSupplierGroups.has(group)
    ? SUPPLIER_SCOPES.SAME_SUPPLIER
    : SUPPLIER_SCOPES.OTHER_SUPPLIER;
}

function ruleSupplierScope(rule, reportSupplierGroups) {
  return supplierScope(readRuleSupplier, rule, reportSupplierGroups);
}

function matrixItemSupplierScope(item, reportSupplierGroups) {
  return supplierScope(readMatrixItemSupplier, item, reportSupplierGroups);
}

module.exports = {
  SUPPLIER_SCOPES,
  collectReportSupplierGroups,
  resolveSupplierGroup,
  ruleSupplierScope,
  matrixItemSupplierScope,
};
