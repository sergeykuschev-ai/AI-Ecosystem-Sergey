'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  SUPPLIER_SCOPES,
  collectReportSupplierGroups,
  resolveSupplierGroup,
  ruleSupplierScope,
  matrixItemSupplierScope,
} = require('../services/supplier_scope');

test('resolveSupplierGroup normalizes and applies зооград aliases', () => {
  assert.equal(resolveSupplierGroup('Оникиенко Роман Евгеньевич'), 'зооград');
  assert.equal(resolveSupplierGroup('РИЧ СТОР ООО'), 'зооград');
  assert.equal(resolveSupplierGroup('ЗООГРАД-ХАБАРОВСК ООО'), 'зооград');
  assert.equal(resolveSupplierGroup('Хабаровск ОПТ'), 'зооград');
  assert.equal(resolveSupplierGroup('Зооград'), 'зооград');
  assert.equal(resolveSupplierGroup('Валта'), 'валта');
  assert.equal(resolveSupplierGroup('Premium Pet'), 'premium pet');
});

test('resolveSupplierGroup treats null/empty as unassigned', () => {
  assert.equal(resolveSupplierGroup(null), null);
  assert.equal(resolveSupplierGroup(undefined), null);
  assert.equal(resolveSupplierGroup(''), null);
  assert.equal(resolveSupplierGroup('   '), null);
});

test('collectReportSupplierGroups gathers all present groups', () => {
  const groups = collectReportSupplierGroups([
    { supplier: 'Оникиенко Роман Евгеньевич' },
    { supplier: 'РИЧ СТОР ООО' },
    { supplier: 'Хабаровск ОПТ' },
    { supplier: null },
    { supplier: '' },
  ]);
  assert.deepEqual(Array.from(groups).sort(), ['зооград']);
});

test('mixed zoograd aliases collapse to single supplier group', () => {
  const groups = collectReportSupplierGroups([
    { supplier: 'Оникиенко Роман Евгеньевич' },
    { supplier: 'РИЧ СТОР ООО' },
    { supplier: 'ЗООГРАД-ХАБАРОВСК ООО' },
    { supplier: 'Хабаровск ОПТ' },
  ]);
  assert.equal(groups.size, 1);
  assert.equal(groups.has('зооград'), true);
});

test('collectReportSupplierGroups handles non-array input', () => {
  assert.deepEqual(collectReportSupplierGroups(null), new Set());
  assert.deepEqual(collectReportSupplierGroups(undefined), new Set());
});

test('ruleSupplierScope: same supplier', () => {
  const rule = {
    sku: 'Z-1',
    canonical: { supplier: 'Зооград-Хабаровск ООО' },
  };
  assert.equal(
    ruleSupplierScope(rule, new Set(['зооград'])),
    SUPPLIER_SCOPES.SAME_SUPPLIER
  );
});

test('ruleSupplierScope: other supplier', () => {
  const rule = {
    sku: 'V-1',
    canonical: { supplier: 'Валта' },
  };
  assert.equal(
    ruleSupplierScope(rule, new Set(['зооград'])),
    SUPPLIER_SCOPES.OTHER_SUPPLIER
  );
});

test('ruleSupplierScope: supplier unassigned', () => {
  const rule = {
    sku: 'U-1',
    canonical: { supplier: null },
  };
  assert.equal(
    ruleSupplierScope(rule, new Set(['зооград'])),
    SUPPLIER_SCOPES.SUPPLIER_UNASSIGNED
  );
});

test('ruleSupplierScope: synthetic rule without canonical defaults to same supplier', () => {
  const rule = { sku: 'S-1' };
  assert.equal(
    ruleSupplierScope(rule, new Set(['зооград'])),
    SUPPLIER_SCOPES.SAME_SUPPLIER
  );
});

test('matrixItemSupplierScope: same supplier', () => {
  const item = { article: 'Z-1', name: 'Z item', supplier: 'Оникиенко Роман Евгеньевич' };
  assert.equal(
    matrixItemSupplierScope(item, new Set(['зооград'])),
    SUPPLIER_SCOPES.SAME_SUPPLIER
  );
});

test('matrixItemSupplierScope: other supplier', () => {
  const item = { article: 'V-1', name: 'V item', supplier: 'Валта' };
  assert.equal(
    matrixItemSupplierScope(item, new Set(['зооград'])),
    SUPPLIER_SCOPES.OTHER_SUPPLIER
  );
});

test('matrixItemSupplierScope: supplier unassigned', () => {
  const item = { article: 'U-1', name: 'U item', supplier: null };
  assert.equal(
    matrixItemSupplierScope(item, new Set(['зооград'])),
    SUPPLIER_SCOPES.SUPPLIER_UNASSIGNED
  );
});

test('matrixItemSupplierScope: legacy item without supplier defaults to same supplier', () => {
  const item = { article: 'L-1', name: 'L item' };
  assert.equal(
    matrixItemSupplierScope(item, new Set(['зооград'])),
    SUPPLIER_SCOPES.SAME_SUPPLIER
  );
});
