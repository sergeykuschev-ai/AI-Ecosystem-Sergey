'use strict';

function normalizeEmployeeName(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildEmployeeMapping(employees) {
  const mapping = new Map();
  for (const employee of employees) {
    const names = [employee.displayName, ...(employee.aliases || [])];
    for (const name of names) {
      const normalized = normalizeEmployeeName(name);
      if (!normalized) continue;
      const existing = mapping.get(normalized);
      if (existing && existing.id !== employee.id) {
        throw new TypeError(`Ambiguous employee alias: ${name}`);
      }
      mapping.set(normalized, employee);
    }
  }
  return mapping;
}

function mapEmployeeNames(rows, employees) {
  const mapping = buildEmployeeMapping(employees);
  const unresolved = new Set();
  const mappedRows = rows.map(row => {
    const employee = mapping.get(normalizeEmployeeName(row.employeeName));
    if (!employee) {
      unresolved.add(row.employeeName);
      return { ...row, employeeId: null };
    }
    return { ...row, employeeId: employee.id, employeeName: employee.displayName };
  });
  return { rows: mappedRows, unresolved: Array.from(unresolved).sort() };
}

module.exports = {
  buildEmployeeMapping,
  mapEmployeeNames,
  normalizeEmployeeName,
};
